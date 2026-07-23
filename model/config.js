import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, "..")

export const configDir = path.join(pluginRoot, "config")
export const defaultConfigDir = path.join(configDir, "default")

const configFiles = {
  basic: {
    default: path.join(defaultConfigDir, "basic_default.yaml"),
    user: path.join(configDir, "basic.yaml"),
  },
  receive: {
    default: path.join(defaultConfigDir, "receive_default.yaml"),
    user: path.join(configDir, "receive.yaml"),
  },
  send: {
    default: path.join(defaultConfigDir, "send_default.yaml"),
    user: path.join(configDir, "send.yaml"),
  },
  identity: {
    default: path.join(defaultConfigDir, "identity_default.yaml"),
    user: path.join(configDir, "identity.yaml"),
  },
}

export const defaultConfig = {
  enable: true,
  protocols: {
    qqbot: {
      adapter: "QQBot",
      self_id: "",
    },
    onebot: {
      adapter: "OneBotv11",
      self_id: "",
    },
  },
  receive: {
    qqbot: {
      block: false,
      command_allow_rules: [],
      group_mode: "black",
      group_list: [],
      user_mode: "black",
      user_list: [],
    },
    onebot: {
      block: false,
      command_allow_rules: [],
      group_mode: "black",
      group_list: [],
      user_mode: "black",
      user_list: [],
    },
  },
  runtime: {
    require_both_online: true,
  },
  send: {
    enable: true,
    default: "",
    failover: false,
    active_message: {
      enable: false,
    },
    text: "qqbot",
    image: "qqbot",
    image_text: "qqbot",
    markdown: "qqbot",
    button: "qqbot",
    file: "",
    record: "",
    video: "",
    node: "onebot",
    forward: "onebot",
    link: "",
    command_rules: [],
  },
  identity: {},
  groups: {},
  users: {},
}

export const config = structuredClone(defaultConfig)

function parseScalar(value) {
  value = String(value ?? "").trim()
  if (!value || value === "{}") return {}
  if (value === "[]") return []
  if (
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("{") && value.endsWith("}"))
  ) {
    try {
      return JSON.parse(value)
    } catch {}
  }
  if (value === "true") return true
  if (value === "false") return false
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

function stripComment(line) {
  let quote = ""
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? "" : quote || char
    }
    if (!quote && char === "#") return line.slice(0, i)
  }
  return line
}

function findKeySeparator(line) {
  let quote = ""
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quote = quote === char ? "" : quote || char
    }
    if (!quote && char === ":") return i
  }
  return -1
}

function parseSimpleYaml(text) {
  const root = {}
  const stack = [{ indent: -1, value: root }]

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = stripComment(rawLine).replace(/\s+$/, "")
    if (!line.trim()) continue

    const indent = line.match(/^\s*/)[0].length
    const body = line.trim()
    const index = findKeySeparator(body)
    if (index < 0) continue

    const key = parseScalar(body.slice(0, index))
    const rest = body.slice(index + 1).trim()

    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop()
    const parent = stack.at(-1).value
    parent[key] = rest ? parseScalar(rest) : {}
    if (!rest) stack.push({ indent, value: parent[key] })
  }

  return root
}

function mergeConfig(target, source) {
  if (!source || typeof source !== "object") return target
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {}
      mergeConfig(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const text = value.trim().toLowerCase()
    if (["false", "0", "off", "no", "关闭"].includes(text)) return false
    if (["true", "1", "on", "yes", "开启"].includes(text)) return true
  }
  return value === undefined ? fallback : Boolean(value)
}

function normalizeProtocol(value, fallback) {
  value = String(value || "").trim().toLowerCase()
  return ["qqbot", "onebot"].includes(value) ? value : fallback
}

function normalizeOptionalProtocol(value) {
  value = String(value || "").trim().toLowerCase()
  return ["qqbot", "onebot"].includes(value) ? value : ""
}

function normalizeMode(value) {
  value = String(value || "").trim().toLowerCase()
  return ["black", "white"].includes(value) ? value : "black"
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (value === undefined || value === null || value === "") return []
  return String(value)
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeCommandList(value) {
  if (!Array.isArray(value)) return normalizeList(value)
  return value
    .map(item => {
      if (!item || typeof item !== "object") return String(item || "").trim()
      return {
        match: ["starts", "contains", "equals", "regex"].includes(item.match) ? item.match : "starts",
        text: String(item.text || item.pattern || "").trim(),
      }
    })
    .filter(item => (typeof item === "string" ? item : item.text))
}

function normalizeSendCommandRules(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => ({
      match: ["starts", "contains", "equals", "regex"].includes(item?.match) ? item.match : "starts",
      text: String(item?.text || item?.pattern || "").trim(),
      protocol: normalizeOptionalProtocol(item?.protocol),
    }))
    .filter(item => item.text)
}

function normalizeReceive(protocol) {
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
  config.receive[protocol].group_mode = normalizeMode(config.receive[protocol].group_mode)
  config.receive[protocol].group_list = normalizeList(config.receive[protocol].group_list)
  config.receive[protocol].user_mode = normalizeMode(config.receive[protocol].user_mode)
  config.receive[protocol].user_list = normalizeList(config.receive[protocol].user_list)
}

function normalizeConfig() {
  config.enable = normalizeBoolean(config.enable, true)
  config.protocols.qqbot.adapter = String(config.protocols.qqbot.adapter || "QQBot").trim()
  config.protocols.onebot.adapter = String(config.protocols.onebot.adapter || "OneBotv11").trim()
  config.protocols.qqbot.self_id = String(config.protocols.qqbot.self_id || "").trim()
  config.protocols.onebot.self_id = String(config.protocols.onebot.self_id || "").trim()
  config.runtime ||= {}
  config.runtime.require_both_online = normalizeBoolean(config.runtime.require_both_online, true)
  normalizeReceive("qqbot")
  normalizeReceive("onebot")
  const sendSource = config.send && typeof config.send === "object" ? config.send : {}
  config.send = structuredClone(defaultConfig.send)
  for (const key of Object.keys(defaultConfig.send)) {
    if (Object.hasOwn(sendSource, key)) config.send[key] = sendSource[key]
  }
  config.send.enable = normalizeBoolean(config.send.enable, true)
  config.send.default = normalizeOptionalProtocol(config.send.default)
  config.send.failover = normalizeBoolean(config.send.failover, false)
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
  config.identity ||= {}

  config.groups = normalizeMap(config.groups)
  config.users = normalizeMap(config.users)
}

function normalizeMap(value) {
  const map = {}
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [from, to] of Object.entries(value)) {
      const key = String(from || "").trim()
      const val = String(to || "").trim()
      if (key && val) map[key] = val
    }
  }
  return map
}

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
    const text = String(rule.text || rule.pattern || "").trim()
    if (!validMatches.includes(match)) warn(`${label} 匹配方式无效：${rule.match}`)
    if (!text) warn(`${label} 命令内容为空`)
    if (match === "regex") validateRegex(label, text)
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
    const index = sourceId.indexOf(":")
    const botId = index >= 0 ? sourceId.slice(0, index) : ""
    const id = index >= 0 ? sourceId.slice(index + 1) : ""

    if (index < 0 || !botId || !id) {
      warn(`${label}格式异常：${source} 应为 BotID:ID，当前为 ${from}`)
    } else {
      if (!/^\d+$/.test(botId)) warn(`${label}格式异常：BotID 建议为纯数字，当前为 ${botId}`)
      const key = `${botId}:${targetId}`
      const previous = seenByBot.get(key)
      if (previous) warn(`${label}配置疑似重复：同一 BotID 下多个 ${source} 映射到 ${targetId}：${previous}、${from}`)
      else seenByBot.set(key, from)
    }

    if (!/^\d+$/.test(targetId)) warn(`${label}格式异常：${target} 应为纯数字，当前为 ${to}`)
  }
}

function validateConfig() {
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

async function readYaml(file) {
  try {
    return parseSimpleYaml(await fs.readFile(file, "utf8"))
  } catch {
    return {}
  }
}

function mergeModule(name, value) {
  if (!value || typeof value !== "object") return
  switch (name) {
    case "basic":
      mergeConfig(config, value)
      break
    case "receive":
      mergeConfig(config.receive, value.receive && typeof value.receive === "object" ? value.receive : value)
      break
    case "send":
      mergeConfig(config.send, value.send && typeof value.send === "object" ? value.send : value)
      break
    case "identity": {
      const identity =
        value.identity && typeof value.identity === "object"
          ? value.identity
          : Object.fromEntries(Object.entries(value).filter(([key]) => !["groups", "users"].includes(key)))
      mergeConfig(config.identity, identity)
      if (value.groups) config.groups = value.groups
      if (value.users) config.users = value.users
      break
    }
  }
}

export async function loadConfig() {
  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(defaultConfigDir, { recursive: true })

  for (const [name, files] of Object.entries(configFiles)) {
    mergeModule(name, await readYaml(files.default))
    const userConfig = await readYaml(files.user)
    if (Object.keys(userConfig).length) mergeModule(name, userConfig)
    else await fs.copyFile(files.default, files.user)
  }

  validateConfig()
  normalizeConfig()
  return config
}

await loadConfig()

function quote(value) {
  return JSON.stringify(String(value ?? ""))
}

function stringifyGroups(groups) {
  const entries = Object.entries(groups || {})
  if (!entries.length) return "{}"
  return `\n${entries.map(([key, value]) => `  ${quote(key)}: ${quote(value)}`).join("\n")}`
}

function stringifyList(list) {
  return JSON.stringify((list || []).map(item => String(item)))
}

function stringifyCommandList(list) {
  return JSON.stringify(list || [])
}

function stringifyBasicConfig() {
  return `# QWild 基础设置
# 插件总开关。关闭后不接管接收阻断和发送分流。
enable: ${config.enable}

# 协议识别与机器人选择。
# adapter 一般不用改；self_id 留空时自动选择在线的对应协议机器人。
protocols:
  qqbot:
    adapter: ${quote(config.protocols.qqbot.adapter)}
    self_id: ${quote(config.protocols.qqbot.self_id)}
  onebot:
    adapter: ${quote(config.protocols.onebot.adapter)}
    self_id: ${quote(config.protocols.onebot.self_id)}

# 离线旁路：开启后任一协议离线时，QWild 自动旁路，让云崽按原协议运行。
runtime:
  require_both_online: ${config.runtime.require_both_online}
`
}

function stringifyReceiveConfig() {
  return `# QWild 接收控制
# block 为 true 时启用接收控制；群聊和用户名单都为空时全局阻断。
# group_mode / user_mode 可选 black 或 white。
# black：黑名单模式，名单内阻断，名单外放行。
# white：白名单模式，只放行名单内，名单外阻断。
# group_list：群聊名单。QQBot 填 BotID:GroupID，OBv11 填 QQ群号。
# user_list：用户名单。QQBot 填 BotID:UserID，OBv11 填 QQ号。
# command_allow_rules：命令放行规则，通过群聊/用户过滤后，命中命令则放行。
qqbot:
  block: ${config.receive.qqbot.block}
  command_allow_rules: ${stringifyCommandList(config.receive.qqbot.command_allow_rules)}
  group_mode: ${quote(config.receive.qqbot.group_mode)}
  group_list: ${stringifyList(config.receive.qqbot.group_list)}
  user_mode: ${quote(config.receive.qqbot.user_mode)}
  user_list: ${stringifyList(config.receive.qqbot.user_list)}
onebot:
  block: ${config.receive.onebot.block}
  command_allow_rules: ${stringifyCommandList(config.receive.onebot.command_allow_rules)}
  group_mode: ${quote(config.receive.onebot.group_mode)}
  group_list: ${stringifyList(config.receive.onebot.group_list)}
  user_mode: ${quote(config.receive.onebot.user_mode)}
  user_list: ${stringifyList(config.receive.onebot.user_list)}
`
}

function stringifySendConfig() {
  return `# QWild 发送分流
# 开启后接管发送协议，缺少映射时自动走原协议。
enable: ${config.send.enable}

# 未知类型消息使用的协议；留空表示未知类型走原协议。
default: ${quote(config.send.default)}

# 目标协议发送失败时尝试另一协议，缺少身份映射不会触发切换。
failover: ${config.send.failover}

# 接管定时任务、插件主动群聊/私聊等非回复消息。
active_message:
  enable: ${config.send.active_message.enable}

# 以下类型留空表示不接管，直接走原协议。
text: ${quote(config.send.text)}
image: ${quote(config.send.image)}
image_text: ${quote(config.send.image_text)}
markdown: ${quote(config.send.markdown)}
button: ${quote(config.send.button)}
file: ${quote(config.send.file)}
record: ${quote(config.send.record)}
video: ${quote(config.send.video)}
node: ${quote(config.send.node)}
forward: ${quote(config.send.forward)}
link: ${quote(config.send.link)}

# 命令分流优先级高于消息类型分流。
# match 可选 starts / contains / equals / regex，protocol 可选 qqbot / onebot / 留空。
# protocol 留空表示命中后仍走原协议。
command_rules: ${JSON.stringify(config.send.command_rules || [])}
`
}

function stringifyIdentityConfig() {
  return `# QWild 身份映射
# 跨协议发送时，回复消息里的艾特对象会按用户映射自动转换；未配置映射时保持原样。
# 群聊映射：完整 QQBot群ID 与 群号 的对应关系。
# QQBot群ID必须是 BotID:GroupID。
groups: ${stringifyGroups(config.groups)}

# 用户映射：完整 QQBot用户ID 与 QQ号 的对应关系。
# QQBot用户ID必须是 BotID:UserID。
users: ${stringifyGroups(config.users)}
`
}

export async function configSave() {
  normalizeConfig()
  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(defaultConfigDir, { recursive: true })
  await fs.writeFile(configFiles.basic.user, stringifyBasicConfig(), "utf8")
  await fs.writeFile(configFiles.receive.user, stringifyReceiveConfig(), "utf8")
  await fs.writeFile(configFiles.send.user, stringifySendConfig(), "utf8")
  await fs.writeFile(configFiles.identity.user, stringifyIdentityConfig(), "utf8")
}
