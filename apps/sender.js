import { config } from "../model/config.js"
import { findBot } from "./protocol.js"
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

function qqbotId(selfId, id) {
  id = String(id || "")
  if (!id || id.includes(":")) return id
  return `${selfId}:${id}`
}

function botSelfId(bot) {
  return String(bot?.uin || bot?.self_id || "")
}

function qqbotGroupKey(e) {
  return qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, e?.group_id)
}

function qqbotUserKey(e) {
  return qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, e?.user_id)
}

function mappedValue(map, key) {
  key = String(key || "")
  return map[key] || ""
}

function reverseMappedValue(map, value, botId = "") {
  value = String(value || "")
  botId = String(botId || "")
  for (const [from, to] of Object.entries(map || {})) {
    if (botId && !String(from).startsWith(`${botId}:`)) continue
    if (String(to) === value) return from
  }
  return ""
}

function mappedAtId(id, protocol, botId = "") {
  id = String(id || "")
  if (!id) return ""
  if (protocol === "onebot") return mappedValue(config.users, qqbotId(botId, id)) || mappedValue(config.users, id)
  return reverseMappedValue(config.users, id, botId)
}

function setAtId(item, id) {
  const next = { ...item }
  if ("qq" in next) next.qq = id
  if ("user_id" in next) next.user_id = id
  if (next.data && typeof next.data === "object" && !Array.isArray(next.data)) {
    next.data = { ...next.data }
    if ("qq" in next.data) next.data.qq = id
    if ("user_id" in next.data) next.data.user_id = id
  }
  return next
}

function mapAtMsg(msg, protocol, botId = "") {
  if (Array.isArray(msg)) return msg.map(item => mapAtMsg(item, protocol, botId))
  if (!msg || typeof msg !== "object") return msg

  let next = msg
  if (msg.type === "at") {
    const id = msg.qq || msg.user_id || msg.data?.qq || msg.data?.user_id
    const mapped = mappedAtId(id, protocol, botId)
    if (mapped) next = setAtId(msg, mapped)
  }

  if (Array.isArray(next.data)) next = { ...next, data: mapAtMsg(next.data, protocol, botId) }
  if (Array.isArray(next.message)) next = { ...next, message: mapAtMsg(next.message, protocol, botId) }
  return next
}

export async function sendQQBotGroupByOneBotId(onebotGroupId, msg, baseReply) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickGroup) throw new Error("QQBot 未在线")
  const qqbotGroupId = reverseMappedValue(config.groups, onebotGroupId, botSelfId(qqbot))
  if (!qqbotGroupId) throw new MissingIdentityMapError(onebotGroupId)

  return qqbot.pickGroup(qqbotGroupId).sendMsg(stripReply(mapAtMsg(msg, "qqbot", botSelfId(qqbot))))
}

export async function sendOneBotGroupByQQBotId(qqbotGroupId, msg, baseReply) {
  const onebotGroupId = mappedValue(config.groups, qqbotGroupId)
  if (!onebotGroupId) throw new MissingIdentityMapError(qqbotGroupId)

  const onebot = findBot("onebot")
  if (!onebot?.pickGroup) throw new Error("OneBotv11 未在线")

  return onebot.pickGroup(onebotGroupId).sendMsg(stripReply(mapAtMsg(msg, "onebot", String(qqbotGroupId).split(":")[0])))
}

export async function sendOneBotFriendByQQBotId(qqbotUserId, msg, baseReply) {
  const onebotUserId = mappedValue(config.users, qqbotUserId)
  if (!onebotUserId) throw new MissingIdentityMapError(qqbotUserId)

  const onebot = findBot("onebot")
  if (!onebot?.pickFriend) throw new Error("OneBotv11 未在线")

  return onebot.pickFriend(onebotUserId).sendMsg(stripReply(mapAtMsg(msg, "onebot", String(qqbotUserId).split(":")[0])))
}

export async function sendQQBotFriendByOneBotId(onebotUserId, msg, baseReply) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickFriend) throw new Error("QQBot 未在线")
  const qqbotUserId = reverseMappedValue(config.users, onebotUserId, botSelfId(qqbot))
  if (!qqbotUserId) throw new MissingIdentityMapError(onebotUserId)

  return qqbot.pickFriend(qqbotUserId).sendMsg(stripReply(mapAtMsg(msg, "qqbot", botSelfId(qqbot))))
}

async function sendQQBotFriend(e, msg, baseReply) {
  return sendQQBotFriendByOneBotId(e?.user_id, msg, baseReply)
}

async function sendOneBotFriend(e, msg, baseReply) {
  return sendOneBotFriendByQQBotId(qqbotUserKey(e), msg, baseReply)
}

export async function sendQQBot(e, msg, baseReply) {
  if (e?.isGroup || e?.message_type === "group") return sendQQBotGroupByOneBotId(e?.group_id, msg, baseReply)
  if (e?.isPrivate || e?.message_type === "private") return sendQQBotFriend(e, msg, baseReply)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}

export async function sendOneBot(e, msg, baseReply) {
  if (e?.isGroup || e?.message_type === "group") return sendOneBotGroupByQQBotId(qqbotGroupKey(e), msg, baseReply)
  if (e?.isPrivate || e?.message_type === "private") return sendOneBotFriend(e, msg, baseReply)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}
