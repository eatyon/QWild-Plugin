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

  const userHit = listIncludes(rule.user_list, e.user_id)
  let blocked = rule.user_mode === "white" ? !userHit : userHit

  if (e?.isGroup || e?.message_type === "group") {
    const groupHit = listIncludes(rule.group_list, e.group_id)
    const groupBlocked = rule.group_mode === "white" ? !groupHit : groupHit
    blocked = blocked || groupBlocked
  }

  if (!blocked) return false
  if (matchCommand(e, rule.command_allow_rules)) return false

  return true
}
