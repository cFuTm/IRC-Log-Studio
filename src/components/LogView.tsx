import { memo, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowDownToLine, GripVertical, Hash, Plus, SquareTerminal } from 'lucide-react'
import type { Channel, LogEvent } from '../model.ts'
import type { EventPrefixes } from '../ranks.ts'
import { formatEvent, type Template } from '../render.ts'

export const LogView = memo(function LogView({
  channel, template, selectedId, scrollKey, select, newChannel, prefixes, reorder, showRankPrefixes,
}: {
  channel: Channel | undefined
  template: Template
  selectedId: string | null
  scrollKey: number
  select: (event: LogEvent) => void
  newChannel: () => void
  prefixes?: ReadonlyMap<string, EventPrefixes>
  reorder: (eventId: string, targetId: string, after: boolean) => void
  showRankPrefixes: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const dragging = useRef<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const goToBottom = () => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0
    finishDrag()
  }, [channel?.id])
  useLayoutEffect(() => {
    if (scrollKey) goToBottom()
  }, [scrollKey])

  function finishDrag() {
    dragging.current = null
    setDrop(null)
  }

  function dropPosition(event: DragEvent<HTMLElement>) {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-event-id]') : null
    const id = row?.dataset.eventId
    if (!row || !id || !dragging.current || dragging.current === id) return null
    const rect = row.getBoundingClientRect()
    return { id, after: event.clientY >= rect.top + rect.height / 2 }
  }

  return <main className="log-pane" aria-label="日志预览">
    <div className="log-heading">
      <div className="log-channel"><span className="hash-mark"><Hash size={22} /></span><div>
        <h1>{channel?.name ?? '日志预览'}</h1>
        <p>{channel ? `${channel.events.length} 条事件` : '选择一个频道开始编写'}</p>
      </div></div>
      {channel && channel.events.length > 0 && <button className="icon-button" onClick={goToBottom}
        title="跳到日志末尾" aria-label="跳到日志末尾"><ArrowDownToLine size={18} /></button>}
    </div>
    <section className="terminal" aria-label={channel ? `${channel.name} 日志` : '频道日志'}>
      <div className="terminal-bar">
        <span><SquareTerminal size={15} />频道日志</span>
        <span className="terminal-template">{template.name}</span>
      </div>
      <div className="terminal-scroll" ref={viewport}
        onDragStart={(event) => {
          const handle = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-id]') : null
          if (!handle?.dataset.dragId) return
          window.getSelection()?.removeAllRanges()
          dragging.current = handle.dataset.dragId
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-irc-log-event', dragging.current)
        }}
        onDragOver={(event) => {
          if (!dragging.current) return
          event.preventDefault()
          const target = dropPosition(event)
          event.dataTransfer.dropEffect = target ? 'move' : 'none'
          setDrop((previous) => previous?.id === target?.id && previous?.after === target?.after ? previous : target)
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDrop(null)
        }}
        onDrop={(event) => {
          if (dragging.current) event.preventDefault()
          const target = dropPosition(event)
          if (target && dragging.current) reorder(dragging.current, target.id, target.after)
          finishDrag()
        }}
        onDragEnd={finishDrag}>
        {channel && channel.events.length ? channel.events.map((event) =>
          <div key={event.id} data-event-id={event.id} className={`log-entry${drop?.id === event.id ? drop.after ? ' drop-after' : ' drop-before' : ''}`}>
            {channel.events.length > 1 && <span className="log-drag-handle" data-drag-id={event.id} draggable
              title="拖动排序" aria-hidden="true"><GripVertical size={15} /></span>}
            <LogRow event={event} channel={channel.name} template={template} select={select}
              selected={selectedId === event.id} actorPrefix={prefixes?.get(event.id)?.actor}
              targetPrefix={prefixes?.get(event.id)?.target} showRankPrefixes={showRankPrefixes} />
          </div>,
        ) : <div className="terminal-empty">
          <span className="terminal-empty-icon"><SquareTerminal size={30} strokeWidth={1.5} /></span>
          <strong>{channel ? '这个频道还没有事件' : '还没有频道'}</strong>
          <p>{channel ? '在事件编辑器中添加第一条记录。' : '创建频道后，事件会在这里显示。'}</p>
          {!channel && <button onClick={newChannel}><Plus size={16} />新建频道</button>}
        </div>}
      </div>
    </section>
  </main>
})

const LogRow = memo(function LogRow({ event, channel, template, selected, select, actorPrefix, targetPrefix, showRankPrefixes }: {
  event: LogEvent; channel: string; template: Template; selected: boolean; select: (event: LogEvent) => void
  actorPrefix?: string; targetPrefix?: string
  showRankPrefixes: boolean
}) {
  const segments = formatEvent(event, channel, template, true, { actor: actorPrefix, target: targetPrefix }, showRankPrefixes)
  return <div role="button" tabIndex={0} aria-pressed={selected}
    className={`log-row log-${event.type.toLowerCase()}${selected ? ' is-selected' : ''}`}
    onClick={() => { if (window.getSelection()?.isCollapsed !== false) select(event) }}
    onKeyDown={(key) => {
      if (key.key === 'Enter' || key.key === ' ') {
        key.preventDefault()
        select(event)
      }
    }}
  >{segments.map(({ text, tone }, index) => <span className={tone} key={index}>{text}</span>)}</div>
})
