import path from "node:path"
import { pathToFileURL } from "node:url"
import { config } from "../model/config.js"
import { candidateProtocol, eventProtocol, findBot, shouldBypassReceive, shouldBypassSend } from "./protocol.js"
import { shouldBlockReceive } from "./receive.js"
import { isMissingIdentityMapError, sendWild, sendQQBot } from "./sender.js"
import { isSendSuccess, targetProtocol } from "./message.js"
import { patchDirectSend } from "./direct.js"
import { withCurrentEvent } from "./context.js"
import { messageIds, patchRecall, recallRoutedMessage } from "./recall.js"

const patchFlag = Symbol.for("QWild.Plugin.RouterPatched")
const replyFlag = Symbol.for("QWild.Plugin.ReplyPatched")

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
        ? await sendWild(e, msg)
        : await sendQQBot(e, msg)
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
          `[QWild] 已阻断对方机器人消息：${e.raw_message || e.msg || ""}`,
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
