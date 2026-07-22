import { config } from "../model/config.js"

let lastRuntimeBypass = null

export function adapterName(bot) {
  return String(bot?.adapter?.name || bot?.version?.name || bot?.adapter?.id || bot?.version?.id || "")
}

export function isProtocol(bot, protocol) {
  const expected = config.protocols[protocol]?.adapter
  if (!expected) return false
  return adapterName(bot) === expected || bot?.version?.id === expected || bot?.adapter?.id === expected
}

export function eventProtocol(e) {
  if (isProtocol(e?.bot, "qqbot")) return "qqbot"
  if (isProtocol(e?.bot, "onebot")) return "onebot"
  return ""
}

export function findBot(protocol) {
  const selfId = config.protocols[protocol]?.self_id
  if (selfId) return Bot?.[selfId] || null

  for (const id of Bot?.uin || []) {
    const bot = Bot[id]
    if (isProtocol(bot, protocol)) return bot
  }
  return null
}

export function bothProtocolsOnline() {
  return Boolean(findBot("qqbot") && findBot("onebot"))
}

function protocolStatus() {
  return {
    qqbot: Boolean(findBot("qqbot")),
    onebot: Boolean(findBot("onebot")),
  }
}

function offlineReason(status) {
  if (!status.qqbot && !status.onebot) return "双端离线"
  if (!status.qqbot) return "QQBot 离线"
  return "OBv11 离线"
}

function logRuntimeState(bypass, status) {
  if (lastRuntimeBypass === null) {
    lastRuntimeBypass = bypass
    if (bypass) globalThis.logger?.warn?.(`[QWild] ${offlineReason(status)}，已临时旁路插件功能`)
    return
  }

  if (lastRuntimeBypass === bypass) return
  lastRuntimeBypass = bypass

  if (bypass) {
    globalThis.logger?.warn?.(`[QWild] ${offlineReason(status)}，已临时旁路插件功能`)
    return
  }

  globalThis.logger?.info?.("[QWild] 离线旁路解除，插件功能恢复")
}

export function shouldBypassRuntime() {
  if (!config.runtime?.require_both_online) {
    lastRuntimeBypass = null
    return false
  }

  const status = protocolStatus()
  const bypass = !(status.qqbot && status.onebot)
  logRuntimeState(bypass, status)
  return bypass
}
