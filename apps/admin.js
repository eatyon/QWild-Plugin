import { createRequire } from "node:module"
import common from "../../../lib/common/common.js"
import { config, configSave } from "../model/config.js"
import { adapterName, eventProtocol, findBot, protocolStatus } from "./protocol.js"
import { findAllByValue, findMapping, isQQId, isQQBotId, parseMappingPair, qqbotId } from "../model/identity.js"

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

const pendingBinds = {
  group: null,
  user: null,
}
const pendingBindTTL = 30 * 1000

const pluginVersion = pkg.version ? `<span class="version">${pkg.version}</span>` : ""

function onOff(value) {
  return value ? "开启" : "关闭"
}

function setByAction(action) {
  return action === "开启"
}

function botStatus(protocol) {
  const bot = findBot(protocol)
  return bot ? "在线" : "离线"
}

function botId(protocol) {
  const bot = findBot(protocol)
  const selfId = config.protocols?.[protocol]?.self_id
  if (selfId) return String(selfId)
  return String(bot?.uin || bot?.self_id || "自动选择")
}

function statusType(value) {
  return value ? "ok" : "off"
}

function countMap(map) {
  return Object.keys(map || {}).length
}

function eventProtocolName(e, protocol = eventProtocol(e)) {
  if (protocol === "qqbot") return "QQBot"
  if (protocol === "wild") return adapterName(e?.bot) || "Wild"
  return "未知"
}

function routeName(protocol) {
  if (protocol === "qqbot") return "QQBot"
  if (protocol === "wild") return "Wild"
  return "原协议"
}

function isGroup(e) {
  return Boolean(e?.isGroup || e?.message_type === "group")
}

function isPrivate(e) {
  return Boolean(e?.isPrivate || e?.message_type === "private")
}

function isQQBotAtMessage(e) {
  return String(e?.raw?.event_id || "").split(":")[0] === "GROUP_AT_MESSAGE_CREATE"
}

function currentId(e, type, protocol = eventProtocol(e)) {
  const id = type === "group" ? e?.group_id : e?.user_id
  return protocol === "qqbot" ? qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, id) : String(id || "")
}

function messageAtId(item) {
  return String(item?.qq || item?.user_id || item?.data?.qq || item?.data?.user_id || "")
}

function atIds(e, protocol = eventProtocol(e)) {
  const ids = []
  for (const item of e?.message || []) {
    if (item?.type !== "at") continue
    const id = messageAtId(item)
    if (!id || id === "all") continue
    ids.push(protocol === "qqbot" ? qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, id) : String(id))
  }
  return [...new Set(ids)]
}

function isOnlyQQBotAt(ids) {
  const bot = findBot("qqbot")
  const botIds = [config.protocols?.qqbot?.self_id, bot?.uin, bot?.self_id]
    .map(id => String(id || ""))
    .filter(Boolean)
  const qqbotIds = new Set(botIds.flatMap(id => [id, qqbotId(id, id)]))
  return ids.length > 0 && ids.every(id => qqbotIds.has(id))
}

function messageText(e) {
  const texts = []
  for (const item of e?.message || []) {
    if (typeof item === "string") texts.push(item)
    else if (item?.type === "text") texts.push(item.text ?? item.data?.text ?? "")
  }
  return texts.join("").trim() || String(e?.msg || "").trim()
}

function otherProtocol(protocol) {
  return protocol === "qqbot" ? "Wild" : "QQBot"
}

function mapLabel(type) {
  return type === "group" ? "群聊" : "用户"
}

function mapText(pair) {
  return `${pair.qqbot} = ${pair.wild}`
}

function searchMap(map, keyword) {
  keyword = String(keyword || "")
  return Object.entries(map || {})
    .filter(([qqbot, wild]) => qqbot.includes(keyword) || String(wild).includes(keyword))
    .map(([qqbot, wild]) => ({ qqbot, wild }))
}

const mappingLinesPerNode = 50

function mapMessageNodes(list) {
  const lines = list.map((item, index) => `${index + 1}. ${mapText(item)}`)
  return lines
    .reduce((nodes, line, index) => {
      const nodeIndex = Math.floor(index / mappingLinesPerNode)
      if (!nodes[nodeIndex]) nodes[nodeIndex] = []
      nodes[nodeIndex].push(line)
      return nodes
    }, [])
    .map(lines => lines.join("\n"))
}

function currentQQBotId() {
  const bot = findBot("qqbot")
  return String(bot?.uin || bot?.self_id || "")
}

function hasCurrentQQBotValue(map, value) {
  const botId = currentQQBotId()
  if (!botId) return false
  return findAllByValue(map, value).some(([from]) => String(from).startsWith(`${botId}:`))
}

function currentRouteState(e, protocol) {
  if (!config.send.enable) return { value: "未启用", type: "off" }
  const type = isGroup(e) ? "group" : isPrivate(e) ? "user" : ""
  if (!type) return { value: "否", type: "off" }

  const map = type === "group" ? config.groups : config.users
  const id = currentId(e, type, protocol)
  const ok = protocol === "qqbot" ? Boolean(map[id]) : hasCurrentQQBotValue(map, id)
  return { value: ok ? "是" : "否", type: ok ? "ok" : "off" }
}

function addMapping(type, pair) {
  const map = type === "group" ? config.groups : config.users
  if (map[pair.qqbot]) return false
  map[pair.qqbot] = pair.wild
  return true
}

function deleteMapping(type, id) {
  const map = type === "group" ? config.groups : config.users
  const found = findMapping(map, id)
  if (!found) return null
  if (found.ambiguous) return found
  delete map[found[0]]
  return { qqbot: found[0], wild: found[1] }
}

function actionArg(msg, prefix) {
  return String(msg || "").replace(prefix, "").trim()
}

export class qwildAdmin extends plugin {
  constructor() {
    super({
      name: "QWild 管理",
      dsc: "QWild 管理命令",
      event: "message",
      priority: -999998,
      rule: [
        {
          reg: "^#[Qq][Ww]状态$",
          fnc: "status",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww](?:查看|查询)[Ii][Dd]$",
          fnc: "showId",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]搜索映射(?:\\s*.*)?$",
          fnc: "searchMap",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww](开启|关闭)$",
          fnc: "setPlugin",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]分流(开启|关闭)$",
          fnc: "setSend",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]阻断QQBot(开启|关闭)$",
          fnc: "setQQBotBlock",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]阻断Wild(开启|关闭)$",
          fnc: "setWildBlock",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]绑定群聊$",
          fnc: "bindGroup",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]取消绑定群聊$",
          fnc: "cancelBindGroup",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]添加群聊映射(?:\\s*.*)?$",
          fnc: "addGroupMap",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]删除群聊映射(?:\\s*.*)?$",
          fnc: "deleteGroupMap",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]绑定用户(?:\\s*.*)?$",
          fnc: "bindUser",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]取消绑定用户$",
          fnc: "cancelBindUser",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]添加用户映射(?:\\s*.*)?$",
          fnc: "addUserMap",
          permission: "master",
        },
        {
          reg: "^#[Qq][Ww]删除用户映射(?:\\s*.*)?$",
          fnc: "deleteUserMap",
          permission: "master",
        },
      ],
    })
  }

  replyCurrent(message) {
    return this.reply(message, true, { qwild_no_route: true })
  }

  async saveAndReply(message) {
    await configSave()
    return this.reply(message, true)
  }

  async status() {
    const protocol = eventProtocol(this.e)
    const status = protocolStatus()
    const qqbotOnline = status.qqbot
    const wildOnline = status.wild
    const statusGroups = [
      {
        group: "运行状态",
        list: [
          { title: "总开关", value: onOff(config.enable), type: statusType(config.enable) },
          { title: "接收协议", value: eventProtocolName(this.e, protocol), type: protocol ? "ok" : "off" },
          { title: "QQBot", value: botStatus("qqbot"), type: statusType(qqbotOnline) },
          { title: "QQBot 账号", value: botId("qqbot"), type: qqbotOnline ? "ok" : "off" },
          { title: "Wild", value: botStatus("wild"), type: statusType(wildOnline) },
          { title: "Wild 账号", value: botId("wild"), type: wildOnline ? "ok" : "off" },
        ],
      },
      {
        group: "接收与发送",
        list: [
          { title: "发送分流", value: onOff(config.send.enable), type: statusType(config.send.enable) },
          { title: "当前会话接管", ...currentRouteState(this.e, protocol) },
          { title: "QQBot 接收阻断", value: onOff(config.receive.qqbot.block), type: statusType(config.receive.qqbot.block) },
          { title: "Wild 接收阻断", value: onOff(config.receive.wild.block), type: statusType(config.receive.wild.block) },
          { title: "主动消息接管", value: onOff(config.send.active_message?.enable), type: statusType(config.send.active_message?.enable) },
          { title: "发送失败切换", value: onOff(config.send.failover), type: statusType(config.send.failover) },
        ],
      },
      {
        group: "发送分流概览",
        list: [
          { title: "文本消息", value: routeName(config.send.text), type: "route" },
          { title: "图片消息", value: routeName(config.send.image), type: "route" },
          { title: "图文消息", value: routeName(config.send.image_text), type: "route" },
          { title: "语音消息", value: routeName(config.send.record), type: "route" },
          { title: "视频消息", value: routeName(config.send.video), type: "route" },
          { title: "文件消息", value: routeName(config.send.file), type: "route" },
          { title: "按钮消息", value: routeName(config.send.button), type: "route" },
          { title: "Markdown 消息", value: routeName(config.send.markdown), type: "route" },
          { title: "合并转发消息", value: routeName(config.send.node), type: "route" },
          { title: "Forward 消息", value: routeName(config.send.forward), type: "route" },
          { title: "链接消息", value: routeName(config.send.link), type: "route" },
          { title: "未知类型", value: routeName(config.send.default), type: "route" },
        ],
      },
      {
        group: "身份映射",
        list: [
          { title: "用户映射", value: `${countMap(config.users)} 个`, type: "route" },
          { title: "群聊映射", value: `${countMap(config.groups)} 个`, type: "route" },
        ],
      },
    ]

    const text = statusGroups
      .flatMap(group => [group.group, ...group.list.map(item => `${item.title}：${item.value}`)])
      .join("\n")

    if (!this.e.runtime) return this.reply(text, true)

    return this.e.runtime.render(
      "QWild-Plugin",
      "status/index",
      {
        helpCfg: {
          title: "QWild 状态",
          subTitle: "Yunzai-Bot & QWild-Plugin",
          colCount: 2,
        },
        statusGroups,
      },
      {
        beforeRender({ data }) {
          return {
            ...data,
            copyright: `${data.copyright || "Created By TRSS-Yunzai"} & QWild-Plugin${pluginVersion}`,
            sys: {
              ...data.sys,
              scale: 1.15,
            },
          }
        },
      },
    )
  }

  async searchMap() {
    const keyword = actionArg(this.e.msg, /^#[Qq][Ww]搜索映射/)
    if (!keyword) return this.reply("请填写搜索内容\n示例：#QW搜索映射 123456789", true)

    const groups = searchMap(config.groups, keyword)
    const users = searchMap(config.users, keyword)
    if (!groups.length && !users.length) return this.reply(`未找到相关映射：${keyword}`, true)

    const nodes = [
      [`用户映射：${users.length} 条`, `群聊映射：${groups.length} 条`].join("\n"),
    ]
    if (users.length) nodes.push("用户映射：", ...mapMessageNodes(users))
    if (groups.length) nodes.push("群聊映射：", ...mapMessageNodes(groups))

    const msg = await common.makeForwardMsg(this.e, nodes, `QWild 映射搜索：${keyword}`)
    return this.reply(msg)
  }

  showId() {
    const protocol = eventProtocol(this.e)
    const lines = [`当前协议：${eventProtocolName(this.e, protocol)}`]

    if (isGroup(this.e)) lines.push(`群聊ID：${currentId(this.e, "group", protocol)}`)
    if (this.e?.user_id) lines.push(`用户ID：${currentId(this.e, "user", protocol)}`)
    const at = atIds(this.e, protocol)
    if (at.length === 1) lines.push(`艾特对象ID：${at[0]}`)
    else if (at.length > 1) lines.push(["艾特对象ID：", ...at].join("\n"))
    if (protocol === "qqbot" && isGroup(this.e) && isQQBotAtMessage(this.e)) {
      lines.push("查看艾特对象ID需开启 QQBot 获取群内全部消息")
    }

    return this.replyCurrent(lines.join("\n"))
  }

  async setSend() {
    config.send.enable = setByAction(this.e.msg.match(/(开启|关闭)$/)?.[1])
    return this.saveAndReply(`QWild 发送分流已${onOff(config.send.enable)}`)
  }

  async setPlugin() {
    config.enable = setByAction(this.e.msg.match(/(开启|关闭)$/)?.[1])
    return this.saveAndReply(`QWild 总开关已${onOff(config.enable)}`)
  }

  async setQQBotBlock() {
    config.receive.qqbot.block = setByAction(this.e.msg.match(/(开启|关闭)$/)?.[1])
    return this.saveAndReply(`QWild QQBot 接收阻断已${onOff(config.receive.qqbot.block)}`)
  }

  async setWildBlock() {
    config.receive.wild.block = setByAction(this.e.msg.match(/(开启|关闭)$/)?.[1])
    return this.saveAndReply(`QWild Wild 接收阻断已${onOff(config.receive.wild.block)}`)
  }

  async bind(type, id = "", mode = type) {
    const protocol = eventProtocol(this.e)
    if (!protocol) return this.replyCurrent("未识别当前协议")
    if (type === "group" && !isGroup(this.e)) return this.replyCurrent("请在群聊中使用")

    id ||= currentId(this.e, type, protocol)
    if (!id) return this.replyCurrent(`未识别当前${mapLabel(type)}ID`)

    const now = Date.now()
    const pending = pendingBinds[type]
    if (!pending || now - pending.time > pendingBindTTL || pending.protocol === protocol || pending.mode !== mode) {
      pendingBinds[type] = { protocol, id, mode, time: now }
      return this.replyCurrent(`已记录${mapLabel(type)}，等待 ${otherProtocol(protocol)} 上报`)
    }

    const pair = protocol === "qqbot"
      ? { qqbot: id, wild: pending.id }
      : { qqbot: pending.id, wild: id }
    pendingBinds[type] = null
    if (!addMapping(type, pair)) {
      return this.replyCurrent(`${mapLabel(type)}映射已存在，请先删除后再绑定`)
    }
    await configSave()
    return this.replyCurrent(`${mapLabel(type)}映射已添加：\n${mapText(pair)}`)
  }

  bindGroup() {
    return this.bind("group", "", "group")
  }

  async bindUser() {
    if (isGroup(this.e)) {
      const arg = actionArg(messageText(this.e), /^#[Qq][Ww]绑定用户/)
      if (arg) return this.replyCurrent("群聊中请直接使用 #QW绑定用户，或艾特一名用户")
      if (eventProtocol(this.e) === "qqbot" && isQQBotAtMessage(this.e)) {
        pendingBinds.user = null
        return this.replyCurrent("绑定艾特用户需开启 QQBot 获取群内全部消息")
      }

      const at = atIds(this.e)
      if (isOnlyQQBotAt(at)) return this.replyCurrent("QQBot 机器人无需添加用户映射")
      if (at.length > 1) return this.replyCurrent("一次只能绑定一名艾特用户")
      return this.bind("user", at[0] || currentId(this.e, "user"), at.length ? "group-at" : "group-current")
    }

    const arg = actionArg(this.e.msg, /^#[Qq][Ww]绑定用户/)
    if (!arg) return this.bind("user", "", "private-current")

    const pair = this.parseCurrentUserArg(arg, "#QW绑定用户")
    if (!pair || pair.error) return this.replyCurrent(pair?.error || "格式错误\n示例：#QW绑定用户 另一端用户ID")
    if (!addMapping("user", pair)) return this.replyCurrent("用户映射已存在，请先删除后再绑定")
    await configSave()
    return this.replyCurrent(`用户映射已添加：\n${mapText(pair)}`)
  }

  cancelBind(type) {
    pendingBinds[type] = null
    return this.replyCurrent(`已取消${mapLabel(type)}绑定记录`)
  }

  cancelBindGroup() {
    return this.cancelBind("group")
  }

  cancelBindUser() {
    return this.cancelBind("user")
  }

  async addGroupMap() {
    const arg = actionArg(this.e.msg, /^#[Qq][Ww]添加群聊映射/)
    const pair = parseMappingPair(arg)
    if (!pair) return this.reply("格式错误\n示例：#QW添加群聊映射 BotID:GroupID=群号", true)
    if (!addMapping("group", pair)) return this.reply("群聊映射已存在，请先删除后再绑定", true)
    await configSave()
    return this.reply(`群聊映射已添加：\n${mapText(pair)}`, true)
  }

  parseCurrentUserArg(arg, command) {
    const protocol = eventProtocol(this.e)
    arg = String(arg || "").trim()
    if (!isPrivate(this.e)) return { error: `请在私聊中使用：${command} 另一端用户ID` }
    if (protocol === "qqbot") {
      if (!isQQId(arg)) return { error: "当前已是 QQBot 私聊，请填写 QQ号" }
      return { qqbot: currentId(this.e, "user", protocol), wild: arg }
    }
    if (protocol === "wild") {
      if (!isQQBotId(arg)) return { error: "当前已是 Wild 私聊，请填写完整QQBot用户ID：BotID:UserID" }
      return { qqbot: arg, wild: currentId(this.e, "user", protocol) }
    }
    return { error: "未识别当前协议" }
  }

  async addUserMap() {
    const arg = actionArg(this.e.msg, /^#[Qq][Ww]添加用户映射/)
    const pair = arg.includes("=") ? parseMappingPair(arg) : null
    if (!pair || pair.error) return this.reply(pair?.error || "格式错误\n示例：#QW添加用户映射 BotID:UserID=QQ号", true)
    if (!addMapping("user", pair)) return this.reply("用户映射已存在，请先删除后再绑定", true)
    await configSave()
    return this.reply(`用户映射已添加：\n${mapText(pair)}`, true)
  }

  async deleteMap(type, arg) {
    const protocol = eventProtocol(this.e)
    let id = String(arg || "").trim()
    if (!id) {
      if (type === "group" && !isGroup(this.e)) return this.reply("请在群聊中使用，或填写群ID", true)
      if (type === "user" && !isPrivate(this.e)) return this.reply("请在私聊中使用，或填写用户ID", true)
      id = currentId(this.e, type, protocol)
    } else if (!id.includes("=") && !isQQId(id) && !isQQBotId(id)) {
      return this.reply(`请使用完整QQBot${mapLabel(type)}ID：BotID:ID`, true)
    }

    const deleted = deleteMapping(type, id)
    if (!deleted) return this.reply(`当前${mapLabel(type)}没有映射`, true)
    if (deleted.ambiguous) return this.reply(`存在多个${mapLabel(type)}映射，请指定完整QQBot${mapLabel(type)}ID`, true)
    await configSave()
    return this.reply(`${mapLabel(type)}映射已删除：\n${mapText(deleted)}`, true)
  }

  deleteGroupMap() {
    return this.deleteMap("group", actionArg(this.e.msg, /^#[Qq][Ww]删除群聊映射/))
  }

  deleteUserMap() {
    return this.deleteMap("user", actionArg(this.e.msg, /^#[Qq][Ww]删除用户映射/))
  }
}
