# QWild-Plugin

适用于 TRSS-Yunzai 的 QQBot 和 OneBot v11 双协议接收控制与发送分流插件。

## 功能

- 接收控制：可分别阻断 QQBot 或 OBv11 消息进入云崽插件处理
- 发送分流：按消息类型指定 QQBot 或 OBv11 发送协议
- 命令分流：按触发命令指定发送协议，优先级高于消息类型分流
- 身份映射：支持 QQBot群ID/用户ID 与 群号/QQ号 的对应关系
- 缺少映射时默认使用原协议发送
- 支持主动消息接管、发送失败切换协议、离线旁路

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

## 接收阻断

`receive.yaml` 可分别控制 QQBot 和 OBv11 消息是否进入云崽插件处理。

开启某个协议的接收阻断后：

- 用户过滤先判断，群聊过滤后判断，二者叠加决定当前会话是否阻断
- 黑名单模式：名单内阻断，名单外放行；空名单表示全部放行
- 白名单模式：名单内放行，名单外阻断；空名单表示全部阻断
- 当前会话被阻断时，命令放行规则命中后可放行

例如：OBv11 群聊白名单填 `123456789` 时，该群正常放行，其它群会被阻断；命令放行规则可让被阻断会话里的指定命令穿透。

QQBot名单请填写完整 `BotID:GroupID` 或 `BotID:UserID`，OBv11名单填写 QQ群号 或 QQ号。`BotID` 用于区分不同 QQBot 机器人。

## 发送分流

消息类型未指定协议时，表示 QWild 不接管该类型，直接使用原协议发送。留空不是默认协议，而是不接管。

可分流的消息类型：

```text
text        文本消息
image       图片消息
image_text  图文消息
markdown    Markdown 消息
button      按钮消息
file        文件消息
record      语音消息
video       视频消息
node        合并转发消息
forward     Forward 消息
link        链接消息
default     未知类型
```

类型判断优先级大致为：合并转发、Forward、Markdown、按钮、文件、视频、语音、图文、图片、链接、文本、未知类型。

`send.yaml` 中的 `command_rules` 可按命令指定发送协议，优先级高于消息类型分流。

示例：

```yaml
command_rules:
  - match: "starts"
    texts:
      - "#帮助"
      - "#菜单"
    protocol: "qqbot"
```

命令分流命中但 `protocol` 留空时，表示该命令回复走原协议，不再继续按消息类型分流。

跨协议发送需要配置身份映射。缺少群聊或用户映射时会自动走原协议；开启“发送失败切换协议”后，目标协议发送失败时会尝试回退到原协议。
跨协议发送时，回复消息里的艾特对象会按用户映射自动转换；未配置映射时保持原样。

## 身份映射

群聊映射格式：

```yaml
groups:
  "BotID:GroupID": "群号"
```

用户映射格式：

```yaml
users:
  "BotID:UserID": "QQ号"
```

QQBot侧必须填写完整 `BotID:GroupID` 或 `BotID:UserID`，另一侧填写 QQ群号 或 QQ号。

示例：

```yaml
groups:
  "123456789:GROUP_ID": "987654321"

users:
  "123456789:USER_ID": "10001"
```

## 命令

所有命令仅主人可用，`QW` 支持大小写。

基础命令：

```text
#QW帮助
#QW状态
#QW查看ID
#QW搜索映射 关键词
```

开关命令：

```text
#QW开启 / #QW关闭
#QW分流开启 / #QW分流关闭
#QW阻断QQBot开启 / #QW阻断QQBot关闭
#QW阻断OBv11开启 / #QW阻断OBv11关闭
```

群聊映射：

```text
#QW绑定群聊 / #QW取消绑定群聊
#QW添加群聊映射 BotID:GroupID=群号
#QW删除群聊映射
#QW删除群聊映射 BotID:GroupID
#QW删除群聊映射 群号
```

用户映射：

```text
#QW绑定用户
#QW绑定用户 另一端用户ID
#QW取消绑定用户
#QW添加用户映射 BotID:UserID=QQ号
#QW删除用户映射
#QW删除用户映射 BotID:UserID
#QW删除用户映射 QQ号
```

更新命令：

```text
#QW更新 / #QW强制更新
```

## 注意事项

- QWild 总开关关闭时，管理命令仍可使用，方便重新开启插件
- 接收阻断开启后，该协议收到的管理命令默认也会被阻断
- QQBot侧ID必须写完整 `BotID:ID`，用于区分不同 QQBot 机器人
- 添加映射时不允许覆盖，已存在需要先删除
- 手动添加映射时，`=` 前后顺序可以反过来写
- `#QW绑定群聊`、`#QW取消绑定群聊` 为双端绑定命令，QQBot 和 OBv11 接收阻断开启时会放行群聊
- `#QW查看ID` 在群聊和私聊中都会放行，QQBot 优先回复，OBv11 兜底回复

## 鸣谢

感谢 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
