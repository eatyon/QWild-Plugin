import { config } from "../model/config.js"
import { mappedValue, qqbotId, reverseMappedValue } from "../model/identity.js"
import { mapAtMsg } from "./sender.js"
import { isQWildCommand } from "./receive.js"

const mappedReplyFlag = Symbol.for("QWild.Plugin.MappedReplyPatched")

function botId(e) {
  return String(e?.self_id || e?.bot?.uin || e?.bot?.self_id || "")
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
  if (!config.qqbot_user_id_conversion || !config.block_unmapped_qqbot_users) return false
  if (protocol !== "qqbot" || !e?.post_type || isQWildCommand(e)) return false

  const sourceUserId = qqbotId(botId(e), e?.user_id)
  return Boolean(sourceUserId && !mappedValue(config.users, sourceUserId))
}

export function mapIncomingUser(e, protocol) {
  if (!config.qqbot_user_id_conversion || protocol !== "qqbot" || !e?.post_type || isQWildCommand(e)) return e

  const selfId = botId(e)
  const sourceUserId = qqbotId(selfId, e?.user_id)
  const mappedUserId = sourceUserId && mappedValue(config.users, sourceUserId)
  const mappedAt = mapAtMessage(e, selfId)
  if (!mappedUserId && !mappedAt.changed) return e

  const next = Object.create(e)
  next.qwild_source_event = e
  next.qwild_source_user_id = sourceUserId
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
  return next
}

export function patchMappedQQBotReply(e) {
  if (!e?.qwild_source_event || e[mappedReplyFlag] || !e?.reply?.bind) return

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
