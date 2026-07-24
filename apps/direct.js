import { createHash } from "node:crypto"
import { config } from "../model/config.js"
import { getCurrentEvent, isNoRoute } from "./context.js"
import { eventProtocol, isProtocol, shouldBypassRuntime } from "./protocol.js"
import {
  isMissingIdentityMapError,
  sendOneBotGroupByQQBotId,
  sendOneBotFriendByQQBotId,
  sendQQBotGroupByOneBotId,
  sendQQBotFriendByOneBotId,
} from "./sender.js"
import { isSendSuccess, messageTypes, targetProtocol } from "./message.js"

const patchedFriendBots = new WeakSet()
const patchedGroupBots = new WeakSet()
const activeDedupCache = new Map()
const activeDedupTTL = 2000

function qqbotGroupKey(botId, groupId) {
  groupId = String(groupId || "")
  if (groupId.includes(":")) return groupId
  return `${botId}:${groupId}`
}

function qqbotUserKey(botId, userId) {
  userId = String(userId || "")
  if (userId.includes(":")) return userId
  return `${botId}:${userId}`
}

function directSendDecision(protocol, msg) {
  const e = getCurrentEvent()
  const fallback = { active: false, finalProtocol: protocol, route: false }
  if (isNoRoute()) return fallback
  if (!config.enable || !config.send?.enable || shouldBypassRuntime()) return fallback
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

function reverseMappedValue(map, value) {
  value = String(value || "")
  return Object.values(map || {}).some(item => String(item) === value)
}

function normalizedTarget(protocol, type, key, id) {
  if (type === "group") {
    if (protocol === "qqbot") {
      const groupId = config.groups?.[key]
      return groupId ? `group:${groupId}` : ""
    }
    return reverseMappedValue(config.groups, id) ? `group:${id}` : ""
  }

  if (protocol === "qqbot") {
    const userId = config.users?.[key]
    return userId ? `user:${userId}` : ""
  }
  return reverseMappedValue(config.users, id) ? `user:${id}` : ""
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
  if (dedup.skip) return { qwild_dedup: true }
  try {
    const ret = await send()
    if (!isSendSuccess(ret)) clearActiveDuplicate(dedup.key)
    return ret
  } catch (err) {
    clearActiveDuplicate(dedup.key)
    throw err
  }
}

async function routeDirectSend(protocol, type, key, id, msg, originalSendMsg) {
  try {
    let ret
    if (type === "group") {
      ret = protocol === "qqbot"
        ? await sendOneBotGroupByQQBotId(key, msg)
        : await sendQQBotGroupByOneBotId(id, msg)
    } else {
      ret = protocol === "qqbot"
        ? await sendOneBotFriendByQQBotId(key, msg)
        : await sendQQBotFriendByOneBotId(id, msg)
    }

    if (isSendSuccess(ret) || !config.send.failover) return ret
    return originalSendMsg(msg)
  } catch (err) {
    if (isMissingIdentityMapError(err)) {
      return originalSendMsg(msg)
    }
    if (config.send.failover) return originalSendMsg(msg)
    throw err
  }
}

function patchPickFriend(bot, botId, protocol) {
  if (!bot?.pickFriend || patchedFriendBots.has(bot)) return

  const originalPickFriend = bot.pickFriend.bind(bot)
  bot.pickFriend = userId => {
    const friend = originalPickFriend(userId)
    if (!friend?.sendMsg) return friend

    const originalSendMsg = friend.sendMsg.bind(friend)
    friend.sendMsg = async msg => {
      const key = qqbotUserKey(botId, userId || friend.user_id)
      const id = userId || friend.user_id
      const decision = directSendDecision(protocol, msg)
      if (decision.active) {
        return sendWithActiveDedup(protocol, "friend", key, id, msg, decision.finalProtocol, () => {
          if (!decision.route) return originalSendMsg(msg)
          return routeDirectSend(protocol, "friend", key, id, msg, originalSendMsg)
        })
      }
      if (!decision.route) return originalSendMsg(msg)
      return routeDirectSend(protocol, "friend", key, id, msg, originalSendMsg)
    }
    return friend
  }

  patchedFriendBots.add(bot)
}

function patchPickGroup(bot, botId, protocol) {
  if (!bot?.pickGroup || patchedGroupBots.has(bot)) return

  const originalPickGroup = bot.pickGroup.bind(bot)
  bot.pickGroup = groupId => {
    const group = originalPickGroup(groupId)
    if (!group?.sendMsg) return group

    const originalSendMsg = group.sendMsg.bind(group)
    group.sendMsg = async msg => {
      const key = qqbotGroupKey(botId, groupId || group.group_id)
      const id = groupId || group.group_id
      const decision = directSendDecision(protocol, msg)
      if (decision.active) {
        return sendWithActiveDedup(protocol, "group", key, id, msg, decision.finalProtocol, () => {
          if (!decision.route) return originalSendMsg(msg)
          return routeDirectSend(protocol, "group", key, id, msg, originalSendMsg)
        })
      }
      if (!decision.route) return originalSendMsg(msg)
      return routeDirectSend(protocol, "group", key, id, msg, originalSendMsg)
    }
    return group
  }

  patchedGroupBots.add(bot)
}

export function patchDirectSend() {
  for (const id of Bot?.uin || []) {
    const bot = Bot[id]
    if (isProtocol(bot, "qqbot")) {
      patchPickFriend(bot, id, "qqbot")
      patchPickGroup(bot, id, "qqbot")
    } else if (isProtocol(bot, "onebot")) {
      patchPickFriend(bot, id, "onebot")
      patchPickGroup(bot, id, "onebot")
    }
  }
}
