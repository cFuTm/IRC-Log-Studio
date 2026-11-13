import { useEffect, useState } from 'react'
import { BookUser, Clock3, FilePenLine, Plus, Save, Trash2, X } from 'lucide-react'
import {
  connectionStates, eventFromDraft, eventLabels, localDateTime, snapshot,
  type Actor, type Channel, type Draft, type EventType, type LogEvent, type User,
} from '../model.ts'
import { eventIdentities, parseRankChanges, rankModes, ranks, serializeRankChanges, sortUsersByRank, type RankChange } from '../ranks.ts'
import { renderEvent, type Template } from '../render.ts'

const noPrefixes = new Map<string, string>()

export function EventEditor({
  draft, channel, channels, users, members, editing, template, change, submit, cancel, remove, pickUser,
  currentRanks = noPrefixes, previewRanks = noPrefixes, existing, resolveNick,
}: {
  draft: Draft
  channel: Channel | undefined
  channels: Channel[]
  users: User[]
  members: ReadonlySet<string>
  editing: boolean
  template: Template
  change: (patch: Partial<Draft>) => void
  submit: () => void
  cancel: () => void
  remove: () => void
  pickUser: (slot: 'actor' | 'target' | number) => void
  currentRanks?: ReadonlyMap<string, string>
  previewRanks?: ReadonlyMap<string, string>
  existing?: LogEvent
  resolveNick: (nick: string) => string | undefined
}) {
  const [clock, setClock] = useState(localDateTime)
  useEffect(() => {
    if (draft.fixedTime) return
    setClock(localDateTime())
    const timer = setInterval(() => setClock(localDateTime()), 1000)
    return () => clearInterval(timer)
  }, [draft.fixedTime])

  const { type } = draft
  const connection = type === 'CONNECTION' || type === 'ERROR'
  const actor = !connection && type !== 'CUSTOM'
  const target = type === 'KICK' || type === 'INVITE' || (type === 'MODE' && draft.rawMode)
  const reason = ['PART', 'QUIT', 'KICK', 'NETSPLIT'].includes(type) || connection || (type === 'AWAY' && draft.away)
  const text = type === 'MESSAGE' || type === 'ACTION' || type === 'NOTICE' || type === 'CUSTOM'
  const bodyLabel = type === 'ACTION' ? '动作内容' : type === 'CUSTOM' ? '自定义正文' : '消息内容'
  let preview = ''
  try {
    if (channel) {
      const event = eventFromDraft({ ...draft, fixedTime: true, timestamp: draft.fixedTime ? draft.timestamp : clock }, 1, existing, resolveNick)
      const identities = eventIdentities(event)
      const prefix = (user: Pick<Actor, 'userId'> | null) => user?.userId ? previewRanks.get(user.userId) : undefined
      preview = renderEvent(event, channel.name, template, true, {
        actor: prefix(identities.actor),
        target: prefix(identities.target),
      })
    }
  } catch {
    // An incomplete draft has no formatted preview.
  }

  function chooseType(next: EventType) {
    const state = next === 'ERROR' ? 'Connection failed' : 'Connecting'
    change({
      type: next,
      ...(next === 'ERROR' || next === 'CONNECTION' ? { state } : {}),
      ...(next === 'INVITE' && !draft.destination ? { destination: channel?.name ?? '' } : {}),
      ...(next !== 'NOTICE' && draft.actor?.userId === null ? { actor: null } : {}),
    })
  }

  return <aside className="editor" aria-label="事件编辑器">
    <div className="editor-heading">
      <div className="heading-icon"><FilePenLine size={18} /></div>
      <div><h2>事件编辑器</h2><p>{editing ? '修改所选事件' : '新增事件'}</p></div>
      {editing && <button className="icon-button editor-close" aria-label="取消编辑" onClick={cancel}><X size={18} /></button>}
    </div>
    {!channel ? <div className="editor-empty">创建或选择频道后即可添加事件。</div> :
      <form className="editor-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <div className="editor-fields form-stack">
          <label>事件类型
            <select value={type} onChange={(event) => chooseType(event.target.value as EventType)}>
              {Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label} · {key}</option>)}
            </select>
          </label>
          <label>日期与时间
            <input type="datetime-local" step="1" required value={draft.fixedTime ? draft.timestamp : clock}
              onChange={(event) => {
                const value = event.target.value
                change({ timestamp: value.length === 16 ? `${value}:00` : value, fixedTime: true })
              }} />
          </label>
          {!editing && <button type="button" className="time-mode"
            onClick={() => change({ timestamp: localDateTime(), fixedTime: !draft.fixedTime })}>
            <Clock3 size={13} />{draft.fixedTime ? '已固定时间 · 恢复自动' : '使用当前时间 · 点击固定'}
          </button>}
          {actor && <UserPicker
            label={type === 'MESSAGE' || type === 'NOTICE' ? '发送者' : '操作者'}
            value={draft.actor} users={users} members={members} prefixes={currentRanks} optional={type === 'NETSPLIT'}
            allowFree={type === 'NOTICE'} onChange={(value) => change({ actor: value })} open={() => pickUser('actor')}
          />}
          {target && <UserPicker
            label="目标用户" value={draft.target} users={users} members={members} prefixes={currentRanks} optional={type === 'MODE'}
            onChange={(value) => change({ target: value })} open={() => pickUser('target')}
          />}
          {type === 'INVITE' && <label>目标频道
            <input required list="invite-channels" value={draft.destination} onChange={(event) => change({ destination: event.target.value })} />
            <datalist id="invite-channels">{channels.map(({ id, name }) => <option key={id} value={name} />)}</datalist>
          </label>}
          {type === 'NICK' && <label>新昵称
            <input required value={draft.newNick} onChange={(event) => change({ newNick: event.target.value })} />
          </label>}
          {type === 'TOPIC' && <label>频道主题
            <input value={draft.topic} onChange={(event) => change({ topic: event.target.value })} placeholder="留空可清除主题" />
          </label>}
          {type === 'MODE' && <ModeFields key={existing?.id ?? 'new'} draft={draft} existing={existing} users={users}
            members={members} prefixes={currentRanks} resolveNick={resolveNick} change={change} pickUser={pickUser} />}
          {type === 'AWAY' && <label>离开状态
            <select value={draft.away ? 'away' : 'back'} onChange={(event) => change({ away: event.target.value === 'away' })}>
              <option value="away">离开</option><option value="back">取消离开</option>
            </select>
          </label>}
          {connection && <label>连接状态
            <select value={draft.state} onChange={(event) => change({ state: event.target.value as Draft['state'] })}>
              {connectionStates.map((state) => <option key={state}>{state}</option>)}
            </select>
          </label>}
          {reason && <label>{type === 'NETSPLIT' ? '服务器或断线描述' : '原因或说明（可选）'}
            <textarea rows={3} required={type === 'NETSPLIT'} value={draft.reason} onChange={(event) => change({ reason: event.target.value })} />
          </label>}
          {type === 'CUSTOM' && <label>来源（可选）
            <input value={draft.source} onChange={(event) => change({ source: event.target.value })} placeholder="例如 System" />
          </label>}
          {text && <label>{bodyLabel}
            <textarea rows={5} required value={draft.text} onChange={(event) => change({ text: event.target.value })}
              placeholder={type === 'MESSAGE' ? '输入一条 IRC 消息…' : `输入${bodyLabel}…`} />
          </label>}
          {preview && <div className="draft-preview"><span>格式预览</span><p>{preview}</p></div>}
        </div>
        <div className="editor-actions">
          <button className="primary full-width">
            {editing ? <Save size={17} /> : <Plus size={18} />}{editing ? '保存修改' : '添加事件'}
          </button>
          {editing && <div className="edit-secondary">
            <button type="button" onClick={cancel}>取消编辑</button>
            <button type="button" className="danger-text" onClick={remove}><Trash2 size={15} />删除事件</button>
          </div>}
        </div>
      </form>}
  </aside>
}

function ModeFields({ draft, existing, users, members, prefixes, resolveNick, change, pickUser }: {
  draft: Draft
  existing?: LogEvent
  users: User[]
  members: ReadonlySet<string>
  prefixes: ReadonlyMap<string, string>
  resolveNick: (nick: string) => string | undefined
  change: (patch: Partial<Draft>) => void
  pickUser: (slot: number) => void
}) {
  const [error, setError] = useState('')
  const defaultChange: RankChange = { operation: 'add', mode: 'o', targetUserId: '', targetNick: '' }
  const entries = draft.modeChanges.length ? draft.modeChanges : [defaultChange]
  function updateEntry(index: number, patch: Partial<RankChange>) {
    change({ modeChanges: entries.map((entry, itemIndex) => itemIndex === index ? { ...entry, ...patch } : entry) })
  }

  function toggleMode() {
    setError('')
    if (!draft.rawMode) {
      change({ rawMode: true, mode: draft.modeChanges.every(({ targetUserId }) => targetUserId)
        ? serializeRankChanges(draft.modeChanges) : '', target: null })
      return
    }
    const expression = [draft.mode.trim(), draft.target?.nick].filter(Boolean).join(' ')
    if (!expression) {
      change({ rawMode: false, target: null })
      return
    }
    const unchanged = existing?.type === 'MODE' && draft.mode.trim() === existing.mode
      && draft.target?.userId === existing.target?.userId && draft.target?.nick === existing.target?.nick
    const changes = expression === serializeRankChanges(draft.modeChanges) ? draft.modeChanges
      : unchanged ? existing.changes : parseRankChanges(draft.mode, draft.target, resolveNick)
    const [letters, ...args] = expression.split(/\s+/)
    const canonical = letters.replace(/([+-])([qaohv]+)(?:\1([qaohv]+))+/g, (group) =>
      group[0] + group.slice(1).replace(/[+-]/g, ''))
    if ([canonical, ...args].join(' ') !== serializeRankChanges(changes)) {
      setError('这条指令包含原始模式或未匹配的目标，请继续使用原始输入。')
      return
    }
    change({ rawMode: false, modeChanges: changes, target: null })
  }

  return <div className="form-stack">
    <button type="button" onClick={toggleMode}>{draft.rawMode ? '切换到等级操作' : '切换到原始输入'}</button>
    {error && <p role="alert" className="inline-error">{error}</p>}
    {draft.rawMode ? <label>模式字符串
      <input required value={draft.mode} onChange={(event) => { setError(''); change({ mode: event.target.value }) }}
        placeholder="+ov Alice Bob、-o+v Alice Bob、+m" />
    </label> : <>
      {entries.map((entry, index) => {
        const user = users.find(({ id }) => id === entry.targetUserId)
        return <fieldset key={index} className="form-stack mode-change">
          <legend>等级变更 {index + 1}</legend>
          <div className="field-pair">
            <label>操作
              <select value={entry.operation} onChange={(event) => updateEntry(index, { operation: event.target.value as RankChange['operation'] })}>
                <option value="add">赋予等级</option><option value="remove">移除等级</option>
              </select>
            </label>
            <label>等级
              <select value={entry.mode} onChange={(event) => updateEntry(index, { mode: event.target.value as RankChange['mode'] })}>
                {rankModes.map((mode) => <option key={mode} value={mode}>{ranks[mode].name} ({entry.operation === 'add' ? '+' : '-'}{mode})</option>)}
              </select>
            </label>
          </div>
          <UserPicker label="等级目标" value={entry.targetUserId ? {
            userId: entry.targetUserId, nick: entry.targetNick, hostmask: user ? snapshot(user).hostmask : '',
          } : null} users={users} members={members} prefixes={prefixes}
            onChange={(value) => updateEntry(index, { targetUserId: value?.userId ?? '', targetNick: value?.nick ?? '' })}
            open={() => { if (!draft.modeChanges.length) change({ modeChanges: entries }); pickUser(index) }} />
          {entries.length > 1 && <button type="button" className="danger-text"
            onClick={() => change({ modeChanges: entries.filter((_, itemIndex) => itemIndex !== index) })}>删除此变更</button>}
        </fieldset>
      })}
      <button type="button" onClick={() => change({ modeChanges: [...entries, defaultChange] })}><Plus size={15} />添加等级变更</button>
    </>}
  </div>
}

function UserPicker({ label, value, users, members, prefixes, optional, allowFree, onChange, open }: {
  label: string
  value: Actor | null
  users: User[]
  members: ReadonlySet<string>
  prefixes: ReadonlyMap<string, string>
  optional?: boolean
  allowFree?: boolean
  onChange: (actor: Actor | null) => void
  open: () => void
}) {
  const sorted = sortUsersByRank(users, prefixes)
  const memberUsers = sorted.filter(({ id }) => members.has(id))
  const others = sorted.filter(({ id }) => !members.has(id))
  const profile = users.find(({ id }) => id === value?.userId)
  const historical = !!value?.userId && (!profile || value.nick !== profile.nickname || value.hostmask !== snapshot(profile).hostmask)
  const selected = historical ? 'historical' : value ? (value.userId ? `user:${value.userId}` : 'free') : ''

  return <div className="form-stack user-picker">
    <div className="user-control">
      <label>{label}{optional ? '（可选）' : ''}
        <select value={selected} onChange={(event) => {
          const key = event.target.value
          const user = users.find(({ id }) => key === `user:${id}`)
          if (key === 'historical') return
          onChange(user ? snapshot(user) : key === 'free' ? { userId: null, nick: '', hostmask: '' } : null)
        }}>
          <option value="">{optional ? '无' : '选择用户…'}</option>
          {historical && <option value="historical">{prefixes.get(value?.userId ?? '')}{value?.nick}（历史快照）</option>}
          {memberUsers.length > 0 && <optgroup label="当前频道成员">{memberUsers.map((user) =>
            <option key={user.id} value={`user:${user.id}`}>{prefixes.get(user.id)}{user.nickname}</option>)}</optgroup>}
          {others.length > 0 && <optgroup label="其他档案">{others.map((user) =>
            <option key={user.id} value={`user:${user.id}`}>{prefixes.get(user.id)}{user.nickname}</option>)}</optgroup>}
          {(allowFree || selected === 'free') && <option value="free">自定义名称</option>}
        </select>
      </label>
      <button type="button" className="icon-button field-button" aria-label={`从档案库选择${label}`} title="打开用户档案库" onClick={open}><BookUser size={17} /></button>
    </div>
    {selected === 'free' && <label>发送者名称
      <input required value={value?.nick ?? ''} placeholder="服务器、机器人或用户名称"
        onChange={(event) => onChange({ userId: null, nick: event.target.value, hostmask: '' })} />
    </label>}
    {value?.hostmask && <span className="hostmask">{value.hostmask}</span>}
  </div>
}
