import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { freshWorkspace, recoverWorkspace, writeWorkspace, type Workspace } from './desktop.ts'

export function useWorkspace(reportError: (message: string) => void, pendingAction: () => Promise<void> | null) {
  const [workspace, setWorkspace] = useState<Workspace>(freshWorkspace)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const current = useRef(workspace)
  const revision = useRef(0)
  const written = useRef(0)
  const keepBackup = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const closing = useRef(false)

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current)
    const save = async () => {
      if (revision.current === written.current) return
      const savingRevision = revision.current
      try {
        await writeWorkspace(current.current, keepBackup.current)
        keepBackup.current = false
        written.current = savingRevision
        if (revision.current === savingRevision) setStatus('saved')
      } catch (error) {
        setStatus('error')
        reportError(`自动存档失败。\n${String(error)}`)
        throw error
      }
    }
    const task = queue.current.then(save)
    queue.current = task.catch(() => undefined)
    return task
  }, [reportError])

  const update = useCallback((next: Workspace) => {
    current.current = next
    setWorkspace(next)
    revision.current += 1
    setStatus('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush().catch(() => undefined) }, 650)
  }, [flush])

  useEffect(() => {
    let active = true
    void recoverWorkspace().then((result) => {
      if (!active) return
      keepBackup.current = result.keepBackup
      if (result.needsUpgrade) update(result.workspace)
      else {
        current.current = result.workspace
        setWorkspace(result.workspace)
      }
      if (result.warning) reportError(result.warning)
      setReady(true)
    })

    const listen = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault()
      if (closing.current) return
      closing.current = true
      try {
        await pendingAction()
        try {
          await flush()
        } catch {
          if (!window.confirm('自动存档失败。确定关闭并放弃尚未写入的数据？')) return
        }
        await getCurrentWindow().destroy()
      } catch (error) {
        reportError(`关闭窗口失败。\n${String(error)}`)
      } finally {
        closing.current = false
      }
    }).catch((error: unknown) => {
      reportError(`无法注册关闭时的存档检查。\n${String(error)}`)
      return undefined
    })
    return () => {
      active = false
      clearTimeout(timer.current)
      void listen.then((unlisten) => unlisten?.())
    }
  }, [])

  return { workspace, current, ready, status, update, flush }
}
