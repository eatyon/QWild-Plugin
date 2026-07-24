import { createRequire } from "node:module"
import common from "../../../lib/common/common.js"
import { config, configSave } from "../model/config.js"
import { eventProtocol, findBot } from "./protocol.js"

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

const pendingBinds = {
  group: {},
  user: {},
}

const showIdMarks = new Map()
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

function countList(list) {
  return Array.isArray(list) ? list.length : 0
}

function protocolName(protocol) {
  if (protocol === "qqbot") return "QQBot"
  if (protocol === "onebot") return "OBv11"
  return "未知"
}

function routeName(protocol) {
  if (protocol === "qqbot") return "QQBot"
  if (protocol === "onebot") return "OBv11"
  return "原协议"
}

function routeType(protocol) {
  return "route"
}

function isGroup(e) {
  return Boolean(e?.isGroup || e?.message_type === "group")
}

function isPrivate(e) {
  return Boolean(e?.isPrivate || e?.message_type === "private")
}

function qqbotId(selfId, id) {
  id = String(id || "")
  if (!id || id.includes(":")) return id
  return `${selfId}:${id}`
}

function currentId(e, type, protocol = eventProtocol(e)) {
  const id = type === "group" ? e?.group_id : e?.user_id
  return protocol === "qqbot" ? qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, id) : String(id || "")
}

function atIds(e, protocol = eventProtocol(e)) {
  const ids = []
  for (const item of e?.message || []) {
    if (item?.type !== "at") continue
    const id = item.qq || item.user_id || item.data?.qq || item.data?.user_id
    if (!id || String(id) === "all") continue
    ids.push(protocol === "qqbot" ? qqbotId(e?.self_id || e?.bot?.uin || e?.bot?.self_id, id) : String(id))
  }
  return [...new Set(ids)]
}

function otherProtocol(protocol) {
  return protocol === "qqbot" ? "OBv11" : "QQBot"
}

function isQQBotId(id) {
  return /^[^:\s]+:.+$/.test(String(id || ""))
}

function isOneBotId(id) {
  return /^\d+$/.test(String(id || ""))
}

function mapLabel(type) {
  return type === "group" ? "群聊" : "用户"
}

function mapText(pair) {
  return `${pair.qqbot} = ${pair.onebot}`
}

function searchMap(map, keyword) {
  keyword = String(keyword || "")
  return Object.entries(map || {})
    .filter(([qqbot, onebot]) => qqbot.includes(keyword) || String(onebot).includes(keyword))
    .map(([qqbot, onebot]) => ({ qqbot, onebot }))
}

function mapLines(list) {
  return list.map((item, index) => `${index + 1}. ${mapText(item)}`).join("\n")
}

function parsePair(text, type) {
  const parts = String(text || "")
    .trim()
    .split("=")
    .map(item => item.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null

  const [left, right] = parts
  if (isQQBotId(left) && isOneBotId(right)) return { qqbot: left, onebot: right }
  if (isQQBotId(right) && isOneBotId(left)) return { qqbot: right, onebot: left }
  return null
}

function findAllByValue(map, value) {
  value = String(value || "")
  return Object.entries(map || {}).filter(([, to]) => String(to) === value)
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

function findMapping(map, id) {
  id = String(id || "").trim()
  if (!id) return null
  if (id.includes("=")) {
    const pair = parsePair(id)
    if (!pair) return null
    return String(map[pair.qqbot] || "") === pair.onebot ? [pair.qqbot, pair.onebot] : null
  }
  if (map[id]) return [id, map[id]]
  if (isQQBotId(id)) return null

  const hits = findAllByValue(map, id)
  if (hits.length > 1) return { ambiguous: true, value: id }
  return hits[0] || null
}

function hasCurrentMapping(e, protocol) {
  if (protocol !== "onebot") return false
  if (isGroup(e)) return hasCurrentQQBotValue(config.groups, currentId(e, "group", protocol))
  if (isPrivate(e)) return hasCurrentQQBotValue(config.users, currentId(e, "user", protocol))
  return false
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

function showIdKey(e, protocol) {
  if (isGroup(e)) {
    const onebotGroupId = protocol === "onebot"
      ? currentId(e, "group", protocol)
      : config.groups[currentId(e, "group", protocol)] || currentId(e, "group", protocol)
    return `group:${onebotGroupId}`
  }
  const onebotUserId = protocol === "onebot"
    ? currentId(e, "user", protocol)
    : config.users[currentId(e, "user", protocol)] || currentId(e, "user", protocol)
  return `private:${onebotUserId}`
}

function markShowId(e, protocol) {
  const key = showIdKey(e, protocol)
  showIdMarks.set(key, Date.now())
  setTimeout(() => showIdMarks.delete(key), 3000)
}

function hasRecentShowId(e, protocol) {
  const time = showIdMarks.get(showIdKey(e, protocol))
  return Boolean(time && Date.now() - time < 3000)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function addMapping(type, pair) {
  const map = type === "group" ? config.groups : config.users
  if (map[pair.qqbot]) return false
  map[pair.qqbot] = pair.onebot
  return true
}

function deleteMapping(type, id) {
  const map = type === "group" ? config.groups : config.users
  const found = findMapping(map, id)
  if (!found) return null
  if (found.ambiguous) return found
  delete map[found[0]]
  return { qqbot: found[0], onebot: found[1] }
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
          reg: "^#[Qq][Ww]阻断(?:OBv11|OneBotv11)(开启|关闭)$",
          fnc: "setOneBotBlock",
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
    const qqbotOnline = botStatus("qqbot") === "在线"
    const onebotOnline = botStatus("onebot") === "在线"
    const requireBoth = Boolean(config.runtime?.require_both_online)
    const bypass = requireBoth && !(qqbotOnline && onebotOnline)
    const bypassStatus = !requireBoth
      ? "未启用"
      : !bypass
        ? "正常"
        : "旁路"
    const statusGroups = [
      {
        group: "运行状态",
        list: [
          { title: "总开关", value: onOff(config.enable), type: statusType(config.enable) },
          { title: "当前协议", value: protocolName(protocol), type: protocol ? "ok" : "off" },
          { title: "QQBot", value: botStatus("qqbot"), type: statusType(qqbotOnline) },
          { title: "QQBot 账号", value: botId("qqbot"), type: qqbotOnline ? "ok" : "off" },
          { title: "OBv11", value: botStatus("onebot"), type: statusType(onebotOnline) },
          { title: "OBv11 账号", value: botId("onebot"), type: onebotOnline ? "ok" : "off" },
          { title: "离线旁路", value: onOff(requireBoth), type: statusType(requireBoth) },
          { title: "旁路状态", value: bypassStatus, type: bypassStatus === "未启用" ? "off" : "ok" },
        ],
      },
      {
        group: "接收与发送",
        list: [
          { title: "发送分流", value: onOff(config.send.enable), type: statusType(config.send.enable) },
          { title: "当前会话接管", ...currentRouteState(this.e, protocol) },
          { title: "QQBot 接收阻断", value: onOff(config.receive.qqbot.block), type: statusType(config.receive.qqbot.block) },
          { title: "OBv11 接收阻断", value: onOff(config.receive.onebot.block), type: statusType(config.receive.onebot.block) },
          { title: "主动消息接管", value: onOff(config.send.active_message?.enable), type: statusType(config.send.active_message?.enable) },
          { title: "发送失败切换", value: onOff(config.send.failover), type: statusType(config.send.failover) },
        ],
      },
      {
        group: "发送分流概览",
        list: [
          { title: "文本消息", value: routeName(config.send.text), type: routeType(config.send.text) },
          { title: "图片消息", value: routeName(config.send.image), type: routeType(config.send.image) },
          { title: "图文消息", value: routeName(config.send.image_text), type: routeType(config.send.image_text) },
          { title: "语音消息", value: routeName(config.send.record), type: routeType(config.send.record) },
          { title: "视频消息", value: routeName(config.send.video), type: routeType(config.send.video) },
          { title: "文件消息", value: routeName(config.send.file), type: routeType(config.send.file) },
          { title: "按钮消息", value: routeName(config.send.button), type: routeType(config.send.button) },
          { title: "Markdown 消息", value: routeName(config.send.markdown), type: routeType(config.send.markdown) },
          { title: "合并转发消息", value: routeName(config.send.node), type: routeType(config.send.node) },
          { title: "Forward 消息", value: routeName(config.send.forward), type: routeType(config.send.forward) },
          { title: "链接消息", value: routeName(config.send.link), type: routeType(config.send.link) },
          { title: "未知类型", value: routeName(config.send.default), type: routeType(config.send.default) },
        ],
      },
      {
        group: "身份映射",
        list: [
          { title: "群聊映射", value: `${countMap(config.groups)} 个`, type: "route" },
          { title: "用户映射", value: `${countMap(config.users)} 个`, type: "route" },
        ],
      },
      {
        group: "命令规则",
        list: [
          { title: "命令放行规则", value: `${countList(config.receive.qqbot.command_allow_rules) + countList(config.receive.onebot.command_allow_rules)} 条`, type: "route" },
          { title: "命令分流", value: `${countList(config.send.command_rules)} 条`, type: "route" },
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

  async showId() {
    const protocol = eventProtocol(this.e)
    let replyCurrent = false
    if (protocol === "qqbot") {
      markShowId(this.e, protocol)
    } else if (protocol === "onebot" && findBot("qqbot") && hasCurrentMapping(this.e, protocol)) {
      await sleep(2000)
      if (hasRecentShowId(this.e, protocol)) return true
      replyCurrent = true
    } else if (protocol === "onebot") {
      replyCurrent = true
    }

    const protocolName = protocol === "qqbot" ? "QQBot" : protocol === "onebot" ? "OBv11" : "未知"
    const lines = [`当前协议：${protocolName}`]

    if (isGroup(this.e)) lines.push(`群聊ID：${currentId(this.e, "group", protocol)}`)
    if (this.e?.user_id) lines.push(`用户ID：${currentId(this.e, "user", protocol)}`)
    const at = atIds(this.e, protocol)
    if (at.length === 1) lines.push(`艾特对象ID：${at[0]}`)
    else if (at.length > 1) lines.push(["艾特对象ID：", ...at].join("\n"))

    return replyCurrent ? this.replyCurrent(lines.join("\n")) : this.reply(lines.join("\n"), true)
  }

  async searchMap() {
    const keyword = actionArg(this.e.msg, /^#[Qq][Ww]搜索映射/)
    if (!keyword) return this.reply("请填写搜索内容\n示例：#QW搜索映射 123456789", true)

    const groups = searchMap(config.groups, keyword)
    const users = searchMap(config.users, keyword)
    const total = groups.length + users.length
    if (!total) return this.reply(`未找到相关映射：${keyword}`, true)

    const nodes = [
      [`群聊映射：${groups.length} 条`, `用户映射：${users.length} 条`, `总计：${total} 条`].join("\n"),
    ]
    if (groups.length) nodes.push("群聊映射：", mapLines(groups))
    if (users.length) nodes.push("用户映射：", mapLines(users))

    const msg = await common.makeForwardMsg(this.e, nodes, `QWild 映射搜索：${keyword}`)
    return this.reply(msg)
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

  async setOneBotBlock() {
    config.receive.onebot.block = setByAction(this.e.msg.match(/(开启|关闭)$/)?.[1])
    return this.saveAndReply(`QWild OBv11 接收阻断已${onOff(config.receive.onebot.block)}`)
  }

  async bind(type) {
    const protocol = eventProtocol(this.e)
    if (!protocol) return this.replyCurrent("未识别当前协议")
    if (type === "group" && !isGroup(this.e)) return this.replyCurrent("请在群聊中使用")
    if (type === "user" && !isPrivate(this.e)) return this.replyCurrent("请在私聊中使用")

    pendingBinds[type][protocol] = currentId(this.e, type, protocol)
    pendingBinds[type].time = Date.now()

    if (pendingBinds[type].qqbot && pendingBinds[type].onebot) {
      const pair = {
        qqbot: pendingBinds[type].qqbot,
        onebot: pendingBinds[type].onebot,
      }
      pendingBinds[type] = {}
      if (!addMapping(type, pair)) {
        return this.replyCurrent(`${mapLabel(type)}映射已存在，请先删除后再绑定`)
      }
      await configSave()
      return this.replyCurrent(`${mapLabel(type)}映射已添加：\n${mapText(pair)}`)
    }

    return this.replyCurrent(`已记录当前${mapLabel(type)}，等待 ${otherProtocol(protocol)} 上报`)
  }

  bindGroup() {
    return this.bind("group")
  }

  async bindUser() {
    const arg = actionArg(this.e.msg, /^#[Qq][Ww]绑定用户/)
    if (!arg) return this.bind("user")

    const pair = this.parseCurrentUserArg(arg, "#QW绑定用户")
    if (!pair || pair.error) return this.replyCurrent(pair?.error || "格式错误\n示例：#QW绑定用户 另一端用户ID")
    if (!addMapping("user", pair)) return this.replyCurrent("用户映射已存在，请先删除后再绑定")
    await configSave()
    return this.replyCurrent(`用户映射已添加：\n${mapText(pair)}`)
  }

  cancelBind(type) {
    pendingBinds[type] = {}
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
    const pair = parsePair(arg, "group")
    if (!pair) return this.reply("格式错误\n示例：#QW添加群聊映射 BotID:GroupID=群号", true)
    if (!addMapping("group", pair)) return this.reply("群聊映射已存在，请先删除后再绑定", true)
    await configSave()
    return this.reply(`群聊映射已添加：\n${mapText(pair)}`, true)
  }

  parseUserAddArg(arg) {
    if (arg.includes("=")) return parsePair(arg, "user")
    return null
  }

  parseCurrentUserArg(arg, command) {
    const protocol = eventProtocol(this.e)
    arg = String(arg || "").trim()
    if (!isPrivate(this.e)) return { error: `请在私聊中使用：${command} 另一端用户ID` }
    if (protocol === "qqbot") {
      if (!isOneBotId(arg)) return { error: "当前已是 QQBot 私聊，请填写 QQ号" }
      return { qqbot: currentId(this.e, "user", protocol), onebot: arg }
    }
    if (protocol === "onebot") {
      if (!isQQBotId(arg)) return { error: "当前已是 OBv11 私聊，请填写完整QQBot用户ID：BotID:UserID" }
      return { qqbot: arg, onebot: currentId(this.e, "user", protocol) }
    }
    return { error: "未识别当前协议" }
  }

  async addUserMap() {
    const arg = actionArg(this.e.msg, /^#[Qq][Ww]添加用户映射/)
    const pair = this.parseUserAddArg(arg)
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
    } else if (!id.includes("=") && !isOneBotId(id) && !isQQBotId(id)) {
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
