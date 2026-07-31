import { config } from "../model/config.js"
import { withNoRoute } from "./context.js"
import { findBot } from "./protocol.js"
import { messageTypes, stripReply } from "./message.js"
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
  if (msg.type === "node" || msg.type === "forward") return msg

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

function prepareMsg(msg, protocol, botId, options = {}) {
  let next = stripReply(mapAtMsg(msg, protocol, botId))
  const e = options.event
  if (!e?.isGroup && e?.message_type !== "group") return next
  const types = messageTypes(next)
  if (types.has("node") || types.has("forward")) return next

  const sourceAt = options.at === true
    ? e?.user_id
    : options.at
  const at = mappedAtId(sourceAt, protocol, botId)
  if (!at) return next
  return Array.isArray(next)
    ? [{ type: "at", qq: at }, "\n", ...next]
    : [{ type: "at", qq: at }, "\n", next]
}

export async function sendQQBotGroupByWildId(wildGroupId, msg, options = {}) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickGroup) throw new Error("QQBot 未在线")
  const qqbotGroupId = reverseMappedValue(config.groups, wildGroupId, botSelfId(qqbot))
  if (!qqbotGroupId) throw new MissingIdentityMapError(wildGroupId)

  const group = qqbot.pickGroup(qqbotGroupId)
  const ret = await withNoRoute(() => group.sendMsg(prepareMsg(msg, "qqbot", botSelfId(qqbot), options)))
  return recordRoutedMessage(ret, group)
}

export async function sendWildGroupByQQBotId(qqbotGroupId, msg, options = {}) {
  const wildGroupId = mappedValue(config.groups, qqbotGroupId)
  if (!wildGroupId) throw new MissingIdentityMapError(qqbotGroupId)

  const wild = findBot("wild")
  if (!wild?.pickGroup) throw new Error("Wild 未在线")

  const group = wild.pickGroup(wildGroupId)
  const ret = await withNoRoute(() => group.sendMsg(prepareMsg(msg, "wild", qqbotBotId(qqbotGroupId), options)))
  return recordRoutedMessage(ret, group)
}

export async function sendWildFriendByQQBotId(qqbotUserId, msg, options = {}) {
  const wildUserId = mappedValue(config.users, qqbotUserId)
  if (!wildUserId) throw new MissingIdentityMapError(qqbotUserId)

  const wild = findBot("wild")
  if (!wild?.pickFriend) throw new Error("Wild 未在线")

  const friend = wild.pickFriend(wildUserId)
  const ret = await withNoRoute(() => friend.sendMsg(prepareMsg(msg, "wild", qqbotBotId(qqbotUserId), options)))
  return recordRoutedMessage(ret, friend)
}

export async function sendQQBotFriendByWildId(wildUserId, msg, options = {}) {
  const qqbot = findBot("qqbot")
  if (!qqbot?.pickFriend) throw new Error("QQBot 未在线")
  const qqbotUserId = reverseMappedValue(config.users, wildUserId, botSelfId(qqbot))
  if (!qqbotUserId) throw new MissingIdentityMapError(wildUserId)

  const friend = qqbot.pickFriend(qqbotUserId)
  const ret = await withNoRoute(() => friend.sendMsg(prepareMsg(msg, "qqbot", botSelfId(qqbot), options)))
  return recordRoutedMessage(ret, friend)
}

async function sendQQBotFriend(e, msg, options) {
  return sendQQBotFriendByWildId(e?.user_id, msg, options)
}

async function sendWildFriend(e, msg, options) {
  return sendWildFriendByQQBotId(qqbotUserKey(e), msg, options)
}

export async function sendQQBot(e, msg, options = {}) {
  options = { ...options, event: e }
  if (e?.isGroup || e?.message_type === "group") return sendQQBotGroupByWildId(e?.group_id, msg, options)
  if (e?.isPrivate || e?.message_type === "private") return sendQQBotFriend(e, msg, options)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}

export async function sendWild(e, msg, options = {}) {
  options = { ...options, event: e }
  if (e?.isGroup || e?.message_type === "group") return sendWildGroupByQQBotId(qqbotGroupKey(e), msg, options)
  if (e?.isPrivate || e?.message_type === "private") return sendWildFriend(e, msg, options)
  throw new MissingIdentityMapError(e?.group_id || e?.user_id || "unknown")
}
