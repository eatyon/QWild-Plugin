import path from "node:path"
import { pathToFileURL } from "node:url"
import { config, configSave } from "../model/config.js"
import { mappedValue, qqbotId } from "../model/identity.js"
import { candidateProtocol, eventProtocol, findBot, shouldBypassReceive, shouldBypassSend } from "./protocol.js"
import { shouldBlockReceive } from "./receive.js"
import { isMissingIdentityMapError, sendWild, sendQQBot } from "./sender.js"
import { isSendSuccess, targetProtocol } from "./message.js"
import { patchDirectSend } from "./direct.js"
import { withCurrentEvent } from "./context.js"
import { messageIds, patchRecall, recallRoutedMessage } from "./recall.js"

const patchFlag = Symbol.for("QWild.Plugin.RouterPatched")
const replyFlag = Symbol.for("QWild.Plugin.ReplyPatched")
const pendingWildAtMessages = new Map()
const autoMappingWindow = 2000
let mappingSaveTask = Promise.resolve()

function isGroupMessage(e) {
  return Boolean(e?.isGroup || e?.message_type === "group")
}

function shouldBlockUnselectedProtocol(e, protocol) {
  if (!config.block_unselected_protocols || !isGroupMessage(e)) return false
  return Boolean(candidateProtocol(e?.bot) && !protocol)
}

function botSelfId(protocol) {
  const selected = String(config.protocols?.[protocol]?.self_id || "")
  if (selected) return selected
  const bot = findBot(protocol)
  return String(bot?.uin || bot?.self_id || "")
}

function shouldBlockPeerBotMessage(e, protocol) {
  if (!config.block_peer_bot_messages || !isGroupMessage(e)) return false
  if (!["qqbot", "wild"].includes(protocol)) return false
  const peerProtocol = protocol === "qqbot" ? "wild" : "qqbot"
  const peerId = botSelfId(peerProtocol)
  return Boolean(peerId && String(e?.user_id || "") === peerId)
}

function atIds(e) {
  return (e?.message || [])
    .filter(item => item?.type === "at")
    .map(item => String(item.qq || item.user_id || item.data?.qq || item.data?.user_id || ""))
    .filter(Boolean)
}

function isAtCurrentBot(e) {
  if (e?.atBot) return true
  const ids = [e?.self_id, e?.bot?.uin, e?.bot?.self_id]
    .map(id => String(id || ""))
    .filter(Boolean)
  return atIds(e).some(id => ids.includes(id))
}

function eventPairKey(e, protocol) {
  const botId = String(e?.self_id || e?.bot?.uin || e?.bot?.self_id || "")
  const groupId = protocol === "qqbot"
    ? mappedValue(config.groups, qqbotId(botId, e?.group_id))
    : String(e?.group_id || "")
  const text = String(e?.raw_message || e?.msg || "").replace(/\s+/g, " ").trim()
  if (!groupId || !text) return ""
  return `${groupId}\n${text}`
}

function saveAutoMapping() {
  mappingSaveTask = mappingSaveTask
    .catch(() => {})
    .then(() => configSave())
    .catch(err => {
      Bot.makeLog("error", ["[QWild] 自动保存机器人映射失败", err])
    })
}

function rememberWildAtMessage(e) {
  const key = eventPairKey(e, "wild")
  if (!key || !isAtCurrentBot(e)) return
  const previous = pendingWildAtMessages.get(key)
  if (previous) {
    clearTimeout(previous.timer)
    previous.ambiguous = true
  }
  const pending = previous || { ambiguous: false, timer: null }
  const timer = setTimeout(() => pendingWildAtMessages.delete(key), autoMappingWindow)
  timer.unref?.()
  pending.timer = timer
  pendingWildAtMessages.set(key, pending)
}

function tryAddPeerBotMapping(e) {
  const key = eventPairKey(e, "qqbot")
  const pending = key && pendingWildAtMessages.get(key)
  if (!pending || pending.ambiguous) return

  const qqbotBotId = botSelfId("qqbot")
  const wildId = botSelfId("wild")
  const candidates = atIds(e).filter(id =>
    id.startsWith(`${qqbotBotId}:`) && !mappedValue(config.users, id),
  )
  if (!qqbotBotId || candidates.length !== 1 || !wildId) return

  clearTimeout(pending.timer)
  pendingWildAtMessages.delete(key)
  config.users[candidates[0]] = wildId
  Bot.makeLog("info", `[QWild] 已自动添加机器人映射：${candidates[0]} -> ${wildId}`, e.self_id)
  saveAutoMapping()
}

function observeSingleProtocolAtMessage(e, protocol) {
  if (!config.single_protocol_at_messages || !isGroupMessage(e)) return
  if (protocol === "wild") rememberWildAtMessage(e)
  if (protocol === "qqbot") tryAddPeerBotMapping(e)
}

function shouldBlockSingleProtocolAtMessage(e, protocol) {
  if (!config.single_protocol_at_messages || !isGroupMessage(e)) return false
  if (!["qqbot", "wild"].includes(protocol)) return false

  const ids = atIds(e)
  const targetProtocols = ["qqbot", "wild"].filter(item => {
    const selfId = botSelfId(item)
    if (selfId && ids.includes(selfId)) return true
    return protocol === "qqbot" && item === "wild" && ids.some(id => mappedValue(config.users, id) === selfId)
  })
  return targetProtocols.length === 1 && targetProtocols[0] !== protocol
}

function patchReply(e) {
  patchDirectSend()
  patchRecall(e)
  if (!config.enable || e?.[replyFlag] || !e?.reply?.bind) return
  if (shouldBypassSend()) return
  if (!config.send?.enable) return
  const protocol = eventProtocol(e)
  if (!["qqbot", "wild"].includes(protocol)) return
  if (!e.isGroup && !e.isPrivate && !["group", "private"].includes(e.message_type)) return

  const baseReply = e.reply.bind(e)
  e.reply = async (msg = "", quote = false, data = {}) => {
    if (!msg) return false
    if (data?.qwild_no_route) return baseReply(msg, quote, data)
    const target = targetProtocol(msg, e)
    if (!target) return baseReply(msg, quote, data)
    if (target === protocol) return baseReply(msg, quote, data)

    try {
      const ret = target === "wild"
        ? await sendWild(e, msg, { at: data?.at })
        : await sendQQBot(e, msg, { at: data?.at })
      if (isSendSuccess(ret)) {
        scheduleRecall(ret, data?.recallMsg)
        return ret
      }
      if (!config.send.failover) return ret
      return baseReply(msg, quote, data)
    } catch (err) {
      if (isMissingIdentityMapError(err)) {
        return baseReply(msg, quote, data)
      }
      Bot.makeLog("error", [`[QWild] ${target === "wild" ? "Wild" : "QQBot"} 发送失败`, err], e.self_id)
      if (config.send.failover) return baseReply(msg, quote, data)
      return false
    }
  }
  e[replyFlag] = true
}

function scheduleRecall(ret, recallMsg) {
  const delay = Number(recallMsg || 0)
  if (!(delay > 0)) return
  const ids = [...new Set(messageIds(ret))]
  for (const id of ids) {
    const timer = setTimeout(() => recallRoutedMessage(id), delay * 1000)
    timer.unref?.()
  }
}

async function patchLoader() {
  const loaderUrl = pathToFileURL(path.join(process.cwd(), "lib/plugins/loader.js")).href
  const { default: PluginsLoader } = await import(loaderUrl)
  if (PluginsLoader[patchFlag]) return

  const originalDeal = PluginsLoader.deal.bind(PluginsLoader)
  const originalReply = PluginsLoader.reply.bind(PluginsLoader)

  PluginsLoader.deal = async function qwildDeal(e) {
    patchDirectSend()
    if (config.enable && !shouldBypassReceive() && e?.post_type === "message") {
      const protocol = eventProtocol(e)
      if (shouldBlockUnselectedProtocol(e, protocol)) {
        Bot.makeLog(
          "debug",
          `[QWild] 已阻断未接管协议消息：${e.raw_message || e.msg || ""}`,
          e.self_id,
        )
        return
      }
      if (shouldBlockPeerBotMessage(e, protocol)) {
        Bot.makeLog(
          "debug",
          `[QWild] 已阻断对方Bot消息：${e.raw_message || e.msg || ""}`,
          e.self_id,
        )
        return
      }
      if (protocol && shouldBlockReceive(e, protocol)) {
        Bot.makeLog(
          "debug",
          `[QWild] 已阻断 ${config.protocols[protocol]?.adapter || protocol} 消息：${e.raw_message || e.msg || ""}`,
          e.self_id,
        )
        return
      }
      observeSingleProtocolAtMessage(e, protocol)
      if (shouldBlockSingleProtocolAtMessage(e, protocol)) {
        Bot.makeLog(
          "debug",
          `[QWild] 已阻断未被艾特协议消息：${e.raw_message || e.msg || ""}`,
          e.self_id,
        )
        return
      }
    }
    return withCurrentEvent(e, () => originalDeal(e))
  }

  PluginsLoader.reply = function qwildReply(e) {
    originalReply(e)
    patchReply(e)
  }

  PluginsLoader[patchFlag] = true
  patchDirectSend()
  Bot.on?.("connect", patchDirectSend)
  Bot.makeLog("info", "[QWild] 消息路由已接入")
}

await patchLoader()

export class qwildRouter extends plugin {
  constructor() {
    super({
      name: "QWild 协议分流",
      dsc: "QQBot 与 Wild 双协议路由",
      event: "message",
      priority: -999999,
      rule: [],
    })
  }
}
