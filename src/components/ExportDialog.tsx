import { useState } from 'react'
import { Download } from 'lucide-react'
import { exportDocument } from '../desktop.ts'
import type { Project } from '../model.ts'
import { exportText, type Template } from '../render.ts'
import { Dialog } from './Dialog.tsx'

export function ExportDialog({ project, channelId, activeTemplate, templates, onClose, onExported }: {
  project: Project
  channelId: string | null
  activeTemplate: string
  templates: Map<string, Template>
  onClose: () => void
  onExported: (path: string) => void
}) {
  const [format, setFormat] = useState<'txt' | 'json'>('txt')
  const [scope, setScope] = useState(channelId ? 'current' : 'all')
  const [templateId, setTemplateId] = useState(activeTemplate)
  const [showTime, setShowTime] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setError('')
    setBusy(true)
    try {
      const channel = scope === 'current' ? project.channels.find(({ id }) => id === channelId) : undefined
      const template = templates.get(templateId)
      if (!template) throw new Error('请选择可用的模板。')
      const text = format === 'txt' ? exportText(project, channel?.id ?? null, template, showTime)
        : JSON.stringify(channel ? { ...project, channels: [channel] } : project, null, 2)
      const path = await exportDocument(channel?.name ?? project.name, format, text)
      if (path) onExported(path)
    } catch (cause) {
      setError(`导出失败。\n${String(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return <Dialog title="导出日志" onClose={() => { if (!busy) onClose() }}>
    <form className="dialog-body form-stack" onSubmit={(event) => { event.preventDefault(); void run() }}>
      <fieldset disabled={busy} className="form-stack">
        <label>文件格式
          <select value={format} onChange={(event) => setFormat(event.target.value as 'txt' | 'json')}>
            <option value="txt">TXT · UTF-8 文本</option><option value="json">JSON · 结构化项目</option>
          </select>
        </label>
        <label>导出范围
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="current" disabled={!channelId}>当前频道</option>
            <option value="all">所有频道</option>
          </select>
        </label>
        {format === 'txt' && <>
          <label>导出模板
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
              {Array.from(templates, ([id, template]) => <option key={id} value={id}>{template.name} · {id}</option>)}
            </select>
          </label>
          <label className="checkbox"><input type="checkbox" checked={showTime} onChange={(event) => setShowTime(event.target.checked)} />包含时间戳</label>
        </>}
      </fieldset>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy}><Download size={17} />{busy ? '正在导出…' : '选择路径并导出'}</button>
      </div>
    </form>
  </Dialog>
}
