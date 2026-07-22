import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pkg = require("../package.json")

const pluginVersion = pkg.version ? `<span class="version">${pkg.version}</span>` : ""

const helpGroup = [
  {
    group: "基础命令，仅主人可用",
    list: [
      {
        title: "#QW帮助",
        desc: "查看 QWild 命令帮助",
      },
      {
        title: "#QW状态",
        desc: "查看插件状态与离线旁路情况",
      },
      {
        title: "#QW查看ID",
        desc: "查看当前 ID，QQBot 优先，支持艾特对象",
      },
      {
        title: "#QW搜索映射 ID",
        desc: "搜索群聊和用户身份映射",
      },
    ],
  },
  {
    group: "开关命令，仅主人可用",
    list: [
      {
        title: "#QW开启 / #QW关闭",
        desc: "开启或关闭 QWild 总开关",
      },
      {
        title: "#QW分流开启 / #QW分流关闭",
        desc: "开启或关闭发送分流",
      },
      {
        title: "#QW阻断QQBot开启 / 关闭",
        desc: "控制 QQBot 消息是否进入云崽插件",
      },
      {
        title: "#QW阻断OBv11开启 / 关闭",
        desc: "控制 OBv11 消息是否进入云崽插件",
      },
    ],
  },
  {
    group: "群聊映射，仅主人可用",
    list: [
      {
        title: "#QW绑定群聊",
        desc: "记录当前群，等待另一端上报并自动绑定",
      },
      {
        title: "#QW取消绑定群聊",
        desc: "取消正在等待的群聊绑定记录",
      },
      {
        title: "#QW添加群聊映射 A=B",
        desc: "手动添加完整 QQBot群ID 与 群号 映射",
      },
      {
        title: "#QW删除群聊映射",
        desc: "删除当前群聊映射，可追加完整 QQBot群ID 或 群号",
      },
    ],
  },
  {
    group: "用户映射，仅主人可用",
    list: [
      {
        title: "#QW绑定用户",
        desc: "自动绑定当前私聊用户，带 ID 可直接绑定",
      },
      {
        title: "#QW取消绑定用户",
        desc: "取消正在等待的用户绑定",
      },
      {
        title: "#QW添加用户映射 A=B",
        desc: "手动添加完整 QQBot用户ID 与 QQ号 映射",
      },
      {
        title: "#QW删除用户映射",
        desc: "删除当前用户映射，可追加完整 QQBot用户ID 或 QQ号",
      },
    ],
  },
  {
    group: "更新命令，仅主人可用",
    list: [
      {
        title: "#QW更新",
        desc: "从远程仓库拉取插件更新",
      },
      {
        title: "#QW强制更新",
        desc: "强制同步远程仓库版本",
      },
    ],
  },
]

export class qwildHelp extends plugin {
  constructor() {
    super({
      name: "QWild 帮助",
      dsc: "QWild 命令帮助",
      event: "message",
      priority: -999997,
      rule: [
        {
          reg: "^#[Qq][Ww]帮助$",
          fnc: "help",
          permission: "master",
        },
      ],
    })
  }

  async help() {
    if (!this.e.runtime) {
      logger.warn("[QWild] 未找到 e.runtime，无法渲染帮助图")
      return false
    }

    return this.e.runtime.render(
      "QWild-Plugin",
      "help/index",
      {
        helpCfg: {
          title: "QWild 帮助",
          subTitle: "Yunzai-Bot & QWild-Plugin",
          colCount: 2,
        },
        helpGroup,
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
}
