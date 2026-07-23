import { config, configSave } from "./model/config.js"

function makeOption(label, value) {
  value = String(value ?? "")
  return {
    label: label ? `${label} (${value})` : value,
    value,
  }
}

function adapterName(bot) {
  return bot?.adapter?.name || bot?.version?.name || bot?.adapter?.id || bot?.version?.id
}

function botOptions(protocol) {
  const ids = globalThis.Bot?.uin || []
  return [
    { label: "自动选择", value: "" },
    ...Array.from(ids)
      .map(id => {
        const bot = globalThis.Bot?.[id]
        const adapter = adapterName(bot)
        if (protocol && adapter !== config.protocols[protocol]?.adapter) return false
        return makeOption([adapter, bot?.nickname].filter(Boolean).join(" "), id)
      })
      .filter(Boolean),
  ]
}

function groupOptions(protocol) {
  const options = []
  for (const id of globalThis.Bot?.uin || []) {
    const bot = globalThis.Bot?.[id]
    if (protocol && adapterName(bot) !== config.protocols[protocol]?.adapter) continue
    const map = bot?.gl || bot?.getGroupMap?.()
    if (!map?.entries) continue
    for (const [groupId, item] of map.entries()) {
      options.push(makeOption(item?.group_name || item?.name, groupId))
    }
  }
  return options
}

function userOptions(protocol) {
  const options = []
  for (const id of globalThis.Bot?.uin || []) {
    const bot = globalThis.Bot?.[id]
    if (protocol && adapterName(bot) !== config.protocols[protocol]?.adapter) continue
    const map = bot?.fl || bot?.getFriendMap?.()
    if (!map?.entries) continue
    for (const [userId, item] of map.entries()) {
      options.push(makeOption(item?.nickname || item?.name || item?.remark, userId))
    }
  }
  return options
}

function mappingList(source = {}) {
  return Object.entries(source).map(([qqbot, onebot]) => ({ qqbot, onebot }))
}

function commandList(list = []) {
  return (Array.isArray(list) ? list : []).map(item => {
    if (item && typeof item === "object") {
      return {
        match: item.match || "starts",
        text: String(item.text || item.pattern || ""),
      }
    }
    return {
      match: "regex",
      text: String(item || ""),
    }
  })
}

function sendCommandList(list = []) {
  return (Array.isArray(list) ? list : []).map(item => ({
    match: item?.match || "starts",
    text: String(item?.text || item?.pattern || ""),
    protocol: item?.protocol || "",
  }))
}

function modeOptions() {
  return [
    { label: "黑名单", value: "black" },
    { label: "白名单", value: "white" },
  ]
}

function protocolOptions(first = "qqbot") {
  const options = [
    { label: "不指定", value: "" },
    { label: "QQBot", value: "qqbot" },
    { label: "OneBotv11", value: "onebot" },
  ]
  if (first !== "onebot") return options
  return [options[0], options[2], options[1]]
}

function matchOptions() {
  return [
    { label: "开头是", value: "starts" },
    { label: "包含", value: "contains" },
    { label: "完全等于", value: "equals" },
    { label: "正则", value: "regex" },
  ]
}

function receiveSchemas(protocol, title, adapterTitle) {
  const displayTitle = adapterTitle === "OneBotv11" ? "OBv11" : adapterTitle
  return [
    {
      component: "SOFT_GROUP_BEGIN",
      label: title,
    },
    {
      field: `receive.${protocol}.block`,
      label: `阻断 ${displayTitle}`,
      component: "Switch",
      bottomHelpMessage: `开启后 ${displayTitle} 消息不进入云崽插件处理`,
    },
    {
      field: `receive.${protocol}.group_mode`,
      label: "群聊过滤模式",
      component: "Select",
      bottomHelpMessage: "黑名单：名单内阻断；白名单：只放行名单内",
      componentProps: {
        options: modeOptions(),
      },
    },
    {
      field: `receive.${protocol}.group_list`,
      label: "群聊名单",
      component: "Select",
      componentProps: {
        mode: "tags",
        options: groupOptions(protocol),
      },
    },
    {
      field: `receive.${protocol}.user_mode`,
      label: "用户过滤模式",
      component: "Select",
      bottomHelpMessage: "黑名单：名单内阻断；白名单：只放行名单内",
      componentProps: {
        options: modeOptions(),
      },
    },
    {
      field: `receive.${protocol}.user_list`,
      label: "用户名单",
      component: "Select",
      componentProps: {
        mode: "tags",
        options: userOptions(protocol),
      },
    },
    {
      field: `${protocol}CommandAllowRules`,
      label: "命令放行规则",
      component: "GSubForm",
      bottomHelpMessage: "命中后放行，不再阻断",
      componentProps: {
        multiple: true,
        schemas: [
          {
            field: "match",
            label: "匹配方式",
            component: "Select",
            required: true,
            componentProps: {
              options: matchOptions(),
            },
          },
          {
            field: "text",
            label: "命令内容",
            component: "Input",
            required: true,
          },
        ],
      },
    },
  ]
}

function sendSchema(field, label, first = "qqbot", bottomHelpMessage = "") {
  return {
    field,
    label,
    component: "Select",
    bottomHelpMessage,
    componentProps: {
      options: protocolOptions(first),
    },
  }
}

function applyMap(value) {
  const map = {}
  for (const item of Array.isArray(value) ? value : []) {
    const qqbot = String(item?.qqbot || "").trim()
    const onebot = String(item?.onebot || "").trim()
    if (qqbot && onebot) map[qqbot] = onebot
  }
  return map
}

function applyCommandList(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => {
      if (!item || typeof item !== "object") return String(item || "").trim()
      return {
        match: ["starts", "contains", "equals", "regex"].includes(item.match) ? item.match : "starts",
        text: String(item.text || item.pattern || "").trim(),
      }
    })
    .filter(item => (typeof item === "string" ? item : item.text))
}

function applySendCommandList(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => ({
      match: ["starts", "contains", "equals", "regex"].includes(item?.match) ? item.match : "starts",
      text: String(item?.text || item?.pattern || "").trim(),
      protocol: ["", "qqbot", "onebot"].includes(item?.protocol) ? item.protocol : "",
    }))
    .filter(item => item.text)
}

function applyData(data = {}) {
  for (const [key, value] of Object.entries(data)) {
    if (key === "groupList") {
      config.groups = applyMap(value)
      continue
    }
    if (key === "userList") {
      config.users = applyMap(value)
      continue
    }
    if (key === "qqbotCommandAllowRules") {
      config.receive.qqbot.command_allow_rules = applyCommandList(value)
      continue
    }
    if (key === "onebotCommandAllowRules") {
      config.receive.onebot.command_allow_rules = applyCommandList(value)
      continue
    }
    if (key === "sendCommandRules") {
      config.send.command_rules = applySendCommandList(value)
      continue
    }

    const keys = key.split(".")
    let target = config
    while (keys.length > 1) {
      const name = keys.shift()
      if (!target[name] || typeof target[name] !== "object") target[name] = {}
      target = target[name]
    }
    target[keys[0]] = value
  }
}

export function supportGuoba() {
  return {
    pluginInfo: {
      name: "QWild-Plugin",
      title: "QWild-Plugin",
      author: "eatyon",
      authorLink: "https://github.com/eatyon",
      link: "https://github.com/eatyon/QWild-Plugin",
      isV3: true,
      isV2: false,
      description: "QQBot 和 OneBot v11 双协议接收控制与发送分流插件",
      showInMenu: "auto",
      icon: "mdi:routes",
      iconColor: "#722ed1",
    },
    configInfo: {
      schemas: [
        {
          component: "SOFT_GROUP_BEGIN",
          label: "基础设置",
        },
        {
          field: "enable",
          label: "启用插件",
          component: "Switch",
          bottomHelpMessage: "插件总开关，关闭后不接管接收和发送",
        },
        {
          field: "runtime.require_both_online",
          label: "离线旁路",
          component: "Switch",
          bottomHelpMessage: "开启后任一协议离线时，QWild 自动旁路，让云崽按原协议运行",
        },
        {
          field: "protocols.qqbot.self_id",
          label: "QQBot 机器人",
          component: "Select",
          bottomHelpMessage: "自动选择或指定要接管的 QQBot 账号",
          componentProps: {
            options: botOptions("qqbot"),
          },
        },
        {
          field: "protocols.onebot.self_id",
          label: "OBv11 机器人",
          component: "Select",
          bottomHelpMessage: "自动选择或指定要接管的 OBv11 账号",
          componentProps: {
            options: botOptions("onebot"),
          },
        },
        ...receiveSchemas("qqbot", "QQBot 接收控制", "QQBot"),
        ...receiveSchemas("onebot", "OBv11 接收控制", "OneBotv11"),
        {
          component: "SOFT_GROUP_BEGIN",
          label: "发送分流",
        },
        {
          field: "send.enable",
          label: "启用发送分流",
          component: "Switch",
          bottomHelpMessage: "关闭后不接管发送，全部走原协议",
        },
        {
          field: "send.active_message.enable",
          label: "主动消息接管",
          component: "Switch",
          bottomHelpMessage: "定时任务、主动群聊/私聊等非回复消息也走发送分流",
        },
        {
          field: "send.failover",
          label: "发送失败切换协议",
          component: "Switch",
          bottomHelpMessage: "目标协议发送失败时尝试另一协议，缺少映射不切换",
        },
        {
          field: "identity.unmapped_passthrough",
          label: "未映射不分流",
          component: "Switch",
          bottomHelpMessage: "缺少群聊或用户映射时，不跨协议分流，直接走原协议",
        },
        {
          field: "sendCommandRules",
          label: "命令分流",
          component: "GSubForm",
          bottomHelpMessage: "命中后优先使用指定协议，不指定则走原协议",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "match",
                label: "匹配方式",
                component: "Select",
                required: true,
                componentProps: {
                  options: matchOptions(),
                },
              },
              {
                field: "text",
                label: "命令内容",
                component: "Input",
                required: true,
              },
              {
                field: "protocol",
                label: "发送协议",
                component: "Select",
                required: true,
                componentProps: {
                  options: protocolOptions("onebot"),
                },
              },
            ],
          },
        },
        {
          component: "Divider",
          label: "消息类型分流",
        },
        sendSchema("send.text", "文本消息"),
        sendSchema("send.image", "图片消息"),
        sendSchema("send.image_text", "图文消息", "qqbot"),
        sendSchema("send.file", "文件消息"),
        sendSchema("send.record", "语音消息"),
        sendSchema("send.video", "视频消息"),
        sendSchema("send.button", "按钮消息"),
        sendSchema("send.node", "合并转发消息", "onebot"),
        sendSchema("send.markdown", "Markdown 消息"),
        sendSchema("send.forward", "Forward 消息", "onebot"),
        sendSchema("send.link", "链接消息", "onebot", "文本中包含 http/https 或 QQ 易识别链接格式时命中，如 d.Mov、1.cn"),
        sendSchema("send.default", "未知类型", "onebot", "无法识别具体类型时使用，不指定则走原协议"),
        {
          component: "SOFT_GROUP_BEGIN",
          label: "身份映射",
        },
        {
          field: "groupList",
          label: "群聊映射",
          component: "GSubForm",
          bottomHelpMessage: "完整 QQBot群ID 与 群号 的对应关系",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "qqbot",
                label: "QQBot群",
                component: "Select",
                required: true,
                componentProps: {
                  options: groupOptions("qqbot"),
                },
              },
              {
                field: "onebot",
                label: "群号",
                component: "Select",
                required: true,
                componentProps: {
                  options: groupOptions("onebot"),
                },
              },
            ],
          },
        },
        {
          field: "userList",
          label: "用户映射",
          component: "GSubForm",
          bottomHelpMessage: "完整 QQBot用户ID 与 QQ号 的对应关系",
          componentProps: {
            multiple: true,
            schemas: [
              {
                field: "qqbot",
                label: "QQBot用户",
                component: "Select",
                required: true,
                componentProps: {
                  options: userOptions("qqbot"),
                },
              },
              {
                field: "onebot",
                label: "QQ号",
                component: "Select",
                required: true,
                componentProps: {
                  options: userOptions("onebot"),
                },
              },
            ],
          },
        },
      ],
      getConfigData() {
        return {
          ...structuredClone(config),
          groupList: mappingList(config.groups),
          userList: mappingList(config.users),
          qqbotCommandAllowRules: commandList(config.receive.qqbot.command_allow_rules),
          onebotCommandAllowRules: commandList(config.receive.onebot.command_allow_rules),
          sendCommandRules: sendCommandList(config.send.command_rules),
        }
      },
      async setConfigData(data, { Result }) {
        applyData(data)
        await configSave()
        return Result.ok({}, "保存成功")
      },
    },
  }
}
