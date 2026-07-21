import { config } from "../model/config.js"
import { getCurrentEvent } from "./context.js"
import { eventProtocol, isProtocol, shouldBypassRuntime } from "./protocol.js"
import {
  isMissingIdentityMapError,
  sendOneBotFriendByQQBotId,
  sendQQBotFriendByOneBotId,
} from "./sender.js"
import { isSendSuccess, targetProtocol } from "./message.js"

const patchedBots = new WeakSet()

function qqbotUserKey(botId, userId) {
  userId = String(userId || "")
  if (userId.includes(":")) return userId
  return `${botId}:${userId}`
}

function shouldRouteDirectSend(protocol, msg) {
  const e = getCurrentEvent()
  if (!config.enable || !config.send?.enable || shouldBypassRuntime()) return false
  const target = targetProtocol(msg, e)
  if (!target) return false
  if (target === protocol) return false

  if (eventProtocol(e) === "qqbot") return true
  if (config.send.active_private?.enable && !e) return true
  return false
}

async function routeDirectSend(protocol, key, userId, msg, originalSendMsg) {
  try {
    const ret =
      protocol === "qqbot"
        ? await sendOneBotFriendByQQBotId(key, msg, originalSendMsg)
        : await sendQQBotFriendByOneBotId(userId, msg, originalSendMsg)

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
  if (!bot?.pickFriend || patchedBots.has(bot)) return

  const originalPickFriend = bot.pickFriend.bind(bot)
  bot.pickFriend = userId => {
    const friend = originalPickFriend(userId)
    if (!friend?.sendMsg) return friend

    const originalSendMsg = friend.sendMsg.bind(friend)
    friend.sendMsg = async msg => {
      if (!shouldRouteDirectSend(protocol, msg)) return originalSendMsg(msg)
      const key = qqbotUserKey(botId, userId || friend.user_id)
      return routeDirectSend(protocol, key, userId || friend.user_id, msg, originalSendMsg)
    }
    return friend
  }

  patchedBots.add(bot)
}

export function patchDirectSend() {
  for (const id of Bot?.uin || []) {
    const bot = Bot[id]
    if (isProtocol(bot, "qqbot")) patchPickFriend(bot, id, "qqbot")
    else if (isProtocol(bot, "onebot")) patchPickFriend(bot, id, "onebot")
  }
}
