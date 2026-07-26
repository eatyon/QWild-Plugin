import { config } from "../model/config.js"

let lastOfflineLogKey = null
const wildAdapters = new Set(["OneBotv11", "OPQBot", "Milky", "ICQQ"])

export function adapterName(bot) {
  return String(bot?.adapter?.name || bot?.version?.name || bot?.adapter?.id || bot?.version?.id || "")
}

export function isProtocol(bot, protocol) {
  if (!bot) return false
  const selfId = String(config.protocols[protocol]?.self_id || "")
  if (selfId && ![bot?.uin, bot?.self_id].map(id => String(id || "")).includes(selfId)) return false
  const expected = config.protocols[protocol]?.adapter
  if (protocol === "wild") {
    const name = adapterName(bot)
    if (expected) return name === expected || bot?.version?.id === expected || bot?.adapter?.id === expected
    return wildAdapters.has(name) || wildAdapters.has(String(bot?.version?.id || "")) || wildAdapters.has(String(bot?.adapter?.id || ""))
  }
  if (!expected) return false
  return adapterName(bot) === expected || bot?.version?.id === expected || bot?.adapter?.id === expected
}

export function candidateProtocol(bot) {
  if (!bot) return ""
  const name = adapterName(bot)
  if (name === "QQBot" || bot?.version?.id === "QQBot" || bot?.adapter?.id === "QQBot") return "qqbot"
  if (wildAdapters.has(name) || wildAdapters.has(String(bot?.version?.id || "")) || wildAdapters.has(String(bot?.adapter?.id || ""))) return "wild"
  return ""
}

export function eventProtocol(e) {
  if (isProtocol(e?.bot, "qqbot")) return "qqbot"
  if (isProtocol(e?.bot, "wild")) return "wild"
  return ""
}

export function findBot(protocol) {
  const selfId = config.protocols[protocol]?.self_id
  if (selfId) {
    const bot = Bot?.[selfId]
    return isProtocol(bot, protocol) ? bot : null
  }

  for (const id of Bot?.uin || []) {
    const bot = Bot[id]
    if (isProtocol(bot, protocol)) return bot
  }
  return null
}

export function protocolStatus() {
  return {
    qqbot: Boolean(findBot("qqbot")),
    wild: Boolean(findBot("wild")),
  }
}

export function hasOfflineProtocol(status = protocolStatus()) {
  return !(status.qqbot && status.wild)
}

export function offlineMode() {
  const mode = String(config.runtime?.offline_mode || "bypass")
  return ["bypass", "bypass_active", "block_only", "block_active"].includes(mode) ? mode : "bypass"
}

function offlineReason(status) {
  if (!status.qqbot && !status.wild) return "双端离线"
  if (!status.qqbot) return "QQBot 离线"
  return "Wild 离线"
}

function offlineAction(mode = offlineMode()) {
  return {
    bypass: "全部旁路",
    bypass_active: "全部旁路，主动消息切换",
    block_only: "发送分流旁路",
    block_active: "发送分流旁路，主动消息切换",
  }[mode] || "全部旁路"
}

function logOfflineState(status = protocolStatus(), mode = offlineMode()) {
  const offline = hasOfflineProtocol(status)
  const key = offline ? `${offlineReason(status)}:${mode}` : "online"
  if (lastOfflineLogKey === key) return
  if (!lastOfflineLogKey && !offline) {
    lastOfflineLogKey = key
    return
  }
  lastOfflineLogKey = key

  if (offline) {
    globalThis.logger?.warn?.(`[QWild] ${offlineReason(status)}，离线处理：${offlineAction(mode)}`)
    return
  }

  globalThis.logger?.info?.("[QWild] 双端在线，离线处理恢复正常")
}

export function shouldBypassReceive() {
  const mode = offlineMode()
  const status = protocolStatus()
  logOfflineState(status, mode)
  return hasOfflineProtocol(status) && ["bypass", "bypass_active"].includes(mode)
}

export function shouldBypassSend() {
  const mode = offlineMode()
  const status = protocolStatus()
  logOfflineState(status, mode)
  return hasOfflineProtocol(status)
}
