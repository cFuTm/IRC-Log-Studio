import assert from 'node:assert/strict'
import test from 'node:test'
import { draftFromEvent, eventFromDraft, newDraft, parseProject, removeEvent, saveEvent } from '../src/model.ts'
import { parseWorkspace } from '../src/desktop.ts'
import { currentNickResolver, replayRanks, sortUsersByRank } from '../src/ranks.ts'
import { applyEventEdit, moveEvent } from '../src/eventHistory.ts'
import { defaultTemplate, exportText } from '../src/render.ts'

const alice = { userId: 'alice', nick: 'Alice', hostmask: '~alice@example.net' }
const bob = { userId: 'bob', nick: 'Bob', hostmask: '' }
const users = [alice, bob].map(({ userId, nick }) => ({
  id: userId, nickname: nick, username: '', hostname: '', notes: '',
}))
const base = (order: number) => ({ order, id: String(order), timestamp: '2026-11-13T12:00:00' })
const message = (order: number, text: string, actor = alice) => ({ ...base(order), type: 'MESSAGE', actor, text })
const mode = (order: number, text: string, target = null as typeof alice | null) => ({
  ...base(order), type: 'MODE', actor: bob, mode: text, target,
})
const fixture = (events: object[], other: object[] = []) => parseProject(JSON.stringify({
  schemaVersion: 1, id: 'test', name: 'Ranks', users, nextOrder: 100,
  templateId: 'classic.json', channels: [
    { id: 'general', name: '#general', events },
    { id: 'other', name: '#other', events: other },
  ],
}))
const exportChannel = (project: ReturnType<typeof fixture>, channel = 'general') =>
  exportText(project, channel, defaultTemplate, false)

test('MODE follows channel array order, retains lower modes, and leaves other channels alone', () => {
  const project = fixture([
    message(11, 'Before'), mode(2, '+v', alice), message(3, 'Voice'),
    mode(4, '+o', alice), message(5, 'Operator'), mode(6, '-o', alice), message(7, 'After'),
  ], [message(8, 'Other channel')])
  assert.deepEqual(exportChannel(project).split('\r\n').filter((line) => line.startsWith('<')), [
    '<Alice> Before', '<+Alice> Voice', '<@Alice> Operator', '<+Alice> After',
  ])
  assert.equal(exportChannel(project, 'other'), '<Alice> Other channel')
})

test('editing or deleting a MODE recalculates history and ranks follow stable IDs across a NICK', () => {
  const project = fixture([
    mode(1, '+ov Alice Bob'),
    { ...base(2), type: 'NICK', actor: alice, newNick: 'Alice_' },
    message(3, 'Hello', { ...alice, nick: 'Alice_' }), message(4, 'Hi', bob),
  ])
  assert.match(exportChannel(project), /<@Alice_> Hello\r\n<\+Bob> Hi$/)
  assert.match(exportChannel(removeEvent(project, 'general', '1')), /<Alice_> Hello\r\n<Bob> Hi$/)
  const edited = fixture([mode(1, '+o', bob)]).channels[0].events[0]
  assert.match(exportChannel(saveEvent(project, 'general', edited, true)), /<Alice_> Hello\r\n<@Bob> Hi$/)
})

test('old templates show migrated ranks by default, with an independent project opt-out', () => {
  const project = fixture([mode(1, '+o', alice), message(2, 'Hello')])
  const before = JSON.stringify(project)
  const plain = { ...defaultTemplate, events: { ...defaultTemplate.events, message: '<{nick}> {text}' } }
  assert.match(exportChannel(project), /<@Alice> Hello$/)
  assert.match(exportText(project, 'general', plain, false), /<@Alice> Hello$/)
  assert.equal(JSON.stringify(project), before)
  assert.match(exportText({ ...project, showRankPrefixes: false }, 'general', plain, false), /<Alice> Hello$/)
  assert.match(exportText({ ...project, showRankPrefixes: false }, 'general', defaultTemplate, false), /<Alice> Hello$/)
})

test('initial modes, mixed rank operations and the current prefixes survive a workspace round trip', () => {
  const project = fixture([
    message(1, 'Founder'), mode(2, '-q+v Alice Bob'),
    message(3, 'Admin'), message(4, 'Voice', bob),
    mode(5, '+k swordfish'), mode(6, '+o Missing'), mode(7, '+b *!*@example.net'),
  ])
  project.channels[0].initialModes.alice = ['q', 'a']
  const stored = JSON.stringify({ project, path: null, channelId: 'general', fileDirty: true })
  const restored = parseWorkspace(stored).project
  assert.deepEqual(restored, project)
  assert.deepEqual([...replayRanks(restored.channels[0]).current], [['alice', '&'], ['bob', '+']])
  assert.deepEqual(restored.channels[0].events.slice(-3).map((event) => event.type === 'MODE' && event.changes), [[], [], []])
  assert.match(exportChannel(restored), /^<~Alice> Founder\r\n.*\r\n<&Alice> Admin\r\n<\+Bob> Voice/)
  assert.equal(restored.channels[0].events[0].type === 'MESSAGE' && restored.channels[0].events[0].actor.hostmask, '~alice@example.net')
})

test('saving structured or raw edits binds the same IDs, including ambiguous current names', () => {
  const draft = newDraft('#general', bob, 'MODE')
  const resolve = currentNickResolver([...users, { ...users[0], id: 'other-alice' }])
  const changes = [{ operation: 'add' as const, mode: 'h' as const, targetUserId: 'alice', targetNick: 'Alice' }]
  const event = eventFromDraft({ ...draft, modeChanges: changes }, 1, undefined, resolve)
  assert.equal(event.type, 'MODE')
  assert.equal(event.mode, '+h Alice')
  const edit = draftFromEvent(event, '#general')
  assert.deepEqual(eventFromDraft({ ...edit, rawMode: true }, 2, event, resolve), event)
  const reassigned = eventFromDraft({
    ...edit, rawMode: true, modeChanges: [{ ...changes[0], targetUserId: 'other-alice' }],
  }, 2, event, resolve)
  assert.equal(reassigned.type === 'MODE' && reassigned.changes[0].targetUserId, 'other-alice')
  const changed = eventFromDraft({ ...edit, rawMode: true, mode: '-o+v Bob Alice' }, 2, event, resolve)
  assert.equal(changed.type, 'MODE')
  assert.equal(changed.mode, '-o+v Bob Alice')
  assert.deepEqual(changed.changes.map(({ operation, targetUserId }) => [operation, targetUserId]), [['remove', 'bob']])
})

test('templates can use historical actor and target prefixes while system defaults remain plain', () => {
  const project = fixture([{ ...base(1), type: 'KICK', actor: alice, target: bob, reason: '' }])
  project.channels[0].initialModes = { alice: ['h'], bob: ['v'] }
  const template = {
    ...defaultTemplate,
    events: { kick: '{prefix} {displayNick} {actorDisplayNick} {targetDisplayNick} {nick} {actor} {target}' },
  }
  assert.equal(exportText(project, 'general', template, false), '% %Alice %Alice +Bob Alice Alice Bob')
  assert.equal(exportChannel(project), '*** Bob was kicked by Alice')
})

test('members sort by effective rank, then presence, then nickname', () => {
  const profiles = ['Alice', 'Bob', 'Cato', 'Dan', 'Zoe', 'Zhu'].map((nickname) => ({
    id: nickname, nickname, username: '', hostname: '', notes: '',
  }))
  const prefixes = new Map([['Alice', '@'], ['Bob', '~'], ['Cato', '@'], ['Zoe', '@']])
  const online = new Set(['Bob', 'Cato', 'Zoe', 'Zhu'])
  assert.deepEqual(sortUsersByRank(profiles, prefixes, online).map(({ id }) => id),
    ['Bob', 'Cato', 'Zoe', 'Alice', 'Zhu', 'Dan'])
})

test('dragging a MODE replays prefixes and undo restores events without reverting other settings', () => {
  const project = fixture([mode(2, '+o', alice), message(4, 'After')], [message(3, 'Elsewhere')])
  const before = project.channels[0].events
  const after = moveEvent(before, '2', '4', true)
  const edit = { channelId: 'general', before, after }
  const changed = applyEventEdit(project, edit, 'after')
  assert.equal(exportChannel(changed), '<Alice> After\r\n*** Bob sets mode +o Alice')
  assert.deepEqual(after.map(({ id, order }) => [id, order]), [['4', 2], ['2', 4]])
  assert.equal(changed.channels[1], project.channels[1])
  const restored = applyEventEdit({ ...changed, templateId: 'minimal.json' }, edit, 'before')
  assert.equal(restored.templateId, 'minimal.json')
  assert.equal(exportChannel(restored), '*** Bob sets mode +o Alice\r\n<@Alice> After')
  assert.equal(moveEvent(after, '2', '4', true), after)
})
