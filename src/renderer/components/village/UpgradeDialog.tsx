import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseWholeNumber } from '@/lib/village/village-form'
import { EMPTY_DURATION, readDuration, upgradeEndsAt, type DurationText } from '@/lib/village/upgrade-duration'
import type { BuilderDto } from '../../../shared/ipc/contracts'
import { InlineError } from './feedback'

export type UpgradeDialogProps = {
  open: boolean
  currentLevel: number
  maxLevel: number | null
  /** Only builders the backend reports as certainly free. */
  freeBuilders: BuilderDto[]
  pending: boolean
  onCancel: () => void
  onConfirm: (targetLevel: number, builderId: number, upgradeEndsAt: string | null) => void
}

/** Starts an upgrade: target level, a free builder, and an optional time remaining. */
export function UpgradeDialog(props: UpgradeDialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [targetText, setTargetText] = useState(String(props.currentLevel + 1))
  const [builderId, setBuilderId] = useState<number | null>(null)
  const [duration, setDuration] = useState<DurationText>(EMPTY_DURATION)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (props.open && !dialog.open) {
      setTargetText(String(props.currentLevel + 1))
      setBuilderId(null)
      setDuration(EMPTY_DURATION)
      dialog.showModal()
    }
    if (!props.open && dialog.open) dialog.close()
    // currentLevel intentionally excluded: only reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  const target = parseWholeNumber(targetText)
  const targetInvalid = target === null || target <= props.currentLevel || (props.maxLevel !== null && target > props.maxLevel)
  const durationResult = readDuration(duration)

  const confirm = () => {
    if (targetInvalid || builderId === null || !durationResult.ok) return
    props.onConfirm(target!, builderId, upgradeEndsAt(new Date(), durationResult.ms))
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="upgrade-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!props.pending) props.onCancel()
      }}
      className="m-auto w-full max-w-md rounded-lg border border-border bg-surface-1 p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 id="upgrade-dialog-title" className="text-sm font-semibold">
          Start upgrade
        </h2>

        <label htmlFor="upgrade-target" className="mt-3 block text-xs text-muted">
          Target level{props.maxLevel !== null && ` (up to ${props.maxLevel})`}
        </label>
        <input
          id="upgrade-target"
          inputMode="numeric"
          value={targetText}
          onChange={(e) => setTargetText(e.target.value)}
          aria-invalid={targetInvalid ? true : undefined}
          className="mt-1 h-8 w-20 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
        />

        <label htmlFor="upgrade-builder" className="mt-3 block text-xs text-muted">
          Builder
        </label>
        {props.freeBuilders.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No builder is certainly free, so an upgrade cannot be started.</p>
        ) : (
          <select
            id="upgrade-builder"
            value={builderId ?? ''}
            onChange={(e) => setBuilderId(e.target.value === '' ? null : Number(e.target.value))}
            className="mt-1 h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-sm"
          >
            <option value="">Choose a free builder</option>
            {props.freeBuilders.map((b) => (
              <option key={b.id} value={b.id}>
                Builder {b.slot}
              </option>
            ))}
          </select>
        )}

        <p className="mt-3 text-xs text-muted">Time remaining (optional; leave empty if unknown)</p>
        <div className="mt-1 flex gap-2">
          <DurationField label="Days" value={duration.days} onChange={(v) => setDuration((d) => ({ ...d, days: v }))} />
          <DurationField label="Hours" value={duration.hours} onChange={(v) => setDuration((d) => ({ ...d, hours: v }))} />
          <DurationField label="Minutes" value={duration.minutes} onChange={(v) => setDuration((d) => ({ ...d, minutes: v }))} />
        </div>
        {!durationResult.ok && <InlineError message={durationResult.error} className="mt-1" />}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" autoFocus disabled={props.pending} onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={props.pending || targetInvalid || builderId === null || !durationResult.ok || props.freeBuilders.length === 0}
            onClick={confirm}
          >
            {props.pending ? 'Starting…' : 'Start upgrade'}
          </Button>
        </div>
      </div>
    </dialog>
  )
}

function DurationField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }): React.JSX.Element {
  const id = `upgrade-duration-${label.toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] text-muted">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 h-7 w-16 rounded-md border border-border bg-surface-0 px-1.5 text-center font-mono text-xs tabular-nums"
      />
    </div>
  )
}
