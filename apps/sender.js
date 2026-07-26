import { config } from "../model/config.js"
import { withNoRoute } from "./context.js"
import { findBot } from "./protocol.js"
import { stripReply } from "./message.js"
import { recordRoutedMessage } from "./recall.js"
import { mappedValue, qqbotBotId, qqbotId, reverseMappedValue } from "../model/identity.js"

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

function botSelfId(bot) {
  return String(bot?.uin || bot?.self_id || "")
}

function qqbotGroupKey(e) {
  return qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, e?.group_id)
}

function qqbotUserKey(e) {
  return qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, e?.user_id)
}

function mappedAtId(id, protocol, botId = "") {
  id = String(id || "")
  if (!id) return ""
  if (protocol === "wild") return mappedValue(config.users, qqbotId(botId, id)) || mappedValue(config.users, id)
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

export async function sendQQBotGroupByWildId(wildGroupId, msg) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickGroup) throw new Error("QQBot 未在线")
  const qqbotGroupId = reverseMappedValue(config.groups, wildGroupId, botSelfId(qqbot))
  if (!qqbotGroupId) throw new MissingIdentityMapError(wildGroupId)

  const group = qqbot.pickGroup(qqbotGroupId)
  const ret = await withNoRoute(() => group.sendMsg(stripReply(mapAtMsg(msg, "qqbot", botSelfId(qqbot)))))
  return recordRoutedMessage(ret, group)
}

export async function sendWildGroupByQQBotId(qqbotGroupId, msg) {
  const wildGroupId = mappedValue(config.groups, qqbotGroupId)
  if (!wildGroupId) throw new MissingIdentityMapError(qqbotGroupId)

  const wild = findBot("wild")
  if (!wild?.pickGroup) throw new Error("Wild 未在线")

  const group = wild.pickGroup(wildGroupId)
  const ret = await withNoRoute(() => group.sendMsg(stripReply(mapAtMsg(msg, "wild", qqbotBotId(qqbotGroupId)))))
  return recordRoutedMessage(ret, group)
}

export async function sendWildFriendByQQBotId(qqbotUserId, msg) {
  const wildUserId = mappedValue(config.users, qqbotUserId)
  if (!wildUserId) throw new MissingIdentityMapError(qqbotUserId)

  const wild = findBot("wild")
  if (!wild?.pickFriend) throw new Error("Wild 未在线")

  const friend = wild.pickFriend(wildUserId)
  const ret = await withNoRoute(() => friend.sendMsg(stripReply(mapAtMsg(msg, "wild", qqbotBotId(qqbotUserId)))))
  return recordRoutedMessage(ret, friend)
}

export async function sendQQBotFriendByWildId(wildUserId, msg) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickFriend) throw new Error("QQBot 未在线")
  const qqbotUserId = reverseMappedValue(config.users, wildUserId, botSelfId(qqbot))
  if (!qqbotUserId) throw new MissingIdentityMapError(wildUserId)

  const friend = qqbot.pickFriend(qqbotUserId)
  const ret = await withNoRoute(() => friend.sendMsg(stripReply(mapAtMsg(msg, "qqbot", botSelfId(qqbot)))))
  return recordRoutedMessage(ret, friend)
}

async function sendQQBotFriend(e, msg) {
  return sendQQBotFriendByWildId(e?.user_id, msg)
}

async function sendWildFriend(e, msg) {
  return sendWildFriendByQQBotId(qqbotUserKey(e), msg)
}

export async function sendQQBot(e, msg) {
  if (e?.isGroup || e?.message_type === "group") return sendQQBotGroupByWildId(e?.group_id, msg)
  if (e?.isPrivate || e?.message_type === "private") return sendQQBotFriend(e, msg)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}

export async function sendWild(e, msg) {
  if (e?.isGroup || e?.message_type === "group") return sendWildGroupByQQBotId(qqbotGroupKey(e), msg)
  if (e?.isPrivate || e?.message_type === "private") return sendWildFriend(e, msg)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}
