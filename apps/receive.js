import { config } from "../model/config.js"
import { qqbotId } from "../model/identity.js"

function listIncludes(list, id) {
  id = String(id || "")
  return (list || []).some(item => String(item) === id)
}

function eventId(e, protocol, type) {
  const id = type === "group" ? e?.group_id : e?.user_id
  if (protocol !== "qqbot") return String(id || "")
  return qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, id)
}

function currentBotIds(e) {
  return [
    e?.self_id,
    e?.bot?.uin,
    e?.bot?.self_id,
  ].map(id => String(id || "")).filter(Boolean)
}

function atId(item) {
  return String(item?.qq || item?.user_id || item?.data?.qq || item?.data?.user_id || "")
}

function isAtBot(e) {
  if (e?.atBot) return true
  const ids = currentBotIds(e)
  if (!ids.length) return false
  return (e?.message || []).some(item => item?.type === "at" && ids.includes(atId(item)))
}

function stripPrefixText(text, prefixes) {
  text = String(text || "")
  const space = text.match(/^\s*/)?.[0] || ""
  const body = text.slice(space.length)
  const prefix = prefixes.find(item => body.startsWith(item))
  if (!prefix) return null
  return `${space}${body.slice(prefix.length)}`
}

function setTextItem(item, text) {
  if (typeof item === "string") return text
  const next = { ...item }
  if ("text" in next) next.text = text
  if (next.data && typeof next.data === "object" && !Array.isArray(next.data)) {
    next.data = { ...next.data, text }
  }
  return next
}

function applyResponsePrefix(e, protocol) {
  if (e?._qwildPrefixChecked) return e._qwildPrefixAllowed
  if (!(e?.isGroup || e?.message_type === "group")) {
    e._qwildPrefixChecked = true
    e._qwildPrefixAllowed = true
    return true
  }
  const prefixes = (config.response_prefixes?.[protocol] || [])
    .map(item => String(item || "").trim())
    .filter(Boolean)
  e._qwildPrefixChecked = true
  if (!prefixes.length || isAtBot(e)) {
    e._qwildPrefixAllowed = true
    return true
  }

  const message = Array.isArray(e?.message) ? e.message : []
  for (let index = 0; index < message.length; index++) {
    const item = message[index]
    if (typeof item !== "string" && item?.type !== "text") continue
    const text = typeof item === "string" ? item : item.text ?? item.data?.text ?? ""
    const nextText = stripPrefixText(text, prefixes)
    if (nextText === null) {
      e._qwildPrefixAllowed = false
      return false
    }

    e.message = [...message]
    e.message[index] = setTextItem(item, nextText)
    const msg = stripPrefixText(e.msg, prefixes) ?? nextText.trim()
    e.raw_message = stripPrefixText(e.raw_message, prefixes) ?? msg
    delete e.msg
    delete e._qwildCommandText
    e._qwildPrefixAllowed = true
    return true
  }

  const nextText = stripPrefixText(e?.msg || e?.raw_message || "", prefixes)
  if (nextText === null) {
    e._qwildPrefixAllowed = false
    return false
  }
  e.msg = nextText.trim()
  e.raw_message = e.msg
  delete e._qwildCommandText
  e._qwildPrefixAllowed = true
  return true
}

function commandText(e) {
  if (e._qwildCommandText) return e._qwildCommandText

  const parts = []
  const textParts = []
  for (const item of e?.message || []) {
    if (typeof item === "string") {
      parts.push(item)
      textParts.push(item)
      continue
    }
    if (item?.type === "text") {
      const text = item.text ?? item.data?.text ?? ""
      parts.push(text)
      textParts.push(text)
    } else if (item?.type === "at") {
      parts.push(`@${item.qq || item.user_id || item.data?.qq || item.data?.user_id || ""}`)
    }
  }

  const fullText = parts.join("").trim()
  const textOnly = textParts.join("").trim()
  const rawText = String(e?.raw_message || "").trim()
  const texts = [fullText, textOnly, rawText].filter(Boolean)
  e._qwildCommandText = [...new Set(texts)]
  return e._qwildCommandText
}

export function isBindingCommand(e) {
  return commandText(e).some(text => /^#[Qq][Ww](?:绑定|取消绑定)(?:群聊|用户)(?:\s|$)/.test(text))
}

function matchCommand(e, rules) {
  if (!rules?.length) return false
  const texts = commandText(e)
  return rules.some(rule => matchCommandRule(rule, texts))
}

function matchCommandRule(rule, texts) {
  const patterns = Array.isArray(rule?.texts)
    ? rule.texts.map(item => String(item || "").trim()).filter(Boolean)
    : []
  if (!patterns.length) return false

  switch (rule.match) {
    case "contains":
      return patterns.some(pattern => texts.some(item => item.includes(pattern)))
    case "equals":
      return patterns.some(pattern => texts.some(item => item === pattern))
    case "regex":
      return patterns.some(pattern => {
        try {
          const reg = new RegExp(pattern)
          return texts.some(item => reg.test(item))
        } catch {
          return false
        }
      })
    case "starts":
    default:
      return patterns.some(pattern => texts.some(item => item.startsWith(pattern)))
  }
}

export function shouldBlockReceive(e, protocol) {
  const rule = config.receive[protocol]
  if (!rule) return false
  const bypassResponsePrefix = isBindingCommand(e)

  if (!rule.block) return bypassResponsePrefix ? false : !applyResponsePrefix(e, protocol)

  let blocked = false

  const userId = eventId(e, protocol, "user")
  const groupId = eventId(e, protocol, "group")
  if (!listIncludes(rule.user_allow_list, userId)) {
    const userHit = listIncludes(rule.user_list, userId)
    blocked = rule.user_mode === "white" ? !userHit : userHit

    if (e?.isGroup || e?.message_type === "group") {
      const groupHit = listIncludes(rule.group_list, groupId)
      const groupBlocked = rule.group_mode === "white" ? !groupHit : groupHit
      blocked = blocked || groupBlocked
    }
  }

  if (!bypassResponsePrefix && !applyResponsePrefix(e, protocol)) return true

  if (!blocked) return false
  if (matchCommand(e, rule.command_allow_rules)) return false

  return true
}
