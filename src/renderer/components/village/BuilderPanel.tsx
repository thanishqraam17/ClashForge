import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { parseWholeNumber } from '@/lib/village/village-form'
import {
  assignedInstance,
  availabilityLabel,
  certainlyFreeBuilders,
  HOME_VILLAGE_BUILDER_MAX,
  legacyUnclassifiedBuilders,
  ORDINARY_BUILDER_HUT_MAX,
  summariseHomeVillageBuilderOwnership,
  unknownBuilderUpgrades
} from '@/lib/village/village-view-model'
import type { BuilderDto, VillageItemDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { InlineError } from './feedback'

/**
 * Which action is currently running, if any. Builder removal is namespaced
 * (builder-remove-, not remove-) so its key can never collide with an item
 * instance's own remove-<id> key, which uses the same pending field.
 */
export type BuilderPanelPending =
  | 'ordinary'
  | 'bob'
  | 'reclassify'
  | `builder-remove-${number}`
  | `assign-${number}`
  | null

export type BuilderPanelProps = {
  state: VillageStateDto
  nameOf: (itemId: string) => string
  pending: BuilderPanelPending
  ordinaryError: string | null
  bobError: string | null
  reclassifyError: string | null
  removeError: { id: number; message: string } | null
  assignError: { instanceId: number; message: string } | null
  onSetOrdinaryCount: (count: number) => void
  onSetBob: (unlocked: boolean) => void
  onReclassify: (input: { ordinaryCount: number; bob: boolean | 'unsure' }) => void
  onRemoveUnclassified: (id: number) => void
  onAssign: (instance: VillageItemDto, builderId: number) => void
}

const STATUS_TEXT: Record<BuilderDto['status'], string> = {
  busy: 'Busy',
  free: 'Free',
  'possibly-busy': 'Possibly busy'
}

/** How one builder row is labelled, by what it actually is. */
function builderLabel(builder: BuilderDto): string {
  if (builder.kind === 'bob') return 'B.O.B.'
  if (builder.kind === 'ordinary') return `Builder Hut ${builder.slot}`
  return `Unclassified builder ${builder.slot}`
}

export function BuilderPanel(props: BuilderPanelProps): React.JSX.Element {
  const { state, nameOf, pending } = props
  const ownership = summariseHomeVillageBuilderOwnership(state.builders)
  const legacy = legacyUnclassifiedBuilders(state.builders)
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
          More upgrades are recorded than builders. Check builder ownership and the active upgrades.
        </p>
      )}

      {/* Confirmed ownership, legacy count and the total operational slots are shown separately. */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="Builder ownership">
        <OwnershipStat label="Ordinary huts" value={`${ownership.ordinaryConfirmed} / ${ORDINARY_BUILDER_HUT_MAX}`} />
        <OwnershipStat label="B.O.B." value={ownership.bobConfirmed ? 'Unlocked' : 'Not unlocked'} />
        <OwnershipStat label="Unclassified" value={String(ownership.legacyUnclassified)} />
        <OwnershipStat label="Total operational" value={String(ownership.totalSlots)} />
      </dl>
      {ownership.exceedsLimit && (
        <p role="alert" className="mt-2 text-xs text-warning">
          This village has {ownership.totalSlots} Home Village builders recorded, more than the {HOME_VILLAGE_BUILDER_MAX}{' '}
          that are ever possible (5 ordinary huts + B.O.B.). Reclassify or remove the unclassified ones below.
        </p>
      )}

      <OwnershipControls
        ordinaryConfirmed={ownership.ordinaryConfirmed}
        bobConfirmed={ownership.bobConfirmed}
        pending={pending}
        ordinaryError={props.ordinaryError}
        bobError={props.bobError}
        onSetOrdinaryCount={props.onSetOrdinaryCount}
        onSetBob={props.onSetBob}
      />

      {legacy.length > 0 && (
        <LegacyReclassification
          legacy={legacy}
          ordinaryConfirmed={ownership.ordinaryConfirmed}
          bobConfirmed={ownership.bobConfirmed}
          pending={pending}
          reclassifyError={props.reclassifyError}
          removeError={props.removeError}
          onReclassify={props.onReclassify}
          onRemoveUnclassified={props.onRemoveUnclassified}
        />
      )}

      {slots.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle rounded-md border border-border-subtle">
          {slots.map((builder) => {
            const working = assignedInstance(state, builder)
            return (
              <li key={builder.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-foreground">{builderLabel(builder)}</span>
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

function OwnershipStat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-mono text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

/** Ordinary-hut stepper (0-5) and the B.O.B. toggle. Each is its own confirmed pool. */
function OwnershipControls(props: {
  ordinaryConfirmed: number
  bobConfirmed: boolean
  pending: BuilderPanelPending
  ordinaryError: string | null
  bobError: string | null
  onSetOrdinaryCount: (count: number) => void
  onSetBob: (unlocked: boolean) => void
}): React.JSX.Element {
  const [ordinaryText, setOrdinaryText] = useState(String(props.ordinaryConfirmed))
  const ordinary = parseWholeNumber(ordinaryText)
  const ordinaryInvalid = ordinary === null || ordinary > ORDINARY_BUILDER_HUT_MAX

  return (
    <div className="mt-3 flex flex-wrap items-end gap-4">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!ordinaryInvalid && ordinary !== props.ordinaryConfirmed) props.onSetOrdinaryCount(ordinary!)
        }}
      >
        <div>
          <label htmlFor="ordinary-huts" className="block text-xs text-muted">
            Ordinary Builder Huts (0–{ORDINARY_BUILDER_HUT_MAX})
          </label>
          <input
            id="ordinary-huts"
            inputMode="numeric"
            value={ordinaryText}
            onChange={(e) => setOrdinaryText(e.target.value)}
            aria-invalid={ordinaryInvalid ? true : undefined}
            className="mt-1 h-8 w-14 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
          />
        </div>
        <Button type="submit" size="sm" disabled={props.pending !== null || ordinaryInvalid || ordinary === props.ordinaryConfirmed}>
          {props.pending === 'ordinary' ? 'Saving…' : 'Save'}
        </Button>
      </form>

      <label className="flex items-center gap-1.5 text-sm text-foreground">
        <input
          type="checkbox"
          checked={props.bobConfirmed}
          disabled={props.pending !== null}
          onChange={(e) => props.onSetBob(e.target.checked)}
        />
        B.O.B. unlocked
        {props.pending === 'bob' && <span className="text-xs text-muted">Saving…</span>}
      </label>

      <div className="basis-full">
        <InlineError message={props.ordinaryError} />
        <InlineError message={props.bobError} />
      </div>
    </div>
  )
}

/** One-time (repeatable) confirmation of what inherited, unclassified builders actually are. */
function LegacyReclassification(props: {
  legacy: BuilderDto[]
  ordinaryConfirmed: number
  bobConfirmed: boolean
  pending: BuilderPanelPending
  reclassifyError: string | null
  removeError: { id: number; message: string } | null
  onReclassify: (input: { ordinaryCount: number; bob: boolean | 'unsure' }) => void
  onRemoveUnclassified: (id: number) => void
}): React.JSX.Element {
  const [ordinaryText, setOrdinaryText] = useState(String(Math.min(5, props.ordinaryConfirmed + props.legacy.length)))
  const [bob, setBob] = useState<'yes' | 'no' | 'unsure'>(props.bobConfirmed ? 'yes' : 'unsure')
  const target = parseWholeNumber(ordinaryText)
  const targetInvalid = target === null || target < props.ordinaryConfirmed || target > 5

  return (
    <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3">
      <h3 className="text-sm font-medium text-foreground">
        {props.legacy.length} builder{props.legacy.length === 1 ? '' : 's'} carried over from before this update
      </h3>
      <p className="mt-1 text-xs text-muted">
        Confirm what these are. Anything left unconfirmed stays listed below and still works normally.
      </p>

      <form
        className="mt-2 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!targetInvalid) props.onReclassify({ ordinaryCount: target!, bob: bob === 'unsure' ? 'unsure' : bob === 'yes' })
        }}
      >
        <div>
          <label htmlFor="reclassify-ordinary" className="block text-xs text-muted">
            Total ordinary Builder Huts (0–5)
          </label>
          <input
            id="reclassify-ordinary"
            inputMode="numeric"
            value={ordinaryText}
            onChange={(e) => setOrdinaryText(e.target.value)}
            aria-invalid={targetInvalid ? true : undefined}
            className="mt-1 h-8 w-14 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
          />
        </div>
        <div>
          <label htmlFor="reclassify-bob" className="block text-xs text-muted">
            B.O.B.
          </label>
          <select
            id="reclassify-bob"
            value={bob}
            disabled={props.bobConfirmed}
            onChange={(e) => setBob(e.target.value as typeof bob)}
            className="mt-1 h-8 rounded-md border border-border bg-surface-0 px-2 text-sm"
          >
            <option value="unsure">Not sure</option>
            <option value="yes">Unlocked</option>
            <option value="no">Not unlocked</option>
          </select>
        </div>
        <Button type="submit" size="sm" disabled={props.pending !== null || targetInvalid}>
          {props.pending === 'reclassify' ? 'Saving…' : 'Confirm'}
        </Button>
      </form>
      <InlineError message={props.reclassifyError} className="mt-1" />

      <ul className="mt-3 space-y-1">
        {props.legacy.map((builder) => (
          <li key={builder.id} className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>Unclassified builder {builder.slot}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={props.pending !== null}
              onClick={() => props.onRemoveUnclassified(builder.id)}
            >
              {props.pending === `builder-remove-${builder.id}` ? 'Removing…' : 'Remove'}
            </Button>
            {props.removeError?.id === builder.id && <InlineError message={props.removeError.message} />}
          </li>
        ))}
      </ul>
    </div>
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
                  {b.kind === 'bob' ? 'B.O.B.' : `Builder ${b.slot}`}
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
