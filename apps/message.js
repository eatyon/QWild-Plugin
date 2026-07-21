import { config } from "../model/config.js"

export function messageTypes(msg, types = new Set()) {
  for (const item of Array.isArray(msg) ? msg : [msg]) {
    if (typeof item === "string") {
      types.add("text")
      continue
    }
    if (!item || typeof item !== "object") continue
    if (item.type) types.add(item.type)
    if (Array.isArray(item.data)) messageTypes(item.data, types)
    if (Array.isArray(item.message)) messageTypes(item.message, types)
  }
  return types
}

function messageTexts(msg, texts = []) {
  for (const item of Array.isArray(msg) ? msg : [msg]) {
    if (typeof item === "string") {
      texts.push(item)
      continue
    }
    if (!item || typeof item !== "object") continue
    if (item.type === "text") texts.push(item.text ?? item.data?.text ?? "")
    if (Array.isArray(item.data)) messageTexts(item.data, texts)
    if (Array.isArray(item.message)) messageTexts(item.message, texts)
  }
  return texts
}

function hasLink(msg) {
  return messageTexts(msg).some(text => /https?:\/\/[^\s]+/i.test(String(text || "")))
}

function commandTexts(e) {
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

  return [parts.join(""), textParts.join(""), e?.msg, e?.raw_message]
    .map(text => String(text || "").trim())
    .filter(Boolean)
    .filter((text, index, array) => array.indexOf(text) === index)
}

function matchCommandRule(texts, rule) {
  const text = String(rule?.text || "").trim()
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

function commandProtocol(e) {
  const texts = commandTexts(e)
  if (!texts.length) return null
  const rule = (config.send.command_rules || []).find(item => matchCommandRule(texts, item))
  return rule ? rule.protocol || "" : null
}

export function targetProtocol(msg, e) {
  const commandTarget = e ? commandProtocol(e) : null
  if (commandTarget !== null) return commandTarget

  const types = messageTypes(msg)
  if (types.has("node")) return config.send.node
  if (types.has("forward")) return config.send.forward
  if (types.has("markdown")) return config.send.markdown
  if (types.has("button") || types.has("keyboard")) return config.send.button
  if (types.has("file")) return config.send.file
  if (types.has("video")) return config.send.video
  if (types.has("record")) return config.send.record
  if (types.has("image") && types.has("text")) return config.send.image_text
  if (types.has("image")) return config.send.image
  if (types.has("text") && hasLink(msg)) return config.send.link
  if (types.has("text")) return config.send.text
  return config.send.default
}

export function otherProtocol(protocol) {
  return protocol === "onebot" ? "qqbot" : "onebot"
}

export function isSendSuccess(ret) {
  if (!ret) return false
  if (ret === false) return false
  if (Array.isArray(ret)) return ret.length > 0
  if (Array.isArray(ret?.error) && ret.error.length) return false
  if (Array.isArray(ret?.data) && !ret.data.length && !ret.message_id?.length) return false
  return true
}

export function stripReply(msg) {
  if (!Array.isArray(msg)) {
    if (msg?.type === "reply") return ""
    return msg
  }

  const next = msg
    .map(item => {
      if (item?.type === "reply") return null
      if (item?.type === "node" && Array.isArray(item.data)) {
        return {
          ...item,
          data: item.data.map(node => {
            if (!Array.isArray(node?.message)) return node
            return { ...node, message: stripReply(node.message) }
          }),
        }
      }
      return item
    })
    .filter(Boolean)

  return next.length ? next : ""
}
