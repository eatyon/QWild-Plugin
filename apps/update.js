import { createRequire } from "node:module"
import { Restart } from "../../other/restart.js"
import common from "../../../lib/common/common.js"

const require = createRequire(import.meta.url)
const { exec } = require("node:child_process")

let uping = false

export class qwildUpdate extends plugin {
  constructor() {
    super({
      name: "QWild 更新",
      dsc: "QWild-Plugin 更新",
      event: "message",
      priority: 10,
      rule: [
        {
          reg: "^#[Qq][Ww](强制)?更新$",
          fnc: "update",
          permission: "master",
        },
      ],
    })
  }

  async update() {
    if (this.e.at && !this.e.atme) return false
    if (uping) {
      await this.reply("已有更新命令执行中，请勿重复操作")
      return false
    }
    if (!(await this.checkGit())) return false

    const isForce = this.e.msg.includes("强制")
    uping = true
    try {
      await this.runUpdate(isForce)
      if (this.isUp) setTimeout(() => this.restart(), 2000)
    } finally {
      uping = false
    }
    return false
  }

  restart() {
    new Restart(this.e).restart()
  }

  async runUpdate(isForce) {
    const plugin = "QWild-Plugin"
    const pluginPath = `./plugins/${plugin}/`
    const upstream = await this.getUpstream(pluginPath)
    let command = `git -C ${pluginPath} pull --ff-only`

    if (isForce) {
      command = `git -C ${pluginPath} fetch --all && git -C ${pluginPath} reset --hard ${upstream} && ${command}`
      await this.reply("正在执行强制更新操作，请稍等")
    } else {
      await this.reply("正在执行更新操作，请稍等")
    }

    this.oldCommitId = await this.getCommitId(pluginPath)
    const ret = await this.exec(command)

    if (ret.error) {
      logger.mark(`${this.e.logFnc} 更新失败：${plugin}`)
      await this.gitErr(ret.error, ret.stdout)
      return false
    }

    const time = await this.getTime(pluginPath)
    if (/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)) {
      await this.reply(`${plugin}已经是最新版本\n最后更新时间：${time}`)
    } else {
      await this.reply(`${plugin}更新成功\n最后更新时间：${time}`)
      this.isUp = true
      const log = await this.getLog(plugin, pluginPath)
      if (log) await this.reply(log)
    }

    logger.mark(`${this.e.logFnc} 最后更新时间：${time}`)
    return true
  }

  async getLog(plugin, pluginPath) {
    const ret = await this.exec(`git -C ${pluginPath} log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format-local:"%F %T"`)
    if (ret.error || !ret.stdout) return ""

    const logs = []
    for (const line of ret.stdout.split("\n")) {
      const [commit, message] = line.split("||")
      if (commit === this.oldCommitId) break
      if (!message || message.includes("Merge branch")) continue
      logs.push(message)
    }

    if (!logs.length) return ""
    const end = "https://github.com/eatyon/QWild-Plugin"
    return common.makeForwardMsg(this.e, [logs.join("\n\n"), end], `${plugin}更新日志，共${logs.length}条`)
  }

  async getCommitId(pluginPath) {
    const ret = await this.exec(`git -C ${pluginPath} rev-parse --short HEAD`)
    return ret.stdout.trim()
  }

  async getTime(pluginPath) {
    const ret = await this.exec(`git -C ${pluginPath} log -1 --pretty=format:"%cd" --date=format-local:"%m-%d %H:%M"`)
    if (ret.error) {
      logger.error(ret.error.toString())
      return "获取时间失败"
    }
    return ret.stdout.trim()
  }

  async getUpstream(pluginPath) {
    const ret = await this.exec(`git -C ${pluginPath} rev-parse --abbrev-ref --symbolic-full-name @{u}`)
    return ret.error || !ret.stdout.trim() ? "origin/main" : ret.stdout.trim()
  }

  async gitErr(error, stdout = "") {
    const msg = "更新失败"
    const errMsg = error.toString()
    stdout = stdout.toString()

    if (errMsg.includes("Timed out")) {
      const remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, "") || "Git远程仓库"
      await this.reply(`${msg}\n连接超时：${remote}`)
      return
    }
    if (/Failed to connect|unable to access/i.test(errMsg)) {
      const remote = errMsg.match(/'(.+?)'/g)?.[0]?.replace(/'/g, "") || "Git远程仓库"
      await this.reply(`${msg}\n连接失败：${remote}`)
      return
    }
    if (errMsg.includes("be overwritten by merge") || stdout.includes("CONFLICT")) {
      await this.reply(`${msg}\n存在冲突\n请解决冲突后再更新，或者执行 #QW强制更新 放弃本地修改`)
      return
    }

    await this.reply([errMsg, stdout].filter(Boolean).join("\n"))
  }

  async exec(command) {
    return new Promise(resolve => {
      exec(command, { windowsHide: true }, (error, stdout, stderr) => {
        resolve({ error, stdout, stderr })
      })
    })
  }

  async checkGit() {
    const ret = await this.exec("git --version")
    if (!ret.stdout?.includes("git version")) {
      await this.reply("请先安装git")
      return false
    }
    return true
  }
}
