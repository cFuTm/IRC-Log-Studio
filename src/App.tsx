import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertCircle, Check, ChevronDown, Download, FilePlus2, FolderOpen, HardDrive,
  Hash, Pencil, Plus, RefreshCw, Save, SquareTerminal, Trash2, Users, X,
} from 'lucide-react'
import { Dialog } from './components/Dialog.tsx'
import { EventEditor } from './components/EventEditor.tsx'
import { ExportDialog } from './components/ExportDialog.tsx'
import { LogView } from './components/LogView.tsx'
import { UserLibrary } from './components/UserLibrary.tsx'
import { openProject, openTemplateDirectory, readTemplates, saveProject, type Workspace } from './desktop.ts'
import {
  deriveMembers, draftFromEvent, eventFromDraft, newDraft, newProject, removeEvent, saveEvent, snapshot,
  type Draft, type LogEvent, type Project, type User,
} from './model.ts'
import { defaultTemplate, defaultTemplateId, loadTemplates, type Template } from './render.ts'
import { useWorkspace } from './useWorkspace.ts'

type Modal = 'new-project' | 'new-channel' | 'rename-channel' | 'delete-channel' | 'delete-event' | 'export' | 'users'
type Edit = { id: string; draft: Draft }
const noMembers = new Set<string>()
const closed = () => undefined

export function App() {
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [userSlot, setUserSlot] = useState<'actor' | 'target' | null>(null)
  const [adding, setAdding] = useState<Draft>(newDraft)
  const [editing, setEditing] = useState<Edit | null>(null)
  const [scrollKey, setScrollKey] = useState(0)
  const [templates, setTemplates] = useState(() => new Map([[defaultTemplateId, defaultTemplate]]))
  const templateCache = useRef<Map<string, Template>>(templates)
  const [busy, setBusy] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const operation = useRef<Promise<void> | null>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  const reportError = (message: string) => setNotice({ message, error: true })
  const reportSuccess = (message: string) => setNotice({ message, error: false })
  const { workspace, current, ready, status, update, flush } = useWorkspace(reportError, () => operation.current)
  const { project, path, channelId, fileDirty } = workspace
  const channel = project.channels.find(({ id }) => id === channelId)
  const members = useMemo(() => deriveMembers(project.channels), [project.channels])
  const channelMembers = (channel && members.get(channel.id)) || noMembers
  const activeTemplateId = templates.has(project.templateId) ? project.templateId : defaultTemplateId
  const template = templates.get(activeTemplateId) ?? defaultTemplate
  const draft = editing?.draft ?? adding

  async function reloadTemplates(showSuccess = true) {
    setLoadingTemplates(true)
    try {
      const result = loadTemplates(await readTemplates(), templateCache.current)
      templateCache.current = result.templates
      setTemplates(result.templates)
      if (result.errors.length) reportError(`部分模板无法加载。\n${result.errors.join('\n')}`)
      else if (showSuccess) reportSuccess('已重新加载本地模板。')
    } catch (error) {
      reportError(`无法读取模板目录。\n${String(error)}`)
    } finally {
      setLoadingTemplates(false)
    }
  }

  useEffect(() => { void reloadTemplates(false) }, [])

  function run(label: string, action: () => Promise<void>) {
    if (operation.current || !ready) return
    if (menu.current) menu.current.open = false
    setBusy(true)
    operation.current = action().catch((error: unknown) => {
      reportError(`${label}失败。\n${String(error)}`)
    }).finally(() => {
      operation.current = null
      setBusy(false)
    })
  }

  function updateProject(next: Project, selectedChannel = current.current.channelId) {
    update({ ...current.current, project: next, channelId: selectedChannel, fileDirty: true })
  }

  function switchChannel(id: string) {
    if (channelId === id) return
    const next = project.channels.find((entry) => entry.id === id)
    if (!next) return
    setEditing(null)
    setAdding(newDraft(next.name))
    update({ ...current.current, channelId: id })
  }

  function allowReplace() {
    const { fileDirty, project } = current.current
    return !fileDirty || !(project.channels.length || project.users.length)
      || window.confirm('当前项目有未写入项目文件的改动。切换项目后，自动存档将记录新项目。继续切换？')
  }

  async function replaceWorkspace(next: Workspace) {
    await flush()
    update(next)
    setEditing(null)
    setAdding(newDraft(next.project.channels.find(({ id }) => id === next.channelId)?.name))
    setModal(null)
    await flush()
  }

  function openExisting() {
    run('打开项目', async () => {
      if (!allowReplace()) return
      const next = await openProject()
      if (next) {
        await replaceWorkspace(next)
        reportSuccess(`已打开 ${next.project.name}`)
      }
    })
  }

  function saveCurrent(saveAs = false) {
    run('保存项目', async () => {
      const stored = current.current
      const savedPath = await saveProject(stored, saveAs)
      if (!savedPath) return
      update({ ...current.current, path: savedPath, fileDirty: current.current.project !== stored.project })
      reportSuccess(`项目已保存至 ${savedPath}`)
      await flush()
    })
  }

  function changeDraft(patch: Partial<Draft>) {
    if (editing) setEditing({ ...editing, draft: { ...editing.draft, ...patch } })
    else setAdding({ ...adding, ...patch })
  }

  const selectEvent = useCallback((event: LogEvent) => {
    const { project, channelId } = current.current
    const name = project.channels.find(({ id }) => id === channelId)?.name ?? ''
    setEditing((previous) => previous?.id === event.id ? previous : { id: event.id, draft: draftFromEvent(event, name) })
  }, [current])
  const addChannel = useCallback(() => setModal('new-channel'), [])

  function submitEvent() {
    if (!channel) return
    const previous = editing && channel.events.find(({ id }) => id === editing.id)
    if (editing && !previous) return
    try {
      const event = eventFromDraft(draft, project.nextOrder, previous || undefined)
      const next = saveEvent(project, channel.id, event, !!previous)
      updateProject(next)
      if (!previous) {
        const user = next.users.find(({ id }) => id === adding.actor?.userId)
        const nextDraft = newDraft(channel.name, user ? snapshot(user) : adding.actor, adding.type)
        setAdding({ ...nextDraft, ...(adding.fixedTime ? { fixedTime: true, timestamp: adding.timestamp } : {}) })
        setScrollKey((key) => key + 1)
      }
      setEditing(null)
      setNotice(null)
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error))
    }
  }

  function saveUser(user: User) {
    const data = current.current.project
    const exists = data.users.some(({ id }) => id === user.id)
    updateProject({ ...data, users: exists ? data.users.map((item) => item.id === user.id ? user : item) : [...data.users, user] })
    if (exists) {
      setAdding((previous) => ({
        ...previous,
        actor: previous.actor?.userId === user.id ? snapshot(user) : previous.actor,
        target: previous.target?.userId === user.id ? snapshot(user) : previous.target,
      }))
    }
  }

  function submitName(name: string) {
    if (modal === 'new-project') {
      run('新建项目', async () => {
        if (allowReplace()) await replaceWorkspace({ project: newProject(name), path: null, channelId: null, fileDirty: true })
      })
    } else if (modal === 'new-channel') {
      const id = crypto.randomUUID()
      updateProject({ ...project, channels: [...project.channels, { id, name, events: [] }] }, id)
      setAdding(newDraft(name))
      setEditing(null)
      setModal(null)
    } else if (channel) {
      updateProject({ ...project, channels: project.channels.map((item) => item.id === channel.id ? { ...item, name } : item) })
      setAdding((draft) => draft.destination === channel.name ? { ...draft, destination: name } : draft)
      setModal(null)
    }
  }

  function confirmDelete() {
    if (!channel) return
    if (modal === 'delete-channel') {
      const channels = project.channels.filter(({ id }) => id !== channel.id)
      updateProject({ ...project, channels }, channels[0]?.id ?? null)
      setAdding(newDraft(channels[0]?.name))
    } else if (editing) {
      updateProject(removeEvent(project, channel.id, editing.id))
    }
    setEditing(null)
    setModal(null)
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!ready || busy || modal) return
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 's': event.preventDefault(); saveCurrent(event.shiftKey); break
          case 'o': event.preventDefault(); openExisting(); break
          case 'n': event.preventDefault(); setModal('new-project'); break
        }
      } else if (editing && event.key === 'Escape') {
        setEditing(null)
      } else if (editing && event.key === 'Delete' && !(event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]'))) {
        event.preventDefault()
        setModal('delete-event')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const closeModal = () => setModal(null)
  const showName = modal === 'new-project' || modal === 'new-channel' || modal === 'rename-channel'
  const deletingChannel = modal === 'delete-channel'
  const statusText = { idle: '本地工作区', pending: '等待自动存档', saved: '已自动存档', error: '自动存档失败' }[status]

  return <div className="app-shell">
    <header className="toolbar">
      <div className="brand"><span className="brand-icon"><SquareTerminal size={23} strokeWidth={1.7} /></span><span>IRC Log Studio</span></div>
      <div className="toolbar-divider" />
      <details className="project-menu" ref={menu}>
        <summary title={path ?? project.name}><span>{ready ? project.name : '正在恢复项目…'}</span><ChevronDown size={14} /></summary>
        <div className="menu-panel">
          <button disabled={!ready || busy} onClick={() => { if (menu.current) menu.current.open = false; setModal('new-project') }}><FilePlus2 size={16} />新建项目<span>Ctrl+N</span></button>
          <button disabled={!ready || busy} onClick={openExisting}><FolderOpen size={16} />打开项目<span>Ctrl+O</span></button>
          <button disabled={!ready || busy} onClick={() => saveCurrent(true)}><Save size={16} />另存为<span>Ctrl+Shift+S</span></button>
        </div>
      </details>
      <div className="toolbar-actions">
        <button disabled={!ready || busy} onClick={() => { setUserSlot(null); setModal('users') }}><Users size={17} />用户档案</button>
        <button disabled={!ready || busy} onClick={() => saveCurrent()} title="保存项目 (Ctrl+S)"><Save size={16} />保存</button>
        <button className="primary" disabled={!ready || busy} onClick={() => setModal('export')}><Download size={16} />导出</button>
      </div>
    </header>
    <div className="workspace" inert={!ready || busy}>
      <aside className="sidebar" aria-label="频道管理">
        <div className="sidebar-heading"><h2>频道</h2><button className="icon-button" onClick={addChannel} title="新建频道" aria-label="新建频道"><Plus size={19} /></button></div>
        <nav className="channel-list" aria-label="频道列表">
          {project.channels.map((entry) => <button key={entry.id}
            className={`channel-button${entry.id === channelId ? ' active' : ''}`}
            aria-current={entry.id === channelId ? 'true' : undefined} onClick={() => switchChannel(entry.id)}>
            <Hash size={17} /><span className="channel-name">{entry.name}</span><span className="channel-count">{entry.events.length}</span>
          </button>)}
          {project.channels.length === 0 && <p className="sidebar-empty">暂无频道</p>}
        </nav>
        {channel && <div className="channel-tools">
          <button onClick={() => setModal('rename-channel')}><Pencil size={15} />重命名</button>
          <button className="danger-text" onClick={() => setModal('delete-channel')}><Trash2 size={15} />删除频道</button>
        </div>}
        <div className="template-panel">
          <label>日志模板
            <select value={activeTemplateId} title={project.templateId === activeTemplateId ? undefined : `${project.templateId} 不可用`}
              onChange={(event) => updateProject({ ...project, templateId: event.target.value })}>
              {Array.from(templates, ([id, item]) => <option value={id} key={id}>{item.name}</option>)}
            </select>
          </label>
          {project.templateId !== activeTemplateId && <p className="missing-template">缺少 {project.templateId}</p>}
          <div className="template-actions">
            <button onClick={() => void openTemplateDirectory().catch((error: unknown) => reportError(`无法打开模板目录。\n${String(error)}`))}><FolderOpen size={15} />打开模板目录</button>
            <button className="icon-button" title="重新加载模板" aria-label="重新加载模板" disabled={loadingTemplates}
              onClick={() => void reloadTemplates()}><RefreshCw size={15} /></button>
          </div>
        </div>
      </aside>
      <LogView channel={channel} template={template} selectedId={editing?.id ?? null}
        scrollKey={scrollKey} select={selectEvent} newChannel={addChannel} />
      <EventEditor channel={channel} channels={project.channels} users={project.users} members={channelMembers}
        editing={!!editing} draft={draft} template={template} change={changeDraft} submit={submitEvent}
        cancel={() => setEditing(null)} remove={() => setModal('delete-event')}
        pickUser={(slot) => { setUserSlot(slot); setModal('users') }} />
    </div>
    <div>
      {notice && <div className={`notification${notice.error ? ' error' : ''}`} role={notice.error ? 'alert' : 'status'}>
        {notice.error ? <AlertCircle size={19} /> : <Check size={19} />}
        <span>{notice.message}</span>
        <button className="icon-button" aria-label="关闭通知" onClick={() => setNotice(null)}><X size={16} /></button>
      </div>}
    </div>
    <footer className="status-bar">
      <span><HardDrive size={14} />{path ? path.split(/[\\/]/).at(-1) : '工作区'}{path && fileDirty ? ' · 项目文件待保存' : ''}</span>
      <span className={`status-${status}`}><i />{statusText}</span>
    </footer>
    {showName && <NameDialog
      title={modal === 'new-project' ? '新建项目' : modal === 'new-channel' ? '新建频道' : '重命名频道'}
      label={modal === 'new-project' ? '项目名称' : '频道名称'}
      initial={modal === 'rename-channel' ? channel?.name ?? '' : ''}
      placeholder={modal === 'new-project' ? '例如 Test Archive' : '例如 #general'}
      busy={busy} onClose={busy ? closed : closeModal} onSubmit={submitName}
    />}
    {(deletingChannel || modal === 'delete-event') && <Dialog title={deletingChannel ? '删除频道' : '删除事件'} onClose={closeModal}>
      <div className="dialog-body">
        <p className="confirm-copy">{deletingChannel ? `确定删除 ${channel?.name} 及其中的 ${channel?.events.length ?? 0} 条事件？` : '确定删除所选事件？'}</p>
        <div className="dialog-actions"><button autoFocus onClick={closeModal}>取消</button><button className="destructive" onClick={confirmDelete}>确认删除</button></div>
      </div>
    </Dialog>}
    {modal === 'users' && <UserLibrary users={project.users} memberIds={channelMembers} onSave={saveUser} onClose={closeModal}
      select={userSlot ? (user) => { changeDraft({ [userSlot]: snapshot(user) }); closeModal() } : undefined} />}
    {modal === 'export' && <ExportDialog project={project} channelId={channelId} activeTemplate={activeTemplateId}
      templates={templates} onClose={closeModal} onExported={(file) => { closeModal(); reportSuccess(`已导出至 ${file}`) }} />}
  </div>
}

function NameDialog({ title, label, initial, placeholder, busy, onSubmit, onClose }: {
  title: string; label: string; initial: string; placeholder: string; busy: boolean
  onSubmit: (value: string) => void; onClose: () => void
}) {
  const [name, setName] = useState(initial)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() && !busy) onSubmit(name.trim())
  }
  return <Dialog title={title} onClose={onClose}>
    <form className="dialog-body form-stack" onSubmit={submit}>
      <label>{label}<input autoFocus required placeholder={placeholder} value={name} disabled={busy}
        onChange={(event) => setName(event.target.value)} /></label>
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={!name.trim() || busy}>确定</button>
      </div>
    </form>
  </Dialog>
}
