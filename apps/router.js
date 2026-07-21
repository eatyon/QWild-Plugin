import path from "node:path"
import { pathToFileURL } from "node:url"
import { config } from "../model/config.js"
import { eventProtocol, shouldBypassRuntime } from "./protocol.js"
import { isReceiveForceAllowed, shouldBlockReceive } from "./receive.js"
import { isMissingIdentityMapError, sendOneBot, sendQQBot } from "./sender.js"
import { isSendSuccess, targetProtocol } from "./message.js"
import { patchDirectSend } from "./direct.js"
import { withCurrentEvent } from "./context.js"

const patchFlag = Symbol.for("QWild.Plugin.RouterPatched")
const replyFlag = Symbol.for("QWild.Plugin.ReplyPatched")

function patchReply(e) {
  patchDirectSend()
  if (!config.enable || e?.[replyFlag] || !e?.reply?.bind) return
  if (shouldBypassRuntime()) return
  if (!config.send?.enable) return
  const protocol = eventProtocol(e)
  if (!["qqbot", "onebot"].includes(protocol)) return
  if (!e.isGroup && !e.isPrivate && !["group", "private"].includes(e.message_type)) return

  const baseReply = e.reply.bind(e)
  e.reply = async (msg = "", quote = false, data = {}) => {
    if (!msg) return false
    if (data?.qwild_no_route) return baseReply(msg, quote, data)
    const target = targetProtocol(msg, e)
    if (!target) return baseReply(msg, quote, data)
    if (target === protocol) return baseReply(msg, quote, data)

    try {
      const ret = target === "onebot"
        ? await sendOneBot(e, msg, baseReply)
        : await sendQQBot(e, msg, baseReply)
      if (isSendSuccess(ret) || !config.send.failover) return ret
      return baseReply(msg, quote, data)
    } catch (err) {
      if (isMissingIdentityMapError(err)) {
        if (config.identity?.unmapped_passthrough) return baseReply(msg, quote, data)
        return false
      }
      Bot.makeLog("error", [`[QWild] ${target === "onebot" ? "OneBotv11" : "QQBot"} 发送失败`, err], e.self_id)
      if (config.send.failover) return baseReply(msg, quote, data)
      return false
    }
  }
  e[replyFlag] = true
}

async function patchLoader() {
  const loaderUrl = pathToFileURL(path.join(process.cwd(), "lib/plugins/loader.js")).href
  const { default: PluginsLoader } = await import(loaderUrl)
  if (PluginsLoader[patchFlag]) return

  const originalDeal = PluginsLoader.deal.bind(PluginsLoader)
  const originalReply = PluginsLoader.reply.bind(PluginsLoader)

  PluginsLoader.deal = async function qwildDeal(e) {
    patchDirectSend()
    if (config.enable && !shouldBypassRuntime() && e?.post_type === "message") {
      const protocol = eventProtocol(e)
      if (protocol && !isReceiveForceAllowed(e) && shouldBlockReceive(e, protocol)) {
        Bot.makeLog(
          "debug",
          `[QWild] 已阻断 ${config.protocols[protocol]?.adapter || protocol} 消息：${e.raw_message || e.msg || ""}`,
          e.self_id,
        )
        return
      }
    }
    return withCurrentEvent(e, () => originalDeal(e))
  }

  PluginsLoader.reply = function qwildReply(e) {
    originalReply(e)
    patchReply(e)
  }

  PluginsLoader[patchFlag] = true
  patchDirectSend()
  Bot.on?.("connect", patchDirectSend)
  Bot.makeLog("info", "[QWild] 协议分流已接入")
}

await patchLoader()

export class qwildRouter extends plugin {
  constructor() {
    super({
      name: "QWild 协议分流",
      dsc: "QQBot 接收，OneBotv11 发送合并转发",
      event: "message",
      priority: -999999,
      rule: [],
    })
  }
}
