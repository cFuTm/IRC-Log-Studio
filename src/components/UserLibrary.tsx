import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Search, Users } from 'lucide-react'
import { snapshot, type User } from '../model.ts'
import { Dialog } from './Dialog.tsx'

export function UserLibrary({ users, memberIds, select, onSave, onClose }: {
  users: User[]
  memberIds: ReadonlySet<string>
  select?: (user: User) => void
  onSave: (user: User) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<User | null>(null)
  const matching = users.filter((user) => [user.nickname, user.username, user.hostname]
    .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())))
  const newUser = () => setDraft({ id: '', nickname: query.trim(), username: '', hostname: '', notes: '' })

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft?.nickname.trim()) return
    const saved = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      nickname: draft.nickname.trim(),
      username: draft.username.trim(),
      hostname: draft.hostname.trim(),
    }
    onSave(saved)
    if (!draft.id && select) select(saved)
    else setDraft(null)
  }

  return <Dialog title={draft ? (draft.id ? '编辑用户档案' : '新建用户档案') : '用户档案库'} onClose={onClose}>
    {draft ? <form className="dialog-body form-stack" onSubmit={save}>
      <label>昵称 <input autoFocus required value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} /></label>
      <div className="field-pair">
        <label>Username / Ident <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></label>
        <label>Hostname <input value={draft.hostname} onChange={(e) => setDraft({ ...draft, hostname: e.target.value })} /></label>
      </div>
      <label>备注 <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      <div className="dialog-actions">
        <button type="button" onClick={() => setDraft(null)}>返回档案库</button>
        <button className="primary" disabled={!draft.nickname.trim()}>保存档案</button>
      </div>
    </form> : <div className="dialog-body">
      <div className="library-search">
        <div className="search-input">
          <Search size={16} aria-hidden="true" />
          <input autoFocus aria-label="搜索用户" placeholder="搜索昵称、Username 或 Hostname" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button onClick={newUser}><Plus size={16} />新建用户</button>
      </div>
      <div className="profile-list">
        {matching.map((user) => <div className="profile" key={user.id}>
          <div className="profile-avatar" aria-hidden="true">{Array.from(user.nickname)[0]}</div>
          <div className="profile-details">
            <strong>{user.nickname}</strong>
            {snapshot(user).hostmask && <small>{snapshot(user).hostmask}</small>}
          </div>
          {memberIds.has(user.id) && <span className="member-label">频道成员</span>}
          <button className="icon-button" aria-label={`编辑 ${user.nickname}`} onClick={() => setDraft(user)}><Pencil size={15} /></button>
          {select && <button onClick={() => select(user)}>选择</button>}
        </div>)}
        {matching.length === 0 && <div className="library-empty"><Users size={22} /><p>{query ? '没有匹配的用户' : '档案库为空'}</p></div>}
      </div>
    </div>}
  </Dialog>
}
