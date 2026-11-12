import { z } from 'zod'

const id = z.string().min(1)
const label = z.string().trim().min(1)
const content = z.string().refine((value) => value.trim().length > 0, '请输入内容')
const actor = z.object({ userId: id.nullable(), nick: label, hostmask: z.string() })
const timestamp = z.iso.datetime({ local: true, precision: 0 }).refine((value) => !value.endsWith('Z'))
const base = { id, order: z.number().int().positive(), timestamp }

export const connectionStates = [
  'Connecting', 'Connected', 'Disconnected', 'Ping timeout', 'Connection reset', 'Connection failed',
] as const

export const eventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('MESSAGE'), actor, text: content }),
  z.object({ ...base, type: z.literal('ACTION'), actor, text: content }),
  z.object({ ...base, type: z.literal('JOIN'), actor }),
  z.object({ ...base, type: z.literal('PART'), actor, reason: z.string() }),
  z.object({ ...base, type: z.literal('QUIT'), actor, reason: z.string() }),
  z.object({ ...base, type: z.literal('NICK'), actor, newNick: label }),
  z.object({ ...base, type: z.literal('KICK'), actor, target: actor, reason: z.string() }),
  z.object({ ...base, type: z.literal('TOPIC'), actor, topic: z.string() }),
  z.object({ ...base, type: z.literal('MODE'), actor, mode: label, target: actor.nullable() }),
  z.object({ ...base, type: z.literal('AWAY'), actor, away: z.boolean(), reason: z.string() }),
  z.object({ ...base, type: z.literal('NOTICE'), actor, text: content }),
  z.object({ ...base, type: z.literal('INVITE'), actor, target: actor, destination: label }),
  z.object({ ...base, type: z.literal('NETSPLIT'), actor: actor.nullable(), reason: content }),
  z.object({ ...base, type: z.literal('CONNECTION'), state: z.enum(connectionStates), reason: z.string() }),
  z.object({ ...base, type: z.literal('ERROR'), state: z.enum(connectionStates), reason: z.string() }),
  z.object({ ...base, type: z.literal('CUSTOM'), source: z.string(), text: content }),
])

const user = z.object({
  id, nickname: label, username: z.string(), hostname: z.string(), notes: z.string(),
})
const channel = z.object({ id, name: label, events: z.array(eventSchema) })
const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: label,
  users: z.array(user),
  channels: z.array(channel),
  templateId: label,
  nextOrder: z.number().int().positive(),
}).superRefine((project, ctx) => {
  const events = project.channels.flatMap(({ events }) => events)
  const orders = events.map(({ order }) => order)
  const unique = (values: (number | string)[]) => new Set(values).size === values.length
  if (!unique(project.users.map(({ id }) => id)) || !unique(project.channels.map(({ id }) => id))
    || !unique(events.map(({ id }) => id)) || !unique(orders)) {
    ctx.addIssue({ code: 'custom', message: '档案、频道或事件的标识或序号重复' })
  }
  if (orders.some((order) => order >= project.nextOrder)) {
    ctx.addIssue({ code: 'custom', path: ['nextOrder'], message: '下一条事件的序号无效' })
  }
})

export type Project = z.infer<typeof projectSchema>
export type Channel = z.infer<typeof channel>
export type User = z.infer<typeof user>
export type Actor = z.infer<typeof actor>
export type LogEvent = z.infer<typeof eventSchema>
export type EventType = LogEvent['type']
export type ConnectionState = (typeof connectionStates)[number]

export const eventLabels: Record<EventType, string> = {
  MESSAGE: '普通消息', ACTION: '动作', JOIN: '加入频道', PART: '离开频道',
  QUIT: '退出网络', NICK: '修改昵称', KICK: '踢出用户', TOPIC: '频道主题',
  MODE: '频道模式', AWAY: '离开状态', NOTICE: '通知', INVITE: '邀请',
  NETSPLIT: '网络分裂', CONNECTION: '连接状态', ERROR: '连接错误', CUSTOM: '自由事件',
}

export function newProject(name: string): Project {
  return { schemaVersion: 1, id: crypto.randomUUID(), name, users: [], channels: [], templateId: 'classic.json', nextOrder: 1 }
}

export function parseProject(text: string): Project {
  const raw: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion !== 1) {
    throw new Error(`此版本无法打开 schemaVersion ${String(raw.schemaVersion)} 的项目。`)
  }
  const result = projectSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`项目数据有误（${issue.path.join('.') || '根对象'}）\n${issue.message}`)
  }
  return result.data
}

export function localDateTime(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

export function snapshot(user: User): Actor {
  return {
    userId: user.id, nick: user.nickname,
    hostmask: [user.username, user.hostname].filter(Boolean).join('@'),
  }
}

export type Draft = {
  type: EventType
  actor: Actor | null
  target: Actor | null
  timestamp: string
  fixedTime: boolean
  text: string
  reason: string
  newNick: string
  topic: string
  mode: string
  away: boolean
  destination: string
  state: ConnectionState
  source: string
}

export function newDraft(channel = '', actor: Actor | null = null, type: EventType = 'MESSAGE'): Draft {
  return {
    type, actor, target: null, timestamp: localDateTime(), fixedTime: false,
    text: '', reason: '', newNick: '', topic: '', mode: '', away: true,
    destination: channel, state: type === 'ERROR' ? 'Connection failed' : 'Connecting', source: '',
  }
}

export function draftFromEvent(event: LogEvent, channel: string): Draft {
  return { ...newDraft(channel, null, event.type), ...event, fixedTime: true }
}

const fields: Record<string, string> = {
  actor: '操作者', target: '目标用户', text: '正文', reason: '说明', newNick: '新昵称',
  timestamp: '日期与时间', mode: '模式', destination: '目标频道',
}

export function eventFromDraft(draft: Draft, order: number, existing?: LogEvent): LogEvent {
  const result = eventSchema.safeParse({
    ...draft,
    timestamp: draft.fixedTime ? draft.timestamp : localDateTime(),
    id: existing?.id ?? crypto.randomUUID(),
    order: existing?.order ?? order,
    reason: draft.type === 'AWAY' && !draft.away ? '' : draft.reason,
  })
  if (!result.success) {
    const field = String(result.error.issues[0].path[0])
    throw new Error(`请填写有效的${fields[field] ?? '事件字段'}。`)
  }
  return result.data
}

export function saveEvent(project: Project, channelId: string, event: LogEvent, edit: boolean): Project {
  return {
    ...project,
    nextOrder: edit ? project.nextOrder : project.nextOrder + 1,
    users: !edit && event.type === 'NICK'
      ? project.users.map((user) => user.id === event.actor.userId ? { ...user, nickname: event.newNick } : user)
      : project.users,
    channels: project.channels.map((channel) => channel.id === channelId ? {
      ...channel,
      events: edit
        ? channel.events.map((previous) => previous.id === event.id ? event : previous)
        : [...channel.events, event],
    } : channel),
  }
}

export function removeEvent(project: Project, channelId: string, eventId: string): Project {
  return {
    ...project,
    channels: project.channels.map((channel) => channel.id === channelId
      ? { ...channel, events: channel.events.filter(({ id }) => id !== eventId) }
      : channel),
  }
}

export function deriveMembers(channels: Channel[]): Map<string, Set<string>> {
  const members = new Map(channels.map(({ id }) => [id, new Set<string>()]))
  const changes = channels.flatMap(({ id, events }) => events
    .filter((event) => ['JOIN', 'PART', 'QUIT', 'KICK'].includes(event.type))
    .map((event) => ({ channelId: id, event })))
  changes.sort((a, b) => a.event.order - b.event.order)

  for (const { channelId, event } of changes) {
    const group = members.get(channelId)
    switch (event.type) {
      case 'JOIN':
        if (event.actor.userId) group?.add(event.actor.userId)
        break
      case 'PART':
        if (event.actor.userId) group?.delete(event.actor.userId)
        break
      case 'KICK':
        if (event.target.userId) group?.delete(event.target.userId)
        break
      case 'QUIT':
        if (event.actor.userId) {
          const userId = event.actor.userId
          for (const memberSet of members.values()) memberSet.delete(userId)
        }
        break
    }
  }
  return members
}
