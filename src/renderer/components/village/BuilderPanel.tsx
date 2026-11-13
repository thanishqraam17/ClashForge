import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseWholeNumber } from '@/lib/village/village-form'
import {
  assignedInstance,
  availabilityLabel,
  certainlyFreeBuilders,
  unknownBuilderUpgrades
} from '@/lib/village/village-view-model'
import type { BuilderDto, VillageItemDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { InlineError } from './feedback'

/** Mirrors MAX_BUILDERS in the village-state service, which enforces it. */
export const MAX_BUILDERS = 10

export type BuilderPanelProps = {
  state: VillageStateDto
  nameOf: (itemId: string) => string
  /** Which action is running, if any. */
  pending: 'count' | `assign-${number}` | null
  countError: string | null
  assignError: { instanceId: number; message: string } | null
  onSetCount: (count: number) => void
  onAssign: (instance: VillageItemDto, builderId: number) => void
}

const STATUS_TEXT: Record<BuilderDto['status'], string> = {
  busy: 'Busy',
  free: 'Free',
  'possibly-busy': 'Possibly busy'
}

export function BuilderPanel(props: BuilderPanelProps): React.JSX.Element {
  const { state, nameOf, pending } = props
  const [countText, setCountText] = useState(String(state.builders.length))
  const count = parseWholeNumber(countText)
  const countInvalid = count === null || count > MAX_BUILDERS
  const label = availabilityLabel(state.builderAvailability)
  const free = certainlyFreeBuilders(state)
  const unknown = unknownBuilderUpgrades(state)
  const slots = [...state.builders].sort((a, b) => a.slot - b.slot)

  return (
    <section aria-labelledby="builders-heading" className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="builders-heading" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Builders
        </h2>
        <p className={cn('text-sm', label.estimated ? 'text-warning' : 'text-foreground')}>{label.text}</p>
      </div>
      {label.estimated && (
        <p className="mt-1 text-xs text-muted">
          Some upgrades have no known builder, so the number of free builders is estimated.
        </p>
      )}
      {label.inconsistent && (
        <p className="mt-1 text-xs text-warning">
          More upgrades are recorded than builders. Check the builder count and the active upgrades.
        </p>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!countInvalid && count !== state.builders.length) props.onSetCount(count!)
        }}
      >
        <div>
          <label htmlFor="builder-count" className="block text-xs text-muted">
            Number of builders (0–{MAX_BUILDERS})
          </label>
          <div className="mt-1 flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="Fewer builders"
              disabled={count === null || count <= 0}
              onClick={() => setCountText(String(Math.max(0, (count ?? 0) - 1)))}
            >
              −
            </Button>
            <input
              id="builder-count"
              inputMode="numeric"
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              aria-invalid={countInvalid ? true : undefined}
              className="h-8 w-14 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label="More builders"
              disabled={count === null || count >= MAX_BUILDERS}
              onClick={() => setCountText(String(Math.min(MAX_BUILDERS, (count ?? 0) + 1)))}
            >
              +
            </Button>
          </div>
        </div>
        <Button type="submit" size="sm" disabled={pending !== null || countInvalid || count === state.builders.length}>
          {pending === 'count' ? 'Saving…' : 'Save count'}
        </Button>
      </form>
      {countInvalid && <InlineError message={`Enter a whole number from 0 to ${MAX_BUILDERS}`} className="mt-1" />}
      <InlineError message={props.countError} className="mt-1" />

      {slots.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-subtle">
          {slots.map((builder) => {
            const working = assignedInstance(state, builder)
            return (
              <li key={builder.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-foreground">Builder {builder.slot}</span>
                <span className="min-w-0 truncate text-muted">
                  {working ? `${nameOf(working.itemId)} #${working.instanceNumber} → level ${working.targetLevel}` : ''}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    builder.status === 'free' && 'text-success',
                    builder.status === 'busy' && 'text-muted',
                    builder.status === 'possibly-busy' && 'text-warning'
                  )}
                >
                  {STATUS_TEXT[builder.status]}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {unknown.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium text-foreground">Upgrades without a known builder</h3>
          {free.length === 0 && (
            <p className="mt-1 text-xs text-muted">
              No builder is certainly free, so none can be assigned. Add a builder, or finish or cancel another upgrade.
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {unknown.map((instance) => (
              <AssignRow
                key={instance.id}
                instance={instance}
                name={nameOf(instance.itemId)}
                freeBuilders={free}
                pending={pending === `assign-${instance.id}`}
                disabled={pending !== null}
                error={props.assignError?.instanceId === instance.id ? props.assignError.message : null}
                onAssign={(builderId) => props.onAssign(instance, builderId)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function AssignRow(props: {
  instance: VillageItemDto
  name: string
  /** Only builders the backend reports as certainly free. */
  freeBuilders: BuilderDto[]
  pending: boolean
  disabled: boolean
  error: string | null
  onAssign: (builderId: number) => void
}): React.JSX.Element {
  const [builderId, setBuilderId] = useState<number | null>(null)
  const selectId = `assign-${props.instance.id}`
  return (
    <li className="rounded-md border border-border-subtle px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-foreground">
          {props.name} #{props.instance.instanceNumber} → level {props.instance.targetLevel}
        </span>
        {props.freeBuilders.length > 0 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              Builder for {props.name} #{props.instance.instanceNumber}
            </label>
            <select
              id={selectId}
              value={builderId ?? ''}
              onChange={(e) => setBuilderId(e.target.value === '' ? null : Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-surface-0 px-2 text-sm"
            >
              <option value="">Choose a free builder</option>
              {props.freeBuilders.map((b) => (
                <option key={b.id} value={b.id}>
                  Builder {b.slot}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" disabled={props.disabled || builderId === null} onClick={() => builderId !== null && props.onAssign(builderId)}>
              {props.pending ? 'Saving…' : 'Assign builder'}
            </Button>
          </>
        )}
      </div>
      <InlineError message={props.error} className="mt-1" />
    </li>
  )
}
