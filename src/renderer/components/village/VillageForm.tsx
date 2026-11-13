import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  emptyVillageForm,
  isTownHallDecrease,
  isVillageFormDirty,
  readVillageForm,
  villageFormFrom,
  type VillageFormValues,
  type VillageNumberField
} from '@/lib/village/village-form'
import type { VillageDto, VillageSaveInput } from '../../../shared/ipc/contracts'
import { ConfirmDialog, InlineError } from './feedback'

const FIELDS: Array<{ field: VillageNumberField; label: string }> = [
  { field: 'gold', label: 'Gold' },
  { field: 'elixir', label: 'Elixir' },
  { field: 'darkElixir', label: 'Dark Elixir' },
  { field: 'goldCapacity', label: 'Gold capacity' },
  { field: 'elixirCapacity', label: 'Elixir capacity' },
  { field: 'darkElixirCapacity', label: 'Dark Elixir capacity' }
]

export type VillageFormProps = {
  /** null: set up a new village. The parent remounts this form (key) after each save. */
  village: VillageDto | null
  maxTownHall: number | null
  pending: boolean
  /** The service's message for the last failed save. */
  error: string | null
  onSubmit: (input: VillageSaveInput) => void
}

/** Town Hall and resources. Lowering the Town Hall asks for confirmation first. */
export function VillageForm({ village, maxTownHall, pending, error, onSubmit }: VillageFormProps): React.JSX.Element {
  const [values, setValues] = useState<VillageFormValues>(() => (village ? villageFormFrom(village) : emptyVillageForm()))
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<VillageNumberField | 'note', string>>>({})
  const [confirming, setConfirming] = useState<VillageSaveInput | null>(null)

  const checked = readVillageForm(values, village, maxTownHall)
  const warnings = checked.ok ? checked.warnings : []
  const dirty = isVillageFormDirty(values, village)

  const set = (field: keyof VillageFormValues) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [field]: event.target.value }))

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!checked.ok) {
      setFieldErrors(checked.errors)
      return
    }
    setFieldErrors({})
    if (isTownHallDecrease(village, checked.input)) setConfirming(checked.input)
    else onSubmit(checked.input)
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby="village-heading" className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <h2 id="village-heading" className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {village ? 'Town Hall and resources' : 'Set up your village'}
      </h2>
      {!village && (
        <p className="mt-1 text-sm text-muted">Enter your Town Hall level and resources to start tracking your village.</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <NumberField
          id="village-townHallLevel"
          label="Town Hall"
          value={values.townHallLevel}
          onChange={set('townHallLevel')}
          error={fieldErrors.townHallLevel}
          hint={maxTownHall === null ? undefined : `1–${maxTownHall}`}
        />
        {FIELDS.map(({ field, label }) => (
          <NumberField
            key={field}
            id={`village-${field}`}
            label={label}
            value={values[field]}
            onChange={set(field)}
            error={fieldErrors[field]}
          />
        ))}
      </div>

      <label className="mt-3 block text-xs text-muted" htmlFor="village-note">
        Note (optional)
      </label>
      <input
        id="village-note"
        value={values.note}
        onChange={set('note')}
        maxLength={500}
        className="mt-1 h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-sm"
      />
      <InlineError message={fieldErrors.note ?? null} className="mt-1" />

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-warning">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <InlineError message={error} className="mt-3" />

      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? 'Saving…' : village ? 'Save' : 'Create village'}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title="Lower the Town Hall?"
        confirmLabel="Lower Town Hall"
        destructive
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) onSubmit(confirming)
          setConfirming(null)
        }}
      >
        Town Hall {village?.townHallLevel} becomes Town Hall {confirming?.townHallLevel}. This is refused if anything you
        have recorded is above the new Town Hall's limits.
      </ConfirmDialog>
    </form>
  )
}

function NumberField(props: {
  id: string
  label: string
  value: string
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  error?: string
  hint?: string
}): React.JSX.Element {
  const errorId = `${props.id}-error`
  return (
    <div>
      <label htmlFor={props.id} className="block text-xs text-muted">
        {props.label}
        {props.hint && <span className="ml-1 text-muted-foreground">({props.hint})</span>}
      </label>
      <input
        id={props.id}
        inputMode="numeric"
        value={props.value}
        onChange={props.onChange}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        className="mt-1 h-8 w-full rounded-md border border-border bg-surface-0 px-2 font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
      />
      {props.error && (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {props.error}
        </p>
      )}
    </div>
  )
}
