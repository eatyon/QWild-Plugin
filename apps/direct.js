import { createHash } from "node:crypto"
import { config } from "../model/config.js"
import { getCurrentEvent, isNoRoute, withNoRoute } from "./context.js"
import { eventProtocol, findBot, hasOfflineProtocol, isProtocol, offlineMode, protocolStatus } from "./protocol.js"
import {
  isMissingIdentityMapError,
  sendWildGroupByQQBotId,
  sendWildFriendByQQBotId,
  sendQQBotGroupByWildId,
  sendQQBotFriendByWildId,
} from "./sender.js"
import { isSendSuccess, messageTypes, otherProtocol, stripReply, targetProtocol } from "./message.js"
import { hasMappedValue, qqbotId } from "../model/identity.js"

const friendPickPatchFlag = Symbol.for("QWild.Plugin.DirectFriendPickPatched")
const groupPickPatchFlag = Symbol.for("QWild.Plugin.DirectGroupPickPatched")
const friendSendPatchFlag = Symbol.for("QWild.Plugin.DirectFriendSendPatched")
const groupSendPatchFlag = Symbol.for("QWild.Plugin.DirectGroupSendPatched")
const botProtocolCache = new Map()
const botApiPatchFlag = "__QWild_Plugin_DirectBotApiPatched__"
const activeDedupCache = new Map()
const activeDedupTTL = 2000

function protocolName(protocol) {
  if (protocol === "qqbot") return "QQBot"
  if (protocol === "wild") return "Wild"
  return protocol || "原协议"
}

function logActiveDebug(message, detail = "") {
  Bot?.makeLog?.("debug", `[QWild] 主动消息分流：${message}${detail ? `，${detail}` : ""}`)
}

function cacheBotProtocol(botId, protocol) {
  if (botId && protocol) botProtocolCache.set(String(botId), protocol)
}

function isBotOnline(botId) {
  botId = String(botId || "")
  if (!botId) return false
  return Boolean((Bot?.uin || []).map(id => String(id)).includes(botId) && (Bot?.[botId] || Bot?.bots?.[botId]))
}

function protocolByBotId(botId) {
  botId = String(botId || "")
  if (!botId) return ""

  const bot = Bot?.[botId] || Bot?.bots?.[botId]
  if (isProtocol(bot, "qqbot")) {
    cacheBotProtocol(botId, "qqbot")
    return "qqbot"
  }
  if (isProtocol(bot, "wild")) {
    cacheBotProtocol(botId, "wild")
    return "wild"
  }
  if (String(config.protocols?.qqbot?.self_id || "") === botId) return "qqbot"
  if (String(config.protocols?.wild?.self_id || "") === botId) return "wild"
  return botProtocolCache.get(botId) || ""
}

function directSendDecision(protocol, msg) {
  const e = getCurrentEvent()
  const fallback = { active: false, finalProtocol: protocol, route: false }
  if (isNoRoute()) return fallback
  if (!config.enable || !config.send?.enable) return fallback

  const status = protocolStatus()
  const offline = hasOfflineProtocol(status)
  if (offline) {
    if (!config.send.active_message?.enable || e || !["bypass_active", "block_active"].includes(offlineMode())) return fallback

    const other = otherProtocol(protocol)
    if (!status[protocol] && status[other]) return { active: true, finalProtocol: other, route: true }

    const target = targetProtocol(msg, e)
    if (target && target !== protocol && status[target]) {
      return { active: true, finalProtocol: target, route: true }
    }
    return { active: true, finalProtocol: protocol, route: false }
  }

  const target = targetProtocol(msg, e)
  const finalProtocol = target || protocol

  if (target && target !== protocol && eventProtocol(e) === "qqbot") {
    return { active: false, finalProtocol, route: true }
  }

  if (config.send.active_message?.enable && !e) {
    return { active: true, finalProtocol, route: Boolean(target && target !== protocol) }
  }

  return fallback
}

function canRescueOfflineActiveMessage() {
  if (isNoRoute() || getCurrentEvent()) return false
  if (!config.enable || !config.send?.enable || !config.send.active_message?.enable) return false
  return ["bypass_active", "block_active"].includes(offlineMode())
}

function canRouteBotApiActiveMessage() {
  if (isNoRoute() || getCurrentEvent()) return false
  return Boolean(config.enable && config.send?.enable && config.send.active_message?.enable)
}

function normalizedTarget(protocol, type, key, id) {
  if (type === "group") {
    if (protocol === "qqbot") {
      const groupId = config.groups?.[key]
      return groupId ? `group:${groupId}` : ""
    }
    return hasMappedValue(config.groups, id) ? `group:${id}` : ""
  }

  if (protocol === "qqbot") {
    const userId = config.users?.[key]
    return userId ? `user:${userId}` : ""
  }
  return hasMappedValue(config.users, id) ? `user:${id}` : ""
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value)
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
}

function messageDigest(msg) {
  return createHash("sha1").update(stableStringify(msg)).digest("hex")
}

function dedupKey(protocol, type, key, id, msg, finalProtocol) {
  const target = normalizedTarget(protocol, type, key, id)
  if (!target) return ""
  const types = [...messageTypes(msg)].sort().join("+") || "unknown"
  return [target, finalProtocol, types, messageDigest(msg)].join("|")
}

function reserveActiveDuplicate(protocol, type, key, id, msg, finalProtocol) {
  const keyText = dedupKey(protocol, type, key, id, msg, finalProtocol)
  if (!keyText) return { skip: false, key: "" }

  const now = Date.now()
  const expires = activeDedupCache.get(keyText) || 0
  if (expires > now) return { skip: true, key: keyText }

  activeDedupCache.set(keyText, now + activeDedupTTL)
  setTimeout(() => {
    if ((activeDedupCache.get(keyText) || 0) <= Date.now()) activeDedupCache.delete(keyText)
  }, activeDedupTTL).unref?.()
  return { skip: false, key: keyText }
}

function clearActiveDuplicate(key) {
  if (key) activeDedupCache.delete(key)
}

async function sendWithActiveDedup(protocol, type, key, id, msg, finalProtocol, send) {
  const dedup = reserveActiveDuplicate(protocol, type, key, id, msg, finalProtocol)
  if (dedup.skip) {
    logActiveDebug("跳过重复消息", `${type}:${id} -> ${protocolName(finalProtocol)}`)
    return { qwild_dedup: true }
  }
  try {
    const ret = await send()
    if (!isSendSuccess(ret)) {
      logActiveDebug("发送结果无效，清除去重占位", `${type}:${id} -> ${protocolName(finalProtocol)}`)
      clearActiveDuplicate(dedup.key)
    }
    return ret
  } catch (err) {
    logActiveDebug("发送异常，清除去重占位", err?.message || String(err))
    clearActiveDuplicate(dedup.key)
    throw err
  }
}

async function routeDirectSend(protocol, type, key, id, msg, originalSendMsg, fallbackText = "回退原协议") {
  logActiveDebug("尝试跨协议发送", `${protocolName(protocol)} -> ${protocolName(otherProtocol(protocol))}，${type}:${id}`)
  try {
    let ret
    if (type === "group") {
      ret = protocol === "qqbot"
        ? await sendWildGroupByQQBotId(key, msg)
        : await sendQQBotGroupByWildId(id, msg)
    } else {
      ret = protocol === "qqbot"
        ? await sendWildFriendByQQBotId(key, msg)
        : await sendQQBotFriendByWildId(id, msg)
    }

    if (isSendSuccess(ret) || !config.send.failover) return ret
    logActiveDebug(`目标协议返回失败，${fallbackText}`, `${type}:${id}`)
    return originalSendMsg(msg)
  } catch (err) {
    if (isMissingIdentityMapError(err)) {
      logActiveDebug(`缺少身份映射，${fallbackText}`, err.id || id)
      return originalSendMsg(msg)
    }
    if (config.send.failover) {
      logActiveDebug(`目标协议发送异常，${fallbackText}`, err?.message || String(err))
      return originalSendMsg(msg)
    }
    throw err
  }
}

async function sendSameWild(type, id, msg) {
  const wild = findBot("wild")
  if (!wild) throw new Error("Wild 未在线")

  const target = type === "group" ? wild.pickGroup?.(id) : wild.pickFriend?.(id)
  if (!target?.sendMsg) throw new Error(`Wild ${type === "group" ? "群聊" : "好友"}发送入口不可用`)
  return withNoRoute(() => target.sendMsg(stripReply(msg)))
}

async function routeOfflineBotApiSend(protocol, type, botId, id, msg) {
  const status = protocolStatus()
  const target = targetProtocol(msg, null)
  let finalProtocol = target || protocol
  if (!status[finalProtocol] && status[otherProtocol(protocol)]) finalProtocol = otherProtocol(protocol)
  const key = protocol === "qqbot" ? qqbotId(botId, id) : id

  logActiveDebug("接管离线主动消息", `${protocolName(protocol)} -> ${protocolName(finalProtocol)}，${type}:${id}`)

  return sendWithActiveDedup(protocol, type, key, id, msg, finalProtocol, async () => {
    if (!status[finalProtocol]) {
      logActiveDebug("离线主动消息无在线目标，放弃发送", `${protocolName(protocol)}，${type}:${id}`)
      return false
    }

    if (finalProtocol !== protocol) {
      const noOfflineFallback = () => {
        logActiveDebug("离线主动消息切换失败，放弃发送", `${protocolName(finalProtocol)}，${type}:${id}`)
        return false
      }
      return routeDirectSend(protocol, type, key, id, msg, noOfflineFallback, "放弃发送")
    }

    if (protocol === "wild") {
      logActiveDebug("切换到在线 Wild 发送", `${type}:${id}`)
      return sendSameWild(type, id, msg)
    }

    logActiveDebug("离线主动消息无法切换，放弃发送", `${protocolName(protocol)}，${type}:${id}`)
    return false
  })
}

async function routeBotApiSend(protocol, type, botId, id, msg, originalSendMsg) {
  const key = protocol === "qqbot" ? qqbotId(botId, id) : id
  const decision = directSendDecision(protocol, msg)
  if (decision.active) {
    logActiveDebug("接管主动消息", `${protocolName(protocol)} -> ${protocolName(decision.finalProtocol)}，路由：${decision.route ? "是" : "否"}，${type}:${id}`)
    return sendWithActiveDedup(protocol, type, key, id, msg, decision.finalProtocol, () => {
      if (!decision.route) return originalSendMsg(msg)
      return routeDirectSend(protocol, type, key, id, msg, originalSendMsg)
    })
  }
  if (!decision.route) return originalSendMsg(msg)
  return routeDirectSend(protocol, type, key, id, msg, originalSendMsg)
}

function patchPickFriend(bot, botId, protocol) {
  if (!bot?.pickFriend || bot[friendPickPatchFlag]) return
  cacheBotProtocol(botId, protocol)

  const originalPickFriend = bot.pickFriend.bind(bot)
  bot.pickFriend = userId => {
    const friend = originalPickFriend(userId)
    if (!friend?.sendMsg) return friend
    if (friend.sendMsg[friendSendPatchFlag]) return friend

    const originalSendMsg = friend.sendMsg.bind(friend)
    const sendMsg = async (...args) => {
      if (args.length !== 1) return originalSendMsg(...args)
      const msg = args[0]
      const key = qqbotId(botId, userId || friend.user_id)
      const id = userId || friend.user_id
      const decision = directSendDecision(protocol, msg)
      if (decision.active) {
        logActiveDebug("接管好友主动消息", `${protocolName(protocol)} -> ${protocolName(decision.finalProtocol)}，路由：${decision.route ? "是" : "否"}，friend:${id}`)
        return sendWithActiveDedup(protocol, "friend", key, id, msg, decision.finalProtocol, () => {
          if (!decision.route) return originalSendMsg(msg)
          return routeDirectSend(protocol, "friend", key, id, msg, originalSendMsg)
        })
      }
      if (!decision.route) return originalSendMsg(msg)
      return routeDirectSend(protocol, "friend", key, id, msg, originalSendMsg)
    }
    sendMsg[friendSendPatchFlag] = true
    friend.sendMsg = sendMsg
    return friend
  }

  bot[friendPickPatchFlag] = true
}

function patchPickGroup(bot, botId, protocol) {
  if (!bot?.pickGroup || bot[groupPickPatchFlag]) return
  cacheBotProtocol(botId, protocol)

  const originalPickGroup = bot.pickGroup.bind(bot)
  bot.pickGroup = groupId => {
    const group = originalPickGroup(groupId)
    if (!group?.sendMsg) return group
    if (group.sendMsg[groupSendPatchFlag]) return group

    const originalSendMsg = group.sendMsg.bind(group)
    const sendMsg = async (...args) => {
      if (args.length !== 1) return originalSendMsg(...args)
      const msg = args[0]
      const key = qqbotId(botId, groupId || group.group_id)
      const id = groupId || group.group_id
      const decision = directSendDecision(protocol, msg)
      if (decision.active) {
        logActiveDebug("接管群聊主动消息", `${protocolName(protocol)} -> ${protocolName(decision.finalProtocol)}，路由：${decision.route ? "是" : "否"}，group:${id}`)
        return sendWithActiveDedup(protocol, "group", key, id, msg, decision.finalProtocol, () => {
          if (!decision.route) return originalSendMsg(msg)
          return routeDirectSend(protocol, "group", key, id, msg, originalSendMsg)
        })
      }
      if (!decision.route) return originalSendMsg(msg)
      return routeDirectSend(protocol, "group", key, id, msg, originalSendMsg)
    }
    sendMsg[groupSendPatchFlag] = true
    group.sendMsg = sendMsg
    return group
  }

  bot[groupPickPatchFlag] = true
}

function patchBotApi() {
  const botProto = Bot?.constructor?.prototype
  if (!botProto || botProto[botApiPatchFlag]) return

  const originalSendFriendMsg = botProto.sendFriendMsg
  if (originalSendFriendMsg) {
    botProto.sendFriendMsg = async function qwildSendFriendMsg(botId, userId, ...args) {
      if (args.length !== 1) return originalSendFriendMsg.call(this, botId, userId, ...args)
      const protocol = protocolByBotId(botId)
      const msg = args[0]
      if (!protocol || !canRouteBotApiActiveMessage()) {
        return originalSendFriendMsg.call(this, botId, userId, ...args)
      }

      if (!isBotOnline(botId) && canRescueOfflineActiveMessage()) {
        return routeOfflineBotApiSend(protocol, "friend", botId, userId, msg)
      }

      const originalSendMsg = sendMsg => withNoRoute(() => originalSendFriendMsg.call(this, botId, userId, sendMsg))
      return routeBotApiSend(protocol, "friend", botId, userId, msg, originalSendMsg)
    }
  }

  const originalSendGroupMsg = botProto.sendGroupMsg
  if (originalSendGroupMsg) {
    botProto.sendGroupMsg = async function qwildSendGroupMsg(botId, groupId, ...args) {
      if (args.length !== 1) return originalSendGroupMsg.call(this, botId, groupId, ...args)
      const protocol = protocolByBotId(botId)
      const msg = args[0]
      if (!protocol || !canRouteBotApiActiveMessage()) {
        return originalSendGroupMsg.call(this, botId, groupId, ...args)
      }

      if (!isBotOnline(botId) && canRescueOfflineActiveMessage()) {
        return routeOfflineBotApiSend(protocol, "group", botId, groupId, msg)
      }

      const originalSendMsg = sendMsg => withNoRoute(() => originalSendGroupMsg.call(this, botId, groupId, sendMsg))
      return routeBotApiSend(protocol, "group", botId, groupId, msg, originalSendMsg)
    }
  }

  botProto[botApiPatchFlag] = true
}

export function patchDirectSend() {
  patchBotApi()
  for (const id of Bot?.uin || []) {
    const bot = Bot[id]
    if (isProtocol(bot, "qqbot")) {
      cacheBotProtocol(id, "qqbot")
      patchPickFriend(bot, id, "qqbot")
      patchPickGroup(bot, id, "qqbot")
    } else if (isProtocol(bot, "wild")) {
      cacheBotProtocol(id, "wild")
      patchPickFriend(bot, id, "wild")
      patchPickGroup(bot, id, "wild")
    }
  }
}
