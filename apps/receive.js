import { config } from "../model/config.js"

function listIncludes(list, id) {
  id = String(id || "")
  return (list || []).some(item => String(item) === id)
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

function matchCommand(e, rules) {
  if (!rules?.length) return false
  const texts = commandText(e)
  return rules.some(rule => {
    if (rule && typeof rule === "object") return matchCommandRule(e, rule, texts)
    try {
      const reg = new RegExp(String(rule))
      return texts.some(text => reg.test(text))
    } catch {
      return texts.some(text => text.includes(String(rule)))
    }
  })
}

function matchCommandRule(e, rule, texts) {
  const text = String(rule.text || "").trim()
  if (!text) return false

  switch (rule.match) {
    case "contains":
      return texts.some(item => item.includes(text))
    case "equals":
      return texts.some(item => item === text)
    case "regex":
      try {
        const reg = new RegExp(text)
        return texts.some(item => reg.test(item))
      } catch {
        return false
      }
    case "starts":
    default:
      return texts.some(item => item.startsWith(text))
  }
}

export function isReceiveForceAllowed(e) {
  if (e?.isMaster === false) return false

  return commandText(e).some(text => {
    if (/^#[Qq][Ww](?:查看|查询)[Ii][Dd]$/.test(text)) return true
    if (!e?.isGroup && e?.message_type !== "group") return false
    return /^#[Qq][Ww](绑定群聊|取消绑定群聊)$/.test(text)
  })
}

export function shouldBlockReceive(e, protocol) {
  const rule = config.receive[protocol]
  if (!rule) return false

  if (!rule.block) return false

  const hasGroupList = Boolean(rule.group_list?.length)
  const hasUserList = Boolean(rule.user_list?.length)
  const hasFilterList = hasGroupList || hasUserList
  let blocked = !hasFilterList

  if (e?.isGroup || e?.message_type === "group") {
    const groupHit = listIncludes(rule.group_list, e.group_id)
    if (rule.group_mode === "white" && hasGroupList) {
      if (!groupHit) return true
      blocked = false
    } else if (rule.group_mode === "black" && groupHit) {
      return true
    }
  }

  const userHit = listIncludes(rule.user_list, e.user_id)
  if (rule.user_mode === "white" && hasUserList) {
    if (!userHit) return true
    blocked = false
  } else if (rule.user_mode === "black" && userHit) {
    return true
  }

  if (blocked && matchCommand(e, rule.command_allow_rules)) return false

  return blocked
}
