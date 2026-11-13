# 日志模板变量

模板是 UTF-8 JSON 文件。预览和 TXT 导出使用相同的格式化规则。可从[带等级前缀的经典模板](../src/templates/classic-ranked.json)、[原版经典模板](../src/templates/classic.json)、[简体中文模板](../src/templates/classic-zh-cn.json)或[简洁模板](../src/templates/minimal.json)复制。

```json
{
  "name": "My IRC Log",
  "timestampFormat": "YYYY-MM-DD HH:mm:ss",
  "timestampWrapper": "[{time}] ",
  "events": {
    "join": "+ {nick} entered {channel}{hostmaskPart}",
    "message": "{nick} › {text}"
  }
}
```

## 顶层字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `name` | 非空字符串 | 在界面显示的模板名称 |
| `timestampFormat` | 字符串 | 时间标记组合。空字符串隐藏时间戳 |
| `timestampWrapper` | 字符串 | 包含 `{time}` 的包装文本。空字符串隐藏时间戳 |
| `events` | 字符串映射 | 事件格式。缺少的事件键使用内置经典模板 |

时间标记为 `YYYY` 年、`MM` 月、`DD` 日、`HH` 时、`mm` 分和 `ss` 秒。其他字符按字面输出。项目记录完整的本地日期和时间。

## 通用变量

| 变量 | 值 |
| --- | --- |
| `{channel}` | 日志所在频道。INVITE 使用目标频道 |
| `{nick}`、`{actor}`、`{oldNick}` | 操作者的历史昵称。NICK 用此值表示旧昵称 |
| `{target}` | 单独选择的目标用户的历史昵称 |
| `{prefix}` | 事件发生前，操作者在此频道的最高等级前缀。Normal 输出空字符串 |
| `{displayNick}`、`{actorDisplayNick}` | 等级前缀加操作者的历史昵称 |
| `{targetDisplayNick}` | 等级前缀加目标的历史昵称。MODE 有单个已解析目标时也可用 |
| `{hostmask}` | 操作者的历史 Hostmask |
| `{hostmaskPart}` | 有 Hostmask 时输出 ` (~alice@example.net)` |
| `{reason}` | 事件说明或原因 |
| `{reasonPart}` | 有原因时输出 ` (原因)` |
| `{quitReasonPart}` | 有原因时输出 ` (Quit: 原因)`。原文已含 `Quit:` 前缀时，保留原前缀 |
| `{detailPart}` | 有说明时输出 `: 说明` |

组合变量包含所需的前导空格和标点。字段为空时，组合变量输出空字符串。

带等级前缀的经典模板在 MESSAGE、ACTION 和 NOTICE 中使用 `{displayNick}`。如果要隐藏前缀，使用 `{nick}`。系统事件默认使用无前缀的昵称。

## 事件键和专用变量

| 事件键 | 对应事件 | 专用变量 |
| --- | --- | --- |
| `message` | MESSAGE | `{text}` 消息正文 |
| `action` | ACTION | `{text}` 动作内容 |
| `join` | JOIN | 通用变量 |
| `part` | PART | 通用变量 |
| `quit` | QUIT | 通用变量 |
| `nick` | NICK | `{newNick}` 新昵称 |
| `kick` | KICK | 通用变量 |
| `topic` | TOPIC | `{topic}` 新主题 |
| `mode` | MODE | `{mode}` 模式文本。 `{modeAndTarget}` 也包含单独选择的目标昵称 |
| `away` | AWAY，离开 | 通用变量 |
| `awayBack` | AWAY，取消离开 | 通用变量 |
| `notice` | NOTICE | `{text}` 通知正文 |
| `invite` | INVITE | 通用变量 |
| `netsplit` | NETSPLIT | `{netsplitText}` 由用户和断线描述组成的文本 |
| `connection` | CONNECTION | `{state}` 连接状态。 `{text}` 包含状态和可选说明 |
| `error` | ERROR | `{state}` 连接状态。 `{text}` 包含状态和可选说明 |
| `custom` | CUSTOM | `{text}` 自定义正文。 `{source}` 来源。 `{sourcePart}` 有来源时输出 `<来源> ` |

未知变量保留原样。替换只执行一遍。应用将模板和变量中的内容显示为纯文本。重新加载时，如果模板文件无效，应用会报告文件名，并继续使用上一次有效的版本。首次加载没有有效版本时，预览使用内置经典模板。
