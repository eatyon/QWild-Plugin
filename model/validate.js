import { isQQBotId, isOneBotId, qqbotBotId, qqbotInnerId } from "./identity.js"
import { normalizeList } from "./normalize.js"

function warn(message) {
  globalThis.logger?.warn?.(`[QWild] ${message}`)
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === ""
}

function isValidProtocol(value) {
  return ["qqbot", "onebot"].includes(String(value || "").trim().toLowerCase())
}

function validateProtocolField(path, value) {
  if (isBlank(value)) return
  if (!isValidProtocol(value)) warn(`发送分流配置无效：${path} = ${value}`)
}

function validateRegex(path, pattern) {
  if (isBlank(pattern)) return
  try {
    new RegExp(String(pattern))
  } catch {
    warn(`${path} 正则无效：${pattern}`)
  }
}

function validateCommandRules(path, rules, checkProtocol = false) {
  if (!Array.isArray(rules)) return
  const validMatches = ["starts", "contains", "equals", "regex"]
  rules.forEach((rule, index) => {
    if (!rule || typeof rule !== "object") return
    const label = `${path}[${index}]`
    const match = String(rule.match || "starts").trim()
    const texts = normalizeList(rule.texts)
    if (!validMatches.includes(match)) warn(`${label} 匹配方式无效：${rule.match}`)
    if (!texts.length) warn(`${label} 命令内容为空`)
    if (match === "regex") texts.forEach((text, textIndex) => validateRegex(`${label}.texts[${textIndex}]`, text))
    if (checkProtocol) validateProtocolField(`${label}.protocol`, rule.protocol)
  })
}

function validateIdentityMap(type, map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return
  const label = type === "group" ? "群聊映射" : "用户映射"
  const target = type === "group" ? "群号" : "QQ号"
  const source = type === "group" ? "QQBot群ID" : "QQBot用户ID"
  const seenByBot = new Map()

  for (const [from, to] of Object.entries(map)) {
    const sourceId = String(from || "").trim()
    const targetId = String(to || "").trim()
    const botId = qqbotBotId(sourceId)
    const id = qqbotInnerId(sourceId)

    if (!isQQBotId(sourceId) || !botId || !id) {
      warn(`${label}格式异常：${source} 应为 BotID:ID，当前为 ${from}`)
    } else {
      if (!isOneBotId(botId)) warn(`${label}格式异常：BotID 建议为纯数字，当前为 ${botId}`)
      const key = `${botId}:${targetId}`
      const previous = seenByBot.get(key)
      if (previous) warn(`${label}配置疑似重复：同一 BotID 下多个 ${source} 映射到 ${targetId}：${previous}、${from}`)
      else seenByBot.set(key, from)
    }

    if (!isOneBotId(targetId)) warn(`${label}格式异常：${target} 应为纯数字，当前为 ${to}`)
  }
}

export function validateConfig(config) {
  for (const type of [
    "default",
    "text",
    "image",
    "image_text",
    "markdown",
    "button",
    "file",
    "record",
    "video",
    "node",
    "forward",
    "link",
  ]) {
    validateProtocolField(type, config.send?.[type])
  }

  validateCommandRules("命令分流", config.send?.command_rules, true)
  validateCommandRules("QQBot 命令放行规则", config.receive?.qqbot?.command_allow_rules)
  validateCommandRules("OBv11 命令放行规则", config.receive?.onebot?.command_allow_rules)
  validateIdentityMap("group", config.groups)
  validateIdentityMap("user", config.users)
}
