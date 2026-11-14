import type { Actor, Channel, LogEvent, User } from './model.ts'

export const rankModes = ['q', 'a', 'o', 'h', 'v'] as const
export type RankMode = (typeof rankModes)[number]
export const ranks = {
  q: { name: 'Owner', prefix: '~' },
  a: { name: 'Admin', prefix: '&' },
  o: { name: 'Operator', prefix: '@' },
  h: { name: 'Half-operator', prefix: '%' },
  v: { name: 'Voice', prefix: '+' },
}
export type RankChange = {
  operation: 'add' | 'remove'
  mode: RankMode
  targetUserId: string
  targetNick: string
}
export type EventPrefixes = { actor?: string; target?: string }

export function highestMode(modes?: ReadonlySet<RankMode> | readonly RankMode[]): RankMode | undefined {
  return rankModes.find((mode) => modes && ('has' in modes ? modes.has(mode) : modes.includes(mode)))
}

function prefixFor(modes?: ReadonlySet<RankMode>): string {
  const highest = highestMode(modes)
  return highest ? ranks[highest].prefix : ''
}

export function sortUsersByRank(
  users: User[], prefixes: ReadonlyMap<string, string>, memberIds?: ReadonlySet<string>,
): User[] {
  const priority = rankModes.map((mode) => ranks[mode].prefix)
  const position = (user: User) => (priority.indexOf(prefixes.get(user.id) ?? '') + 1) || priority.length + 1
  return [...users].sort((left, right) =>
    position(left) - position(right)
    || Number(memberIds?.has(right.id) ?? false) - Number(memberIds?.has(left.id) ?? false)
    || left.nickname.localeCompare(right.nickname))
}

export function serializeRankChanges(changes: readonly RankChange[]): string {
  let expression = ''
  let sign = ''
  for (const change of changes) {
    const nextSign = change.operation === 'add' ? '+' : '-'
    expression += (sign === nextSign ? '' : nextSign) + change.mode
    sign = nextSign
  }
  return [expression, ...changes.map(({ targetNick }) => targetNick)].join(' ')
}

export function currentNickResolver(users: readonly User[]) {
  return nickResolver(users.map((user) => ({ userId: user.id, nick: user.nickname })))
}

export function nickResolver(identities: readonly Pick<Actor, 'userId' | 'nick'>[]) {
  const matches = new Map<string, Set<string>>()
  for (const { nick, userId } of identities) {
    if (!userId) continue
    const key = nick.toLowerCase()
    const ids = matches.get(key) ?? new Set<string>()
    ids.add(userId)
    matches.set(key, ids)
  }
  return (nick: string) => {
    const ids = matches.get(nick.toLowerCase())
    return ids?.size === 1 ? ids.values().next().value : undefined
  }
}

export function parseRankChanges(
  mode: string, target: Actor | null, resolveNick: (nick: string) => string | undefined,
): RankChange[] {
  const [expression, ...args] = mode.trim().split(/\s+/)
  if (!/^[+-][a-zA-Z+-]+$/.test(expression)) return []
  let operation: RankChange['operation'] = 'add'
  let argument = 0
  const changes: RankChange[] = []
  for (const letter of expression) {
    if (letter === '+' || letter === '-') {
      operation = letter === '+' ? 'add' : 'remove'
      continue
    }
    const rank = rankModes.find((mode) => mode === letter)
    if (!rank) {
      if ('beIk'.includes(letter) || (letter === 'l' && operation === 'add')) argument++
      continue
    }
    const nick = args[argument]
    const selected = argument === args.length ? target : null
    if (selected?.userId) changes.push({ operation, mode: rank, targetUserId: selected.userId, targetNick: selected.nick })
    else if (nick) {
      const targetUserId = resolveNick(nick)
      if (targetUserId) changes.push({ operation, mode: rank, targetUserId, targetNick: nick })
    }
    argument++
  }
  // Additional unassigned parameters can belong to unknown modes. Avoid guessing their targets.
  if (argument < args.length) return []
  return changes
}

export function legacyModeResolver(
  events: readonly (LogEvent | Omit<Extract<LogEvent, { type: 'MODE' }>, 'changes'>)[], users: readonly User[],
) {
  const identities: Pick<Actor, 'userId' | 'nick'>[] = users.map(({ id, nickname }) => ({ userId: id, nick: nickname }))
  for (const event of events) {
    if ('actor' in event && event.actor) identities.push(event.actor)
    if ('target' in event && event.target) identities.push(event.target)
    if (event.type === 'NICK') identities.push({ userId: event.actor.userId, nick: event.newNick })
  }
  return nickResolver(identities)
}

export function eventIdentities(event: LogEvent) {
  const change = event.type === 'MODE' && event.changes.length === 1 ? event.changes[0] : undefined
  const target = ('target' in event ? event.target : null)
    ?? (change ? { userId: change.targetUserId, nick: change.targetNick } : null)
  return { actor: 'actor' in event ? event.actor : null, target }
}

export function replayRanks(channel: Channel, stopBeforeId?: string) {
  const modes = new Map(Object.entries(channel.initialModes).map(([id, initial]) => [id, new Set(initial)]))
  const beforeEvent = new Map<string, EventPrefixes>()
  function actorPrefix(actor: Pick<Actor, 'userId'> | null) {
    return actor?.userId ? prefixFor(modes.get(actor.userId)) : ''
  }
  for (const event of channel.events) {
    if (event.id === stopBeforeId) break
    const identities = eventIdentities(event)
    const actor = actorPrefix(identities.actor)
    const target = actorPrefix(identities.target)
    if (actor || target) beforeEvent.set(event.id, { actor, target })
    if (event.type !== 'MODE') continue
    for (const change of event.changes) {
      const active = modes.get(change.targetUserId) ?? new Set<RankMode>()
      if (change.operation === 'add') active.add(change.mode)
      else active.delete(change.mode)
      modes.set(change.targetUserId, active)
    }
  }
  const current = new Map(Array.from(modes, ([id, active]) => [id, prefixFor(active)]))
  return { beforeEvent, current }
}
