import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return <dialog
    ref={dialog}
    className="dialog"
    aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose() }}
  >
    <div className="dialog-header">
      <h2>{title}</h2>
      <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={18} /></button>
    </div>
    {children}
  </dialog>
}
