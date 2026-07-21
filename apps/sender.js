import { config } from "../model/config.js"
import { stripReply } from "./message.js"

export class MissingIdentityMapError extends Error {
  constructor(id) {
    super("未配置身份映射")
    this.name = "MissingIdentityMapError"
    this.id = String(id || "")
  }
}

export function isMissingIdentityMapError(err) {
  return err?.name === "MissingIdentityMapError"
}

function qqbotGroupKey(e) {
  return String(e?.group_id || "")
}

function qqbotUserKey(e) {
  return String(e?.user_id || "")
}

function mappedValue(map, key) {
  key = String(key || "")
  if (map[key]) return map[key]
  const index = key.indexOf(":")
  if (index >= 0 && map[key.slice(index + 1)]) return map[key.slice(index + 1)]
  return ""
}

function reverseMappedValue(map, value) {
  value = String(value || "")
  for (const [from, to] of Object.entries(map || {})) {
    if (String(to) === value) return from
    const index = String(to).indexOf(":")
    if (index >= 0 && String(to).slice(index + 1) === value) return from
  }
  return ""
}

async function sendOneBotGroup(e, msg, baseReply) {
  const onebotGroupId = mappedValue(config.groups, qqbotGroupKey(e))
  if (!onebotGroupId) throw new MissingIdentityMapError(qqbotGroupKey(e))

  const onebot = findBot("onebot")
  if (!onebot?.pickGroup) throw new Error("OneBotv11 未在线")

  return onebot.pickGroup(onebotGroupId).sendMsg(stripReply(msg))
}

export async function sendOneBotFriendByQQBotId(qqbotUserId, msg, baseReply) {
  const onebotUserId = mappedValue(config.users, qqbotUserId)
  if (!onebotUserId) throw new MissingIdentityMapError(qqbotUserId)

  const onebot = findBot("onebot")
  if (!onebot?.pickFriend) throw new Error("OneBotv11 未在线")

  return onebot.pickFriend(onebotUserId).sendMsg(stripReply(msg))
}

export async function sendQQBotFriendByOneBotId(onebotUserId, msg, baseReply) {
  const qqbotUserId = reverseMappedValue(config.users, onebotUserId)
  if (!qqbotUserId) throw new MissingIdentityMapError(onebotUserId)

  const qqbot = findBot("qqbot")
  if (!qqbot?.pickFriend) throw new Error("QQBot 未在线")

  return qqbot.pickFriend(qqbotUserId).sendMsg(stripReply(msg))
}

async function sendOneBotFriend(e, msg, baseReply) {
  return sendOneBotFriendByQQBotId(qqbotUserKey(e), msg, baseReply)
}

export async function sendOneBot(e, msg, baseReply) {
  if (e?.isGroup || e?.message_type === "group") return sendOneBotGroup(e, msg, baseReply)
  if (e?.isPrivate || e?.message_type === "private") return sendOneBotFriend(e, msg, baseReply)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}
