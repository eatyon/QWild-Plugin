import { config } from "../model/config.js"
import { mappedValue, qqbotId, reverseMappedValue } from "../model/identity.js"
import { mapAtMsg } from "./sender.js"
import { isQWildCommand } from "./receive.js"
import cfg from "../../../lib/config/config.js"

const mappedReplyFlag = Symbol.for("QWild.Plugin.MappedReplyPatched")

function botId(e) {
  return String(e?.self_id || e?.bot?.uin || e?.bot?.self_id || "")
}

function isGroupMessage(e) {
  return Boolean(e?.isGroup || e?.message_type === "group")
}

function isMaster(selfId, userId) {
  return Boolean(userId && cfg.master?.[selfId]?.includes(String(userId)))
}

function atId(item) {
  return String(item?.qq || item?.user_id || item?.data?.qq || item?.data?.user_id || "")
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

function isBotAt(item, selfId) {
  if (item?.is_you === true || item?.is_you === "true") return true
  if (item?.data?.is_you === true || item?.data?.is_you === "true") return true
  return atId(item) === selfId
}

function mapAtMessage(e, selfId) {
  let changed = false
  const message = (e?.message || []).map(item => {
    if (item?.type !== "at" || isBotAt(item, selfId)) return item
    const sourceId = qqbotId(selfId, atId(item))
    const mappedId = sourceId && mappedValue(config.users, sourceId)
    if (!mappedId) return item
    changed = true
    return setAtId(item, mappedId)
  })
  return { changed, message }
}

export function shouldBlockUnmappedQQBotUser(e, protocol) {
  if (config.qqbot_user_id_mode !== "block") return false
  if (protocol !== "qqbot" || !e?.post_type || isQWildCommand(e)) return false

  const sourceUserId = qqbotId(botId(e), e?.user_id)
  return Boolean(sourceUserId && !mappedValue(config.users, sourceUserId))
}

export function shouldBlockUnmappedQQBotGroup(e, protocol) {
  if (config.qqbot_group_id_mode !== "block") return false
  if (protocol !== "qqbot" || !e?.post_type || !isGroupMessage(e) || isQWildCommand(e)) return false

  const sourceGroupId = qqbotId(botId(e), e?.group_id)
  return Boolean(sourceGroupId && !mappedValue(config.groups, sourceGroupId))
}

export function mapIncomingIdentity(e, protocol) {
  const mapGroup = config.qqbot_group_id_mode !== "off" && isGroupMessage(e)
  const mapUser = config.qqbot_user_id_mode !== "off"
  if ((!mapGroup && !mapUser) || protocol !== "qqbot" || !e?.post_type || isQWildCommand(e)) return e

  const selfId = botId(e)
  const sourceUserId = qqbotId(selfId, e?.user_id)
  const mappedUserId = mapUser && sourceUserId && mappedValue(config.users, sourceUserId)
  const mappedAt = mapUser ? mapAtMessage(e, selfId) : { changed: false }
  const sourceGroupId = mapGroup ? qqbotId(selfId, e?.group_id) : ""
  const mappedGroupId = sourceGroupId && mappedValue(config.groups, sourceGroupId)
  if (!mappedGroupId && !mappedUserId && !mappedAt.changed) return e

  const next = Object.create(e)
  next.qwild_source_event = e
  if (mapUser) next.qwild_source_user_id = sourceUserId
  if (isMaster(selfId, sourceUserId)) next.isMaster = true
  if (mappedAt.changed) next.message = mappedAt.message
  if (mappedUserId) {
    Object.defineProperty(next, "user_id", {
      value: mappedUserId,
      writable: true,
      enumerable: true,
      configurable: true,
    })
    next.sender = { ...e.sender, user_id: mappedUserId }
  }
  if (mappedGroupId) {
    Object.defineProperty(next, "group_id", {
      value: mappedGroupId,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  return next
}

export function patchMappedQQBotReply(e) {
  if (!e?.qwild_source_event || !e?.qwild_source_user_id || e[mappedReplyFlag] || !e?.reply?.bind) return

  const source = e.qwild_source_event
  const selfId = botId(source)
  const baseReply = e.reply.bind(e)
  e.reply = async (msg = "", quote = false, data = {}) => {
    const nextData = { ...data }
    if (nextData.at === true) nextData.at = e.qwild_source_user_id
    else if (nextData.at) nextData.at = reverseMappedValue(config.users, nextData.at, selfId) || nextData.at
    return baseReply(mapAtMsg(msg, "qqbot", selfId), quote, nextData)
  }
  e[mappedReplyFlag] = true
}
