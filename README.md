# QWild-Plugin

适用于 TRSS-Yunzai 的 QQBot 和 OneBot v11 双协议接收控制与发送分流插件

## 功能

- 接收控制：可分别阻断 QQBot 或 OBv11 消息进入云崽插件处理
- 发送分流：按消息类型指定 QQBot 或 OBv11 发送协议
- 命令分流：按触发命令指定发送协议，优先级高于消息类型分流
- 身份映射：支持 QQBot 群/用户 ID 与 OBv11 群号/QQ 的对应关系
- 未映射不分流：缺少映射时默认使用原协议发送
- 支持主动私聊接管、发送失败切换协议、离线旁路

## 安装

在云崽根目录执行：

```bash
git clone https://github.com/eatyon/QWild-Plugin.git plugins/QWild-Plugin
```

然后重启云崽

## 配置

推荐使用锅巴配置。

发送分流默认开启，接收阻断默认关闭，可在锅巴或配置文件中调整。

默认配置文件：

```text
plugins/QWild-Plugin/config/default/
```

用户配置文件：

```text
plugins/QWild-Plugin/config/basic.yaml
plugins/QWild-Plugin/config/receive.yaml
plugins/QWild-Plugin/config/send.yaml
plugins/QWild-Plugin/config/identity.yaml
```

## 发送分流

消息类型未指定协议时，表示 QWild 不接管该类型，直接使用原协议发送。

`send.yaml` 中的 `command_rules` 可按命令指定发送协议，优先级高于消息类型分流。

示例：

```yaml
command_rules:
  - match: "starts"
    text: "#QW帮助"
    protocol: "qqbot"
```

## 身份映射

群聊映射格式：

```yaml
groups:
  "QQBot机器人ID:QQBot群ID": "OBv11群号"
```

用户映射格式：

```yaml
users:
  "QQBot机器人ID:QQBot用户ID": "OBv11QQ"
```

所有 ID 都按字符串处理，不会转数字。

## 命令

所有命令仅主人可用，`QW` 支持大小写。

```text
#QW帮助
#QW状态
#QW查看ID
#QW更新
#QW强制更新
#QW开启
#QW关闭
#QW分流开启
#QW分流关闭
#QW阻断QQBot开启
#QW阻断QQBot关闭
#QW阻断OBv11开启
#QW阻断OBv11关闭
#QW阻断OneBotv11开启
#QW阻断OneBotv11关闭

#QW绑定群聊
#QW取消绑定群聊
#QW添加群聊映射 QQBot群ID=OBv11群号
#QW删除群聊映射
#QW删除群聊映射 群ID

#QW绑定用户
#QW绑定用户 另一端用户ID
#QW取消绑定用户
#QW添加用户映射 QQBot用户ID=OBv11QQ
#QW删除用户映射
#QW删除用户映射 用户ID
```

管理命令不受 QWild 总开关影响；如果当前协议开启接收阻断，管理命令也会被阻断。

添加映射时不允许覆盖，已存在需要先删除。手动添加的 `=` 前后顺序可以反过来写。

## 鸣谢

感谢 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
