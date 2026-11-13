import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { summariseBulkCount, summariseBulkLevels, type BulkCountSummary, type BulkLevelSummary } from '@/lib/village/bulk-summary'
import { bulkSetCountRequest, bulkSetLevelsRequest } from '@/lib/village/edit-requests'
import { parseWholeNumber } from '@/lib/village/village-form'
import type { ItemGroup } from '@/lib/village/village-view-model'
import type { VillageItemsSetCountInput, VillageItemsSetLevelsInput } from '../../../shared/ipc/contracts'
import { InlineError } from './feedback'

export type BulkEditDialogProps = {
  open: boolean
  group: ItemGroup | null
  pending: boolean
  error: string | null
  onCancel: () => void
  onSubmitLevels: (request: VillageItemsSetLevelsInput) => void
  onSubmitCount: (request: VillageItemsSetCountInput) => void
}

type Tab = 'levels' | 'count'
type Selection = 'all' | number[]

/**
 * Bulk correction for one item: set a level across many instances, or add or
 * remove instances to reach a count. An active upgrade is only ever ended
 * when the player explicitly ticks "End the upgrade"; it is never implied.
 */
export function BulkEditDialog(props: BulkEditDialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<Tab>('levels')
  const [selection, setSelection] = useState<Selection>('all')
  const [levelText, setLevelText] = useState('1')
  const [countText, setCountText] = useState('0')
  const [levelForAdditionsText, setLevelForAdditionsText] = useState('1')
  const [removeIds, setRemoveIds] = useState<number[] | null>(null)
  const [endUpgrades, setEndUpgrades] = useState<ReadonlySet<number>>(new Set())
  const [note, setNote] = useState('')

  const instances = props.group?.instances ?? []

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (props.open && !dialog.open) {
      setTab('levels')
      setSelection('all')
      setLevelText(instances[0] ? String(instances[0].level) : '1')
      setCountText(String(instances.length))
      setLevelForAdditionsText('1')
      setRemoveIds(null)
      setEndUpgrades(new Set())
      setNote('')
      dialog.showModal()
    }
    if (!props.open && dialog.open) dialog.close()
    // Only reset on open, not on every instances change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open])

  const level = parseWholeNumber(levelText)
  const maxLevel = props.group?.limit.status === 'available' ? props.group.limit.maxLevel : null
  const levelInvalid = level === null || level < 1 || (maxLevel !== null && level > maxLevel)
  const levelSummary: BulkLevelSummary | null =
    props.group && !levelInvalid ? summariseBulkLevels(instances, { level: level!, selection, endUpgrades }) : null

  const count = parseWholeNumber(countText)
  const levelForAdditions = parseWholeNumber(levelForAdditionsText)
  const countInvalid = count === null || count < 0
  const countSummary: BulkCountSummary | null =
    props.group && !countInvalid
      ? summariseBulkCount(instances, {
          count: count!,
          ...(count! > instances.length ? { levelForAdditions: levelForAdditions ?? undefined } : {}),
          ...(removeIds !== null ? { removeInstances: removeIds } : {}),
          endUpgrades
        })
      : null

  const toggleUpgrade = (id: number) =>
    setEndUpgrades((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const confirm = () => {
    if (!props.group) return
    if (tab === 'levels' && levelSummary?.canConfirm) {
      props.onSubmitLevels(
        bulkSetLevelsRequest(instances, { itemId: props.group.item.id, level: level!, selection, endUpgrades, note })
      )
    } else if (tab === 'count' && countSummary && 'canConfirm' in countSummary && countSummary.canConfirm) {
      props.onSubmitCount(
        bulkSetCountRequest(instances, {
          itemId: props.group.item.id,
          count: count!,
          ...(count! > instances.length ? { levelForAdditions: levelForAdditions ?? undefined } : {}),
          ...(removeIds !== null ? { removeInstances: removeIds } : {}),
          endUpgrades,
          note
        })
      )
    }
  }

  const canConfirm =
    tab === 'levels' ? (levelSummary?.canConfirm ?? false) : countSummary !== null && 'canConfirm' in countSummary && countSummary.canConfirm

  return (
    <dialog
      ref={ref}
      aria-labelledby="bulk-edit-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!props.pending) props.onCancel()
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-border bg-surface-1 p-0 text-foreground backdrop:bg-black/60"
    >
      {props.group && (
        <div className="p-5">
          <h2 id="bulk-edit-title" className="text-sm font-semibold">
            Bulk edit: {props.group.item.name}
          </h2>

          <div className="mt-3 flex gap-1 border-b border-border-subtle" role="tablist">
            <TabButton active={tab === 'levels'} onClick={() => setTab('levels')}>
              Set level
            </TabButton>
            <TabButton active={tab === 'count'} onClick={() => setTab('count')}>
              Set count
            </TabButton>
          </div>

          {tab === 'levels' && (
            <div className="mt-3 space-y-3">
              <SelectionPicker instances={instances} selection={selection} onChange={setSelection} />
              <div>
                <label htmlFor="bulk-level" className="block text-xs text-muted">
                  New level{maxLevel !== null && ` (up to ${maxLevel})`}
                </label>
                <input
                  id="bulk-level"
                  inputMode="numeric"
                  value={levelText}
                  onChange={(e) => setLevelText(e.target.value)}
                  aria-invalid={levelInvalid ? true : undefined}
                  className="mt-1 h-8 w-20 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
                />
              </div>
              {levelSummary && (
                <LevelSummaryView summary={levelSummary} instances={instances} endUpgrades={endUpgrades} onToggle={toggleUpgrade} />
              )}
            </div>
          )}

          {tab === 'count' && (
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="bulk-count" className="block text-xs text-muted">
                  New count (currently {instances.length})
                </label>
                <input
                  id="bulk-count"
                  inputMode="numeric"
                  value={countText}
                  onChange={(e) => {
                    setCountText(e.target.value)
                    setRemoveIds(null)
                  }}
                  aria-invalid={countInvalid ? true : undefined}
                  className="mt-1 h-8 w-20 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums aria-[invalid=true]:border-destructive"
                />
              </div>
              {count !== null && count > instances.length && (
                <div>
                  <label htmlFor="bulk-level-for-additions" className="block text-xs text-muted">
                    Level for new instances
                  </label>
                  <input
                    id="bulk-level-for-additions"
                    inputMode="numeric"
                    value={levelForAdditionsText}
                    onChange={(e) => setLevelForAdditionsText(e.target.value)}
                    className="mt-1 h-8 w-20 rounded-md border border-border bg-surface-0 px-2 text-center font-mono text-sm tabular-nums"
                  />
                </div>
              )}
              {countSummary && (
                <CountSummaryView
                  summary={countSummary}
                  instances={instances}
                  removeIds={removeIds}
                  endUpgrades={endUpgrades}
                  onChooseRemovals={setRemoveIds}
                  onToggleUpgrade={toggleUpgrade}
                />
              )}
            </div>
          )}

          <label htmlFor="bulk-note" className="mt-3 block text-xs text-muted">
            Note (optional)
          </label>
          <input
            id="bulk-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className="mt-1 h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-sm"
          />

          <InlineError message={props.error} className="mt-3" />

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={props.pending} onClick={props.onCancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={props.pending || !canConfirm} onClick={confirm}>
              {props.pending ? 'Saving…' : 'Confirm'}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? 'border-b-2 border-accent px-2 py-1.5 text-sm text-foreground' : 'px-2 py-1.5 text-sm text-muted'}
    >
      {children}
    </button>
  )
}

function SelectionPicker({
  instances,
  selection,
  onChange
}: {
  instances: ReadonlyArray<{ id: number; instanceNumber: number; level: number; targetLevel: number | null }>
  selection: Selection
  onChange: (s: Selection) => void
}): React.JSX.Element {
  const selected = useMemo(() => (selection === 'all' ? new Set(instances.map((i) => i.id)) : new Set(selection)), [selection, instances])
  return (
    <fieldset>
      <legend className="text-xs text-muted">Instances</legend>
      <label className="mt-1 flex items-center gap-1.5 text-sm">
        <input type="radio" name="bulk-selection" checked={selection === 'all'} onChange={() => onChange('all')} />
        All instances
      </label>
      <label className="mt-1 flex items-center gap-1.5 text-sm">
        <input
          type="radio"
          name="bulk-selection"
          checked={selection !== 'all'}
          onChange={() => onChange(instances.map((i) => i.id))}
        />
        Choose instances
      </label>
      {selection !== 'all' && (
        <ul className="mt-1.5 ml-5 space-y-1">
          {instances.map((i) => (
            <li key={i.id}>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={selected.has(i.id)}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(i.id)
                    else next.delete(i.id)
                    onChange([...next])
                  }}
                />
                #{i.instanceNumber} (level {i.level}{i.targetLevel !== null ? ` → ${i.targetLevel}` : ''})
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function UpgradeCheckbox({
  instanceNumber,
  checked,
  onToggle
}: {
  instanceNumber: number
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-1.5 text-xs text-warning">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      End the upgrade on #{instanceNumber}
    </label>
  )
}

function LevelSummaryView({
  summary,
  instances,
  endUpgrades,
  onToggle
}: {
  summary: BulkLevelSummary
  instances: ReadonlyArray<{ id: number; instanceNumber: number }>
  endUpgrades: ReadonlySet<number>
  onToggle: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-0 p-2.5 text-xs" aria-live="polite">
      {summary.needsUpgradeChoice.length > 0 && (
        <ul className="space-y-1">
          {instances
            .filter((i) => summary.needsUpgradeChoice.includes(i.instanceNumber))
            .map((i) => (
              <li key={i.id}>
                <UpgradeCheckbox instanceNumber={i.instanceNumber} checked={endUpgrades.has(i.id)} onToggle={() => onToggle(i.id)} />
              </li>
            ))}
        </ul>
      )}
      {summary.wouldFinish.length > 0 && (
        <p className="text-destructive">
          A bulk edit never finishes an upgrade (#{summary.wouldFinish.join(', ')} would reach its target level). Pick a
          different level, or finish it individually.
        </p>
      )}
      {summary.changes.length === 0 && summary.needsUpgradeChoice.length === 0 && summary.wouldFinish.length === 0 && (
        <p className="text-muted">Nothing would change.</p>
      )}
      {summary.changes.length > 0 && (
        <ul className="space-y-0.5">
          {summary.changes.map((c) => (
            <li key={c.id}>
              #{c.instanceNumber}: level {c.fromLevel} → {c.toLevel}
              {c.endsUpgradeTo !== null && <span className="text-warning"> (ends the upgrade to {c.endsUpgradeTo})</span>}
            </li>
          ))}
        </ul>
      )}
      {summary.unchanged.length > 0 && <p className="mt-1 text-muted">Unchanged: #{summary.unchanged.join(', #')}</p>}
    </div>
  )
}

function CountSummaryView({
  summary,
  instances,
  removeIds,
  endUpgrades,
  onChooseRemovals,
  onToggleUpgrade
}: {
  summary: BulkCountSummary
  instances: ReadonlyArray<{ id: number; instanceNumber: number; level: number; targetLevel: number | null }>
  removeIds: number[] | null
  endUpgrades: ReadonlySet<number>
  onChooseRemovals: (ids: number[]) => void
  onToggleUpgrade: (id: number) => void
}): React.JSX.Element {
  if (summary.kind === 'none') {
    return <p className="rounded-md border border-border-subtle bg-surface-0 p-2.5 text-xs text-muted">No change.</p>
  }
  if (summary.kind === 'add') {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-0 p-2.5 text-xs" aria-live="polite">
        {summary.problem && <p className="text-destructive">{summary.problem}</p>}
        {summary.additions.length > 0 && (
          <p>
            Adds instance{summary.additions.length === 1 ? '' : 's'} #{summary.additions.join(', #')}
            {summary.level !== null && ` at level ${summary.level}`}.
          </p>
        )}
      </div>
    )
  }
  const chosenIds = removeIds ?? summary.removals.map((r) => r.id)
  return (
    <div className="rounded-md border border-border-subtle bg-surface-0 p-2.5 text-xs" aria-live="polite">
      {summary.problem && <p className="text-destructive">{summary.problem}</p>}
      {summary.removals.length > 0 && (
        <>
          <p>Removes:</p>
          <ul className="mt-1 space-y-1">
            {summary.removals.map((r) => (
              <li key={r.id}>
                #{r.instanceNumber} (level {r.level})
                {r.endsUpgradeTo !== null && <span className="text-warning"> — ends the upgrade to {r.endsUpgradeTo}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.needsUpgradeChoice.length > 0 && (
        <ul className="mt-2 space-y-1">
          {instances
            .filter((i) => summary.needsUpgradeChoice.includes(i.instanceNumber) && chosenIds.includes(i.id))
            .map((i) => (
              <li key={i.id}>
                <UpgradeCheckbox instanceNumber={i.instanceNumber} checked={endUpgrades.has(i.id)} onToggle={() => onToggleUpgrade(i.id)} />
              </li>
            ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-muted underline" onClick={() => onChooseRemovals(chosenIds)}>
        Choose instances to remove
      </button>
    </div>
  )
}
