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
import { isSendSuccess, targetProtocol } from "./message.js"

const patchedFriendBots = new WeakSet()
const patchedGroupBots = new WeakSet()

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
