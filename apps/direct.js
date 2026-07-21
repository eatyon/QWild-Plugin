import { config } from "../model/config.js"
import { getCurrentEvent, isNoRoute, withNoRoute } from "./context.js"
import { eventProtocol, isProtocol, shouldBypassRuntime } from "./protocol.js"
import {
  isMissingIdentityMapError,
  sendOneBotGroupByQQBotId,
  sendOneBotFriendByQQBotId,
  sendQQBotGroupByOneBotId,
  sendQQBotFriendByOneBotId,
} from "./sender.js"
import { isSendSuccess, targetProtocol } from "./message.js"

const patchedFriendBots = new WeakSet()
const patchedGroupBots = new WeakSet()
const botApiPatchFlag = "__qwild_direct_bot_api_patched__"

function protocolByBotId(botId) {
  const bot = Bot?.[botId] || Bot?.bots?.[botId]
  if (isProtocol(bot, "qqbot")) return "qqbot"
  if (isProtocol(bot, "onebot")) return "onebot"
  return ""
}

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

function shouldRouteDirectSend(protocol, msg) {
  const e = getCurrentEvent()
  if (isNoRoute()) return false
  if (!config.enable || !config.send?.enable || shouldBypassRuntime()) return false
  const target = targetProtocol(msg, e)
  if (!target) return false
  if (target === protocol) return false

  if (eventProtocol(e) === "qqbot") return true
  if (config.send.active_message?.enable && !e) return true
  return false
}

async function routeDirectSend(protocol, type, key, id, msg, originalSendMsg) {
  try {
    let ret
    if (type === "group") {
      ret = protocol === "qqbot"
        ? await sendOneBotGroupByQQBotId(key, msg, originalSendMsg)
        : await sendQQBotGroupByOneBotId(id, msg, originalSendMsg)
    } else {
      ret = protocol === "qqbot"
        ? await sendOneBotFriendByQQBotId(key, msg, originalSendMsg)
        : await sendQQBotFriendByOneBotId(id, msg, originalSendMsg)
    }

    if (isSendSuccess(ret) || !config.send.failover) return ret
    return originalSendMsg(msg)
  } catch (err) {
    if (isMissingIdentityMapError(err)) {
      if (config.identity?.unmapped_passthrough) return originalSendMsg(msg)
      return false
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
      if (!shouldRouteDirectSend(protocol, msg)) return originalSendMsg(msg)
      const key = qqbotUserKey(botId, userId || friend.user_id)
      return routeDirectSend(protocol, "friend", key, userId || friend.user_id, msg, originalSendMsg)
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
      if (!shouldRouteDirectSend(protocol, msg)) return originalSendMsg(msg)
      const key = qqbotGroupKey(botId, groupId || group.group_id)
      return routeDirectSend(protocol, "group", key, groupId || group.group_id, msg, originalSendMsg)
    }
    return group
  }

  patchedGroupBots.add(bot)
}

function patchBotApi() {
  if (!Bot || Bot[botApiPatchFlag]) return

  const originalSendFriendMsg = Bot.sendFriendMsg?.bind(Bot)
  if (originalSendFriendMsg) {
    Bot.sendFriendMsg = async (botId, userId, ...args) => {
      const protocol = protocolByBotId(botId)
      const msg = args.length > 1 ? args : args[0]
      if (!protocol || !shouldRouteDirectSend(protocol, msg)) {
        return originalSendFriendMsg(botId, userId, ...args)
      }
      const originalSendMsg = sendMsg => withNoRoute(() => originalSendFriendMsg(botId, userId, sendMsg))
      const key = protocol === "qqbot" ? qqbotUserKey(botId, userId) : userId
      return routeDirectSend(protocol, "friend", key, userId, msg, originalSendMsg)
    }
  }

  const originalSendGroupMsg = Bot.sendGroupMsg?.bind(Bot)
  if (originalSendGroupMsg) {
    Bot.sendGroupMsg = async (botId, groupId, ...args) => {
      const protocol = protocolByBotId(botId)
      const msg = args.length > 1 ? args : args[0]
      if (!protocol || !shouldRouteDirectSend(protocol, msg)) {
        return originalSendGroupMsg(botId, groupId, ...args)
      }
      const originalSendMsg = sendMsg => withNoRoute(() => originalSendGroupMsg(botId, groupId, sendMsg))
      const key = protocol === "qqbot" ? qqbotGroupKey(botId, groupId) : groupId
      return routeDirectSend(protocol, "group", key, groupId, msg, originalSendMsg)
    }
  }

  Bot[botApiPatchFlag] = true
}

export function patchDirectSend() {
  patchBotApi()
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
