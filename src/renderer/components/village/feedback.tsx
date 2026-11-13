import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Error text tied to the control or section that caused it. */
export function InlineError({ message, className }: { message: string | null; className?: string }): React.JSX.Element | null {
  if (!message) return null
  return (
    <p role="alert" className={cn('text-xs text-destructive', className)}>
      {message}
    </p>
  )
}

/** Polite announcement of a completed change; the page clears it after a few seconds. */
export function StatusToast({ message }: { message: string | null }): React.JSX.Element {
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-50">
      {message && (
        <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-foreground shadow-lg">
          {message}
        </div>
      )}
    </div>
  )
}

export type ConfirmDialogProps = {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  /** Red confirm button for actions that discard or end something. */
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation built on the native <dialog> element (modal, Escape cancels).
 * Focus starts on Cancel so Enter never confirms by accident.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onCancel()
      }}
      className="m-auto w-full max-w-md rounded-lg border border-border bg-surface-1 p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 id="confirm-dialog-title" className="text-sm font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" autoFocus disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={pending}
            onClick={onConfirm}
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          >
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
