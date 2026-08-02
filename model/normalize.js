import { normalizeQQBotId } from "./identity.js"

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const text = value.trim().toLowerCase()
    if (["false", "0", "off", "no", "关闭"].includes(text)) return false
    if (["true", "1", "on", "yes", "开启"].includes(text)) return true
  }
  return value === undefined ? fallback : Boolean(value)
}

function normalizeOptionalProtocol(value) {
  value = String(value || "").trim().toLowerCase()
  return ["qqbot", "wild"].includes(value) ? value : ""
}

function normalizeMode(value) {
  value = String(value || "").trim().toLowerCase()
  return ["black", "white"].includes(value) ? value : "black"
}

function normalizeOfflineMode(value) {
  value = String(value || "").trim().toLowerCase()
  return ["bypass", "bypass_active", "block_only", "block_active"].includes(value) ? value : "bypass"
}

export function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (value === undefined || value === null || value === "") return []
  return String(value)
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeQQBotList(value) {
  return normalizeList(value).map(normalizeQQBotId)
}

function normalizeCommandList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (!item || typeof item !== "object") return null
      return {
        match: ["starts", "contains", "equals", "regex"].includes(item.match) ? item.match : "starts",
        texts: normalizeList(item.texts),
      }
    })
    .filter(item => item?.texts?.length)
}

function normalizeSendCommandRules(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => ({
      match: ["starts", "contains", "equals", "regex"].includes(item?.match) ? item.match : "starts",
      texts: normalizeList(item?.texts),
      protocol: normalizeOptionalProtocol(item?.protocol),
    }))
    .filter(item => item.texts.length)
}

function normalizeReceive(config, defaultConfig, protocol) {
  const defaults = defaultConfig.receive[protocol]
  if (!config.receive[protocol] || typeof config.receive[protocol] !== "object") {
    config.receive[protocol] = structuredClone(defaults)
  }
  const source = config.receive[protocol]
  config.receive[protocol] = structuredClone(defaults)
  for (const key of Object.keys(defaults)) {
    if (Object.hasOwn(source, key)) config.receive[protocol][key] = source[key]
  }
  config.receive[protocol].block = normalizeBoolean(config.receive[protocol].block, defaults.block)
  config.receive[protocol].command_allow_rules = normalizeCommandList(config.receive[protocol].command_allow_rules)
  const normalizeIdList = protocol === "qqbot" ? normalizeQQBotList : normalizeList
  config.receive[protocol].user_allow_list = normalizeIdList(config.receive[protocol].user_allow_list)
  config.receive[protocol].group_mode = normalizeMode(config.receive[protocol].group_mode)
  config.receive[protocol].group_list = normalizeIdList(config.receive[protocol].group_list)
  config.receive[protocol].user_mode = normalizeMode(config.receive[protocol].user_mode)
  config.receive[protocol].user_list = normalizeIdList(config.receive[protocol].user_list)
}

function normalizeMap(value) {
  const map = {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [from, to] of Object.entries(value)) {
      const key = normalizeQQBotId(String(from || "").trim())
      const val = String(to || "").trim()
      if (key && val) map[key] = val
    }
  }
  return map
}

export function normalizeConfig(config, defaultConfig) {
  config.enable = normalizeBoolean(config.enable, true)
  config.block_unselected_protocols = normalizeBoolean(config.block_unselected_protocols, false)
  config.block_peer_bot_messages = normalizeBoolean(config.block_peer_bot_messages, true)
  config.single_protocol_at_messages = normalizeBoolean(config.single_protocol_at_messages, true)
  config.qqbot_user_id_conversion = normalizeBoolean(config.qqbot_user_id_conversion, false)
  config.block_unmapped_qqbot_users = normalizeBoolean(config.block_unmapped_qqbot_users, false)
  config.protocols.qqbot.adapter = String(config.protocols.qqbot.adapter || "QQBot").trim()
  config.protocols.wild.adapter = String(config.protocols.wild.adapter || "").trim()
  config.protocols.qqbot.self_id = String(config.protocols.qqbot.self_id || "").trim()
  config.protocols.wild.self_id = String(config.protocols.wild.self_id || "").trim()
  config.response_prefixes ||= {}
  config.response_prefixes.qqbot = normalizeList(config.response_prefixes.qqbot)
  config.response_prefixes.wild = normalizeList(config.response_prefixes.wild)
  config.runtime ||= {}
  config.runtime.offline_mode = normalizeOfflineMode(config.runtime.offline_mode)
  normalizeReceive(config, defaultConfig, "qqbot")
  normalizeReceive(config, defaultConfig, "wild")
  const sendSource = config.send && typeof config.send === "object" ? config.send : {}
  config.send = structuredClone(defaultConfig.send)
  for (const key of Object.keys(defaultConfig.send)) {
    if (Object.hasOwn(sendSource, key)) config.send[key] = sendSource[key]
  }
  config.send.enable = normalizeBoolean(config.send.enable, defaultConfig.send.enable)
  config.send.default = normalizeOptionalProtocol(config.send.default)
  config.send.failover = normalizeBoolean(config.send.failover, true)
  if (!config.send.active_message || typeof config.send.active_message !== "object") {
    config.send.active_message = structuredClone(defaultConfig.send.active_message)
  }
  config.send.active_message.enable = normalizeBoolean(config.send.active_message.enable, false)
  for (const type of ["text", "image", "image_text", "markdown", "button", "file", "record", "video", "link"]) {
    config.send[type] = normalizeOptionalProtocol(config.send[type])
  }
  config.send.node = normalizeOptionalProtocol(config.send.node)
  config.send.forward = normalizeOptionalProtocol(config.send.forward)
  config.send.command_rules = normalizeSendCommandRules(config.send.command_rules)
  config.groups = normalizeMap(config.groups)
  config.users = normalizeMap(config.users)
}
