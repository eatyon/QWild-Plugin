import { config } from "./model/config.js"
import { qwildAdmin } from "./apps/admin.js"
import { qwildHelp } from "./apps/help.js"
import { qwildUpdate } from "./apps/update.js"
import { withNoRoute } from "./apps/context.js"

function onOff(value) {
  return value ? "开启" : "关闭"
}

Bot.makeLog("info", "[QWild] 插件初始化完成")
Bot.makeLog("info", `[QWild] 当前状态：${onOff(config.enable)}`)

globalThis.QWild = {
  ...(globalThis.QWild || {}),
  withNoRoute,
}

await import("./apps/router.js")

export const apps = { qwildAdmin, qwildHelp, qwildUpdate }
