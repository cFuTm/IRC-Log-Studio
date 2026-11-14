import type { LogEvent, Project } from './model.ts'

export type EventEdit = {
  channelId: string
  before: LogEvent[]
  after: LogEvent[]
  nickname?: { userId: string; before: string; after: string }
}

export function applyEventEdit(project: Project, edit: EventEdit, direction: 'before' | 'after'): Project {
  const nickname = edit.nickname
  const previous = direction === 'before' ? 'after' : 'before'
  return {
    ...project,
    channels: project.channels.map((channel) => channel.id === edit.channelId
      ? { ...channel, events: edit[direction] } : channel),
    // A later profile edit may already have set a different nickname.
    users: nickname ? project.users.map((user) => user.id === nickname.userId && user.nickname === nickname[previous]
      ? { ...user, nickname: nickname[direction] } : user) : project.users,
  }
}

export function moveEvent(events: LogEvent[], eventId: string, targetId: string, after: boolean): LogEvent[] {
  if (eventId === targetId) return events
  const source = events.findIndex(({ id }) => id === eventId)
  const target = events.findIndex(({ id }) => id === targetId)
  if (source < 0 || target < 0) return events
  const destination = target + Number(after) - Number(source < target)
  if (destination === source) return events

  const result = [...events]
  const [event] = result.splice(source, 1)
  result.splice(destination, 0, event)
  // Reuse this channel's order slots so global JOIN/QUIT replay still has a stable cross-channel clock.
  const slots = events.map(({ order }) => order).sort((a, b) => a - b)
  return result.map((entry, index) => entry.order === slots[index] ? entry : { ...entry, order: slots[index] })
}
