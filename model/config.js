import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeConfig } from "./normalize.js"
import { validateConfig } from "./validate.js"
import { parseSimpleYaml, quote, stringifyCommandRules, stringifyGroups, stringifyList } from "./yaml.js"

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
  block_unselected_protocols: false,
  block_peer_bot_messages: true,
  protocols: {
    qqbot: {
      adapter: "QQBot",
      self_id: "",
    },
    wild: {
      adapter: "",
      self_id: "",
    },
  },
  response_prefixes: {
    qqbot: [],
    wild: [],
  },
  receive: {
    qqbot: {
      block: false,
      command_allow_rules: defaultCommandAllowRules(),
      user_allow_list: [],
      user_mode: "black",
      user_list: [],
      group_mode: "white",
      group_list: [],
    },
    wild: {
      block: false,
      command_allow_rules: defaultCommandAllowRules(),
      user_allow_list: [],
      user_mode: "black",
      user_list: [],
      group_mode: "white",
      group_list: [],
    },
  },
  runtime: {
    offline_mode: "bypass",
  },
  send: {
    enable: false,
    default: "",
    failover: true,
    active_message: {
      enable: false,
    },
    text: "qqbot",
    image: "qqbot",
    image_text: "qqbot",
    record: "",
    video: "",
    file: "wild",
    button: "qqbot",
    markdown: "qqbot",
    node: "wild",
    forward: "wild",
    link: "",
    command_rules: [],
  },
  identity: {},
  groups: {},
  users: {},
}

export const config = structuredClone(defaultConfig)

function defaultCommandAllowRules() {
  return [
    {
      match: "regex",
      texts: [
        "^#[Qq][Ww](?:查看|查询)[Ii][Dd]",
        "^#[Qq][Ww]绑定群聊",
        "^#[Qq][Ww]取消绑定群聊",
      ],
    },
  ]
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

  validateConfig(config)
  normalizeConfig(config, defaultConfig)
  return config
}

await loadConfig()

function stringifyBasicConfig() {
  return `# QWild 基础设置
# 插件总开关。关闭后不接管接收阻断和发送分流。
enable: ${config.enable}

# 阻断未接管协议：只影响群聊，非 QQBot/Wild 协议不受影响。
block_unselected_protocols: ${config.block_unselected_protocols}

# 阻断对方Bot消息：仅群聊生效，阻断另一协议机器人发送的消息，避免双协议互相触发。
block_peer_bot_messages: ${config.block_peer_bot_messages}

# 协议识别与机器人选择。
# QQBot adapter 默认为 QQBot；Wild adapter 留空时自动选择在线的野生协议端。
# self_id 留空时自动选择在线的对应协议机器人。
protocols:
  qqbot:
    adapter: ${quote(config.protocols.qqbot.adapter)}
    self_id: ${quote(config.protocols.qqbot.self_id)}
  wild:
    adapter: ${quote(config.protocols.wild.adapter)}
    self_id: ${quote(config.protocols.wild.self_id)}

# 响应前缀：仅群聊生效，配置后未艾特机器人时必须带前缀才会进入云崽，命中后会自动去除前缀。
# 艾特机器人时不要求前缀；留空表示不限制。
response_prefixes:
  qqbot: ${stringifyList(config.response_prefixes.qqbot)}
  wild: ${stringifyList(config.response_prefixes.wild)}

# 离线处理模式：任一协议离线时，QWild 如何处理接收和发送。
# bypass：全部旁路，接收控制和发送分流都暂停。
# bypass_active：全部旁路，主动消息会尝试切到另一在线协议。
# block_only：发送分流旁路，接收控制继续生效。
# block_active：发送分流旁路，主动消息会尝试切到另一在线协议。
runtime:
  offline_mode: ${quote(config.runtime.offline_mode)}
`
}

function stringifyReceiveConfig() {
  return `# QWild 接收控制
# block 为 true 时启用接收控制；命中用户或群聊阻断范围后，可通过命令放行规则穿透。
# group_mode / user_mode 可选 black 或 white。
# black：黑名单模式，名单内阻断，名单外放行；空名单表示全部放行。
# white：白名单模式，名单内放行，名单外阻断；空名单表示全部阻断。
# user_allow_list：用户放行名单，命中后直接放行，不再判断用户和群聊过滤。
# user_list：用户名单。QQBot 填 BotID:UserID，Wild 填 QQ号。
# group_list：群聊名单。QQBot 填 BotID:GroupID，Wild 填 QQ群号。
# command_allow_rules：命令放行规则，会话被阻断时，命中任一 texts 命令则放行。
qqbot:
  block: ${config.receive.qqbot.block}
  user_allow_list: ${stringifyList(config.receive.qqbot.user_allow_list)}
  user_mode: ${quote(config.receive.qqbot.user_mode)}
  user_list: ${stringifyList(config.receive.qqbot.user_list)}
  group_mode: ${quote(config.receive.qqbot.group_mode)}
  group_list: ${stringifyList(config.receive.qqbot.group_list)}
  command_allow_rules: ${stringifyCommandRules(config.receive.qqbot.command_allow_rules)}
wild:
  block: ${config.receive.wild.block}
  user_allow_list: ${stringifyList(config.receive.wild.user_allow_list)}
  user_mode: ${quote(config.receive.wild.user_mode)}
  user_list: ${stringifyList(config.receive.wild.user_list)}
  group_mode: ${quote(config.receive.wild.group_mode)}
  group_list: ${stringifyList(config.receive.wild.group_list)}
  command_allow_rules: ${stringifyCommandRules(config.receive.wild.command_allow_rules)}
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
record: ${quote(config.send.record)}
video: ${quote(config.send.video)}
file: ${quote(config.send.file)}
button: ${quote(config.send.button)}
markdown: ${quote(config.send.markdown)}
node: ${quote(config.send.node)}
forward: ${quote(config.send.forward)}
link: ${quote(config.send.link)}

# 命令分流优先级高于消息类型分流。
# match 可选 starts / contains / equals / regex，texts 可填写多个命令，protocol 可选 qqbot / wild / 留空。
# protocol 留空表示命中后仍走原协议。
command_rules: ${stringifyCommandRules(config.send.command_rules, true)}
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
  normalizeConfig(config, defaultConfig)
  await fs.mkdir(configDir, { recursive: true })
  await fs.mkdir(defaultConfigDir, { recursive: true })
  await fs.writeFile(configFiles.basic.user, stringifyBasicConfig(), "utf8")
  await fs.writeFile(configFiles.receive.user, stringifyReceiveConfig(), "utf8")
  await fs.writeFile(configFiles.send.user, stringifySendConfig(), "utf8")
  await fs.writeFile(configFiles.identity.user, stringifyIdentityConfig(), "utf8")
}
