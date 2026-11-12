import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { newProject, parseProject, type Project } from './model.ts'
import { safeFilename, type TemplateFile } from './render.ts'

export type Workspace = { project: Project; path: string | null; channelId: string | null; fileDirty: boolean }
const projectFilter = { name: 'IRC Log Studio 项目', extensions: ['irclogproj', 'json'] }

export const freshWorkspace = (): Workspace => ({
  project: newProject('未命名项目'), path: null, channelId: null, fileDirty: false,
})

export function parseWorkspace(text: string): Workspace {
  const stored = JSON.parse(text)
  const project = parseProject(JSON.stringify(stored.project))
  return {
    project,
    path: typeof stored.path === 'string' ? stored.path : null,
    fileDirty: stored.fileDirty === true,
    channelId: project.channels.some(({ id }) => id === stored.channelId)
      ? stored.channelId : project.channels[0]?.id ?? null,
  }
}

export async function recoverWorkspace(read = (backup: boolean) => invoke<string | null>('read_workspace', { backup })) {
  let primaryError = ''
  try {
    const text = await read(false)
    if (text !== null) return { workspace: parseWorkspace(text), warning: '', keepBackup: false }
  } catch (error) {
    primaryError = String(error)
  }
  try {
    const text = await read(true)
    if (text !== null) {
      return { workspace: parseWorkspace(text), warning: '已从上一次自动存档的备份恢复。', keepBackup: true }
    }
  } catch (error) {
    primaryError = [primaryError, String(error)].filter(Boolean).join('\n')
  }
  return {
    workspace: freshWorkspace(),
    warning: primaryError ? `无法恢复自动存档。\n${primaryError}` : '',
    keepBackup: false,
  }
}

export const writeWorkspace = (workspace: Workspace, keepBackup: boolean) =>
  invoke<void>('save_workspace', { text: JSON.stringify(workspace), keepBackup })

export const readTemplates = () => invoke<TemplateFile[]>('list_templates')
export const openTemplateDirectory = () => invoke<void>('open_template_dir')

export async function openProject(): Promise<Workspace | null> {
  const path = await open({ multiple: false, filters: [projectFilter] })
  if (path === null) return null
  const project = parseProject(await invoke<string>('read_document', { path }))
  return { project, path, channelId: project.channels[0]?.id ?? null, fileDirty: false }
}

export async function saveProject(workspace: Workspace, saveAs: boolean): Promise<string | null> {
  const path = (!saveAs && workspace.path) || await save({
    defaultPath: `${safeFilename(workspace.project.name)}.irclogproj`,
    filters: [{ name: 'IRC Log Studio 项目', extensions: ['irclogproj'] }],
  })
  if (path === null) return null
  await writeDocument(path, JSON.stringify(workspace.project, null, 2), true)
  return path
}

export async function exportDocument(name: string, extension: 'txt' | 'json', text: string): Promise<string | null> {
  const path = await save({
    defaultPath: `${safeFilename(name)}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })
  if (path !== null) await writeDocument(path, text, false)
  return path
}

const writeDocument = (path: string, text: string, backup: boolean) =>
  invoke<void>('write_document', { path, text, backup })
