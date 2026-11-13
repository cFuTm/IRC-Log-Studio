import { memo, useLayoutEffect, useRef } from 'react'
import { ArrowDownToLine, Hash, Plus, SquareTerminal } from 'lucide-react'
import type { Channel, LogEvent } from '../model.ts'
import type { EventPrefixes } from '../ranks.ts'
import { formatEvent, type Template } from '../render.ts'

export const LogView = memo(function LogView({ channel, template, selectedId, scrollKey, select, newChannel, prefixes }: {
  channel: Channel | undefined
  template: Template
  selectedId: string | null
  scrollKey: number
  select: (event: LogEvent) => void
  newChannel: () => void
  prefixes?: ReadonlyMap<string, EventPrefixes>
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const goToBottom = () => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0
  }, [channel?.id])
  useLayoutEffect(() => {
    if (scrollKey) goToBottom()
  }, [scrollKey])

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
      <div className="terminal-scroll" ref={viewport}>
        {channel && channel.events.length ? channel.events.map((event) =>
          <LogRow key={event.id} event={event} channel={channel.name} template={template} select={select}
            selected={selectedId === event.id} actorPrefix={prefixes?.get(event.id)?.actor} targetPrefix={prefixes?.get(event.id)?.target} />,
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

const LogRow = memo(function LogRow({ event, channel, template, selected, select, actorPrefix, targetPrefix }: {
  event: LogEvent; channel: string; template: Template; selected: boolean; select: (event: LogEvent) => void
  actorPrefix?: string; targetPrefix?: string
}) {
  const segments = formatEvent(event, channel, template, true, { actor: actorPrefix, target: targetPrefix })
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
