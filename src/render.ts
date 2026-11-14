import { z } from 'zod'
import { defaultTemplateId } from './model.ts'
import type { LogEvent, Project } from './model.ts'
import { eventIdentities, replayRanks, type EventPrefixes } from './ranks.ts'
import classic from './templates/classic.json' with { type: 'json' }
import ranked from './templates/classic-ranked.json' with { type: 'json' }
import chinese from './templates/classic-zh-cn.json' with { type: 'json' }

const templateSchema = z.object({
  name: z.string().trim().min(1),
  timestampFormat: z.string(),
  timestampWrapper: z.string(),
  events: z.record(z.string(), z.string()),
})
export type Template = z.infer<typeof templateSchema>
export type TemplateFile = { id: string; text: string | null; error: string | null }
export const defaultTemplate: Template = ranked

export function parseTemplate(text: string): Template {
  const result = templateSchema.safeParse(JSON.parse(text.replace(/^\uFEFF/, '')))
  if (!result.success) {
    throw new Error(`字段 ${result.error.issues[0].path.join('.') || '根对象'} 的格式无效`)
  }
  return result.data
}

export function loadTemplates(files: TemplateFile[], previous: Map<string, Template>) {
  const templates = new Map<string, Template>([
    [defaultTemplateId, defaultTemplate], ['classic.json', classic], ['classic-zh-cn.json', chinese],
  ])
  const errors: string[] = []
  for (const { id, text, error } of files) {
    try {
      if (text === null) throw new Error(error ?? '文件无法读取')
      templates.set(id, parseTemplate(text))
    } catch (cause) {
      const lastGood = previous.get(id)
      if (lastGood) templates.set(id, lastGood)
      errors.push(`${id}：${String(cause)}`)
    }
  }
  return { templates, errors }
}

export type Segment = { text: string; tone?: 'time' | 'nick' | 'content' }
const nicknameKeys = new Set([
  'actor', 'nick', 'oldNick', 'newNick', 'target', 'source', 'sourcePart',
  'prefix', 'displayNick', 'actorDisplayNick', 'targetDisplayNick',
])
const contentKeys = new Set(['text', 'topic'])
const variable = /\{([A-Za-z][A-Za-z0-9]*)\}/g

function segments(format: string, values: Record<string, string>): Segment[] {
  const output: Segment[] = []
  let offset = 0
  for (const match of format.matchAll(variable)) {
    const [token, key] = match
    const index = match.index
    if (index > offset) output.push({ text: format.slice(offset, index) })
    const text = Object.hasOwn(values, key) ? values[key] : token
    if (text) {
      const tone = nicknameKeys.has(key) ? 'nick' : contentKeys.has(key) ? 'content' : undefined
      output.push({ text, tone })
    }
    offset = index + token.length
  }
  if (offset < format.length) output.push({ text: format.slice(offset) })
  return output
}

export function formatEvent(
  event: LogEvent, channel: string, template: Template, showTimestamp = true, prefixes?: EventPrefixes,
  showRankPrefixes = true,
): Segment[] {
  const { actor, target: targetIdentity } = eventIdentities(event)
  const reason = 'reason' in event ? event.reason.trim() : ''
  const target = ('target' in event ? event.target?.nick : undefined) ?? ''
  const nick = actor?.nick ?? ''
  const hostmask = actor?.hostmask ?? ''
  const detailPart = reason ? `: ${reason}` : ''
  const prefix = showRankPrefixes ? prefixes?.actor ?? '' : ''
  const displayNick = prefix + nick
  const values: Record<string, string> = {
    channel, nick, actor: nick, oldNick: nick, hostmask, target, reason, detailPart,
    prefix, displayNick, actorDisplayNick: displayNick,
    targetDisplayNick: (showRankPrefixes ? prefixes?.target ?? '' : '') + (targetIdentity?.nick ?? ''),
    hostmaskPart: hostmask ? ` (${hostmask})` : '',
    reasonPart: reason ? ` (${reason})` : '',
    quitReasonPart: reason ? ` (${/^quit:/i.test(reason) ? reason : `Quit: ${reason}`})` : '',
  }
  let key = event.type.toLowerCase()
  switch (event.type) {
    case 'MESSAGE':
    case 'ACTION':
    case 'NOTICE':
      values.text = event.text
      break
    case 'NICK':
      values.newNick = event.newNick
      break
    case 'TOPIC':
      values.topic = event.topic
      break
    case 'MODE':
      values.mode = event.mode
      values.modeAndTarget = [event.mode, event.target?.nick].filter(Boolean).join(' ')
      break
    case 'AWAY':
      if (!event.away) key = 'awayBack'
      break
    case 'INVITE':
      values.channel = event.destination
      break
    case 'NETSPLIT':
      values.netsplitText = nick ? `${nick} has quit (${reason})` : `Netsplit: ${reason}`
      break
    case 'CONNECTION':
    case 'ERROR':
      values.state = event.state
      values.text = event.state + detailPart
      break
    case 'CUSTOM':
      values.source = event.source.trim()
      values.sourcePart = values.source ? `<${values.source}> ` : ''
      values.text = event.text
      break
  }

  const format = template.events[key] ?? classic.events[key as keyof typeof classic.events]
  if (['MESSAGE', 'ACTION', 'NOTICE'].includes(event.type) && !/\{(?:prefix|displayNick|actorDisplayNick)\}/.test(format)) {
    // Give older templates the same sender prefix as templates with explicit rank variables.
    values.nick = displayNick
    values.actor = displayNick
  }
  const body = segments(format, values)
  if (!showTimestamp || !template.timestampFormat || !template.timestampWrapper) return body
  const tokens: Record<string, string> = {
    YYYY: event.timestamp.slice(0, 4), MM: event.timestamp.slice(5, 7), DD: event.timestamp.slice(8, 10),
    HH: event.timestamp.slice(11, 13), mm: event.timestamp.slice(14, 16), ss: event.timestamp.slice(17, 19),
  }
  const time = template.timestampFormat.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => tokens[token])
  return [...segments(template.timestampWrapper, { time }).map(({ text }) => ({ text, tone: 'time' as const })), ...body]
}

export function renderEvent(
  event: LogEvent, channel: string, template: Template, showTimestamp = true, prefixes?: EventPrefixes, showRankPrefixes = true,
): string {
  return formatEvent(event, channel, template, showTimestamp, prefixes, showRankPrefixes).map(({ text }) => text).join('')
}

export function exportText(project: Project, channelId: string | null, template: Template, showTimestamp: boolean): string {
  return project.channels
    .filter(({ id }) => channelId === null || channelId === id)
    .map((channel) => {
      const { beforeEvent } = replayRanks(channel)
      const lines = channel.events.map((event) =>
        renderEvent(event, channel.name, template, showTimestamp, beforeEvent.get(event.id), project.showRankPrefixes))
      return (channelId === null ? [`=== ${channel.name} ===`, ...lines] : lines).join('\r\n')
    }).join('\r\n\r\n')
}

export function safeFilename(name: string): string {
  const clean = Array.from(name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/[. ]+$/, ''))
    .slice(0, 80).join('').replace(/[. ]+$/, '')
  return /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?: *\.|$)/i.test(clean) ? `_${clean}` : clean || 'irc-log'
}
