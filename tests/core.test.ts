import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  deriveMembers, draftFromEvent, eventFromDraft, eventLabels, localDateTime, newDraft, newProject,
  parseProject, removeEvent, saveEvent, snapshot, type Channel, type Draft, type Project, type User,
} from '../src/model.ts'
import { parseWorkspace, recoverWorkspace, type Workspace } from '../src/desktop.ts'
import { defaultTemplate, exportText, formatEvent, loadTemplates, renderEvent, safeFilename } from '../src/render.ts'

const example = () => parseProject(readFileSync(new URL('../examples/Studio-demo.irclogproj', import.meta.url), 'utf8'))
const timestamp = '2026-11-12T21:04:30'
const alice: User = { id: 'alice', nickname: 'Alice', username: '~alice', hostname: 'example.net', notes: '' }
const bob: User = { id: 'bob', nickname: 'Bob', username: '', hostname: '', notes: '' }
const event = (type: Draft['type'], order: number, patch: Partial<Draft> = {}) => eventFromDraft({
  ...newDraft('#general', snapshot(alice), type), timestamp, fixedTime: true, ...patch,
}, order)

test('classic renders all event types and both AWAY states', () => {
  const project = example()
  const types = new Set(project.channels.flatMap(({ events }) => events.map(({ type }) => type)))
  assert.deepEqual([...types].sort(), Object.keys(eventLabels).sort())
  assert.deepEqual(project.channels.map((channel) => channel.events.map((entry) =>
    renderEvent(entry, channel.name, defaultTemplate, false))), [
    [
      '--> Alice (~alice@example.net) has joined #general',
      '--> Bob has joined #general',
      '<Alice> Hello everyone! 欢迎来到 #general。',
      '<Bob> Hi! I found an old IRC transcript.',
      '* Alice waves at Bob',
      '*** Bob is now known as Bobby',
      '*** Alice has changed the topic to: Welcome to the archive night!',
      '*** Alice sets mode +v Bobby',
      '*** Bobby was kicked by Alice (No spoilers!)',
      '*** Bobby has quit (Quit: Goodbye!)',
      '*** Alice is away: Having dinner',
      '*** Alice is no longer away',
      '-ServerBot- Server restart in 10 minutes.',
    ],
    [
      '*** Alice invites Bobby to #archive',
      '--> Bobby has joined #archive',
      '*** Bobby has quit (irc-a.example.net irc-b.example.net)',
      '*** Connection reset',
      '*** Connecting: irc-a.example.net',
      '*** Connected',
      '<System> Archive synchronization finished.',
      '<-- Bobby has left #archive',
    ],
  ])
})

test('optional fields disappear and plain text survives without recursive substitution', () => {
  const cases: [ReturnType<typeof event>, string][] = [
    [event('QUIT', 1, { reason: ' ' }), '*** Alice has quit'],
    [event('QUIT', 2, { reason: 'Goodbye' }), '*** Alice has quit (Quit: Goodbye)'],
    [event('KICK', 3, { target: snapshot(bob) }), '*** Bob was kicked by Alice'],
    [event('MODE', 4, { mode: '+m' }), '*** Alice sets mode +m'],
    [event('AWAY', 5), '*** Alice is away'],
    [event('NETSPLIT', 6, { actor: null, reason: 'servers split' }), '*** Netsplit: servers split'],
    [event('CUSTOM', 7, { text: '<em>{nick} & 中文</em>' }), '<em>{nick} & 中文</em>'],
  ]
  for (const [entry, expected] of cases) assert.equal(renderEvent(entry, '#general', defaultTemplate, false), expected)
  const custom = { ...defaultTemplate, events: { message: '{unknown} {toString} {text}' } }
  const message = event('MESSAGE', 8, { text: '{nick}' })
  assert.equal(renderEvent(message, '#general', custom, false), '{unknown} {toString} {nick}')
})

test('NICK updates current defaults and leaves earlier snapshots intact', () => {
  let project: Project = { ...newProject('Test'), users: [alice], channels: [{ id: 'a', name: '#general', events: [] }] }
  const hello = event('MESSAGE', 1, { text: 'Hello' })
  const nick = event('NICK', 2, { newNick: 'Alice_' })
  project = saveEvent(project, 'a', hello, false)
  project = saveEvent(project, 'a', nick, false)
  assert.equal(project.users[0].nickname, 'Alice_')
  assert.equal(renderEvent(project.channels[0].events[0], '#general', defaultTemplate, false), '<Alice> Hello')
  assert.equal(renderEvent(nick, '#general', defaultTemplate, false), '*** Alice is now known as Alice_')
  const edited = eventFromDraft({ ...draftFromEvent(nick, '#general'), newNick: 'Alice2' }, 10, nick)
  project = saveEvent(project, 'a', edited, true)
  assert.equal(project.users[0].nickname, 'Alice_')
  assert.equal(project.channels[0].events[1].id, nick.id)
  assert.equal(project.channels[0].events[1].order, nick.order)
  project = removeEvent(project, 'a', nick.id)
  assert.deepEqual(project.channels[0].events, [hello])
})

test('editing a KICK preserves the event time, order and channel', () => {
  const project = example()
  const channel = project.channels[0]
  const index = channel.events.findIndex(({ type }) => type === 'KICK')
  const kick = channel.events[index]
  const updated = eventFromDraft({ ...draftFromEvent(kick, channel.name), reason: 'Please follow the rules.' }, project.nextOrder, kick)
  const result = saveEvent(project, channel.id, updated, true)
  assert.equal(updated.timestamp, kick.timestamp)
  assert.equal(updated.order, kick.order)
  assert.equal(updated.id, kick.id)
  assert.equal(result.nextOrder, project.nextOrder)
  assert.equal(result.channels[0].events[index], updated)
  assert.equal(result.channels[1], project.channels[1])
  const modifiedTime = eventFromDraft({ ...draftFromEvent(kick, channel.name), timestamp }, project.nextOrder, kick)
  assert.equal(modifiedTime.timestamp, timestamp)
})

test('editing or deleting membership events recomputes cross-channel state by write order', () => {
  const joinA = event('JOIN', 1)
  const joinB = event('JOIN', 2)
  const part = event('PART', 3)
  const nick = event('NICK', 4, { newNick: 'Alice_' })
  const quit = event('QUIT', 5)
  const rejoin = event('JOIN', 6)
  const kick = event('KICK', 7, { target: snapshot(alice), actor: snapshot(bob) })
  const channels: Channel[] = [
    { id: 'a', name: '#general', events: [joinA, part, quit] },
    { id: 'b', name: '#archive', events: [joinB, nick, rejoin, kick] },
  ]
  const project = { ...newProject('Membership'), channels, nextOrder: 8 }
  const flags = (value: typeof project) => Array.from(deriveMembers(value.channels).values(), (members) => members.has(alice.id))
  assert.deepEqual(flags(project), [false, false])
  const noKick = removeEvent(project, 'b', kick.id)
  assert.deepEqual(flags(noKick), [false, true])
  const noRejoin = removeEvent(noKick, 'b', rejoin.id)
  assert.deepEqual(flags(noRejoin), [false, false])
  const noQuit = removeEvent(noRejoin, 'a', quit.id)
  assert.deepEqual(flags(noQuit), [false, true])
  const noPart = removeEvent(noQuit, 'a', part.id)
  assert.deepEqual(flags(noPart), [true, true])
  const noJoin = removeEvent(noPart, 'a', joinA.id)
  assert.deepEqual(flags(noJoin), [false, true])
  const changedPart = saveEvent(noQuit, 'a', eventFromDraft({
    ...draftFromEvent(part, '#general'), actor: snapshot(bob),
  }, 8, part), true)
  assert.deepEqual(flags(changedPart), [true, true])
})

test('timestamp defaults to the current local second and permits fixed time', () => {
  const now = new Date(2026, 10, 12, 9, 8, 7)
  assert.equal(localDateTime(now), '2026-11-12T09:08:07')
  const before = localDateTime()
  const entry = event('JOIN', 1, { fixedTime: false, timestamp })
  assert.ok([before, localDateTime()].includes(entry.timestamp))
  assert.equal(event('JOIN', 2).timestamp, timestamp)
})

test('reloading an external template changes preview and TXT, leaving events intact', () => {
  const project = example()
  const original = JSON.stringify(project)
  const [channel] = project.channels
  const custom = {
    ...defaultTemplate, timestampFormat: 'YYYY/MM/DD HH:mm', timestampWrapper: '{time} | ',
    events: { join: '{nick} entered {channel}{hostmaskPart}' },
  }
  const { templates, errors } = loadTemplates([{ id: 'classic.json', text: JSON.stringify(custom), error: null }], new Map())
  assert.deepEqual(errors, [])
  const template = templates.get('classic.json')!
  const line = formatEvent(channel.events[0], channel.name, template).map(({ text }) => text).join('')
  assert.equal(line, '2026/11/12 21:04 | Alice entered #general (~alice@example.net)')
  assert.ok(exportText(project, channel.id, template, true).startsWith(line + '\r\n'))
  assert.ok(exportText(project, channel.id, template, false).startsWith('Alice entered #general'))
  assert.ok(!exportText(project, channel.id, template, true).includes('Archive synchronization'))
  assert.ok(exportText(project, null, template, true).includes('=== #archive ==='))
  assert.equal(JSON.stringify(project), original)
})

test('invalid templates retain last valid copies and identify offending files', () => {
  const existing = { ...defaultTemplate, name: 'Last good' }
  const { templates, errors } = loadTemplates([
    { id: 'classic.json', text: '{', error: null },
    { id: 'bad-schema.json', text: '{"name":7}', error: null },
    { id: 'bad-file.json', text: null, error: 'Invalid UTF-8' },
  ], new Map([['classic.json', existing]]))
  assert.equal(templates.get('classic.json'), existing)
  assert.equal(templates.size, 1)
  assert.deepEqual(errors.map((error) => error.split('：')[0]), ['classic.json', 'bad-schema.json', 'bad-file.json'])
})

test('project validation and workspace recovery preserve structure and Unicode', async () => {
  const project = example()
  const workspace: Workspace = { project, channelId: 'archive', path: 'D:/中文.irclogproj', fileDirty: true }
  const encoded = JSON.stringify(workspace)
  assert.deepEqual(parseWorkspace(encoded), workspace)
  assert.deepEqual(parseProject('\uFEFF' + JSON.stringify(project)), project)
  assert.throws(() => parseProject(JSON.stringify({ ...project, schemaVersion: 2 })), /schemaVersion 2/)
  assert.throws(() => parseProject(JSON.stringify({ ...project, nextOrder: 1 })), /nextOrder/)
  const calls: boolean[] = []
  const result = await recoverWorkspace(async (backup) => {
    calls.push(backup)
    return backup ? encoded : 'corrupt'
  })
  assert.deepEqual(calls, [false, true])
  assert.deepEqual(result.workspace, workspace)
  assert.equal(result.keepBackup, true)
  assert.match(result.warning, /备份/)
})

test('proposed Windows filenames preserve Unicode and avoid reserved names', () => {
  assert.equal(safeFilename('聊天/记录:*?. '), '聊天_记录___')
  assert.equal(safeFilename('CON.txt'), '_CON.txt')
  assert.equal(safeFilename(' ... '), 'irc-log')
})
