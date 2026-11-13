import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseWholeNumber } from '@/lib/village/village-form'
import type { BuilderDto, VillageItemDto } from '../../../shared/ipc/contracts'
import { ConfirmDialog, InlineError } from './feedback'
import { UpgradeDialog } from './UpgradeDialog'

const PROVENANCE_LABEL: Record<VillageItemDto['source'], string> = {
  manual: 'Manual',
  'data-export': 'Imported',
  screenshot: 'Scanned',
  'live-capture': 'Scanned',
  'timer-estimate': 'Estimated'
}

export type InstanceRowProps = {
  instance: VillageItemDto
  itemName: string
  maxLevel: number | null
  freeBuilders: BuilderDto[]
  pending: boolean
  error?: string | null
  onSetLevel: (level: number) => void
  onRemove: () => void
  onStartUpgrade: (targetLevel: number, builderId: number, upgradeEndsAt: string | null) => void
  onFinishUpgrade: () => void
  onCancelUpgrade: () => void
}

/** One instance: level editor, provenance, and upgrade controls. */
export function InstanceRow(props: InstanceRowProps): React.JSX.Element {
  const { instance } = props
  const [levelText, setLevelText] = useState(String(instance.level))
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const levelValue = parseWholeNumber(levelText)
  const levelInvalid = levelValue === null || levelValue < 1 || (props.maxLevel !== null && levelValue > props.maxLevel)
  const upgrading = instance.targetLevel !== null
  const provenance = `${PROVENANCE_LABEL[instance.source]}${instance.confirmedAt === null ? ', unconfirmed' : ''}`

  return (
    <li className="rounded-md border border-border-subtle px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-foreground">#{instance.instanceNumber}</span>

        <label htmlFor={`level-${instance.id}`} className="sr-only">
          Level for {props.itemName} #{instance.instanceNumber}
        </label>
        <input
          id={`level-${instance.id}`}
          inputMode="numeric"
          value={levelText}
          onChange={(e) => setLevelText(e.target.value)}
          aria-invalid={levelInvalid ? true : undefined}
          className="h-7 w-14 rounded-md border border-border bg-surface-0 px-1.5 text-center font-mono text-xs tabular-nums aria-[invalid=true]:border-destructive"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={props.pending || levelInvalid || levelValue === instance.level}
          onClick={() => levelValue !== null && props.onSetLevel(levelValue)}
        >
          Save
        </Button>

        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{provenance}</span>

        {upgrading ? (
          <>
            <span className="text-xs text-muted">→ level {instance.targetLevel}</span>
            <Button size="sm" variant="secondary" disabled={props.pending} onClick={() => setConfirmFinish(true)}>
              Finish
            </Button>
            <Button size="sm" variant="ghost" disabled={props.pending} onClick={() => setConfirmCancel(true)}>
              Cancel upgrade
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" disabled={props.pending} onClick={() => setUpgradeOpen(true)}>
            Start upgrade
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          disabled={props.pending || upgrading}
          title={upgrading ? 'Finish or cancel the upgrade first' : undefined}
          onClick={() => setConfirmRemove(true)}
        >
          Remove
        </Button>
      </div>
      <InlineError message={props.error ?? null} className="mt-1" />

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this instance?"
        confirmLabel="Remove"
        destructive
        pending={props.pending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false)
          props.onRemove()
        }}
      >
        {props.itemName} #{instance.instanceNumber}, level {instance.level}, will be removed.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmFinish}
        title="Finish this upgrade?"
        confirmLabel="Finish"
        pending={props.pending}
        onCancel={() => setConfirmFinish(false)}
        onConfirm={() => {
          setConfirmFinish(false)
          props.onFinishUpgrade()
        }}
      >
        #{instance.instanceNumber} becomes level {instance.targetLevel}; the upgrade and its builder are released.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this upgrade?"
        confirmLabel="Cancel upgrade"
        destructive
        pending={props.pending}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false)
          props.onCancelUpgrade()
        }}
      >
        #{instance.instanceNumber} stays level {instance.level}; the upgrade and its builder are released.
      </ConfirmDialog>

      <UpgradeDialog
        open={upgradeOpen}
        currentLevel={instance.level}
        maxLevel={props.maxLevel}
        freeBuilders={props.freeBuilders}
        pending={props.pending}
        onCancel={() => setUpgradeOpen(false)}
        onConfirm={(targetLevel, builderId, upgradeEndsAt) => {
          setUpgradeOpen(false)
          props.onStartUpgrade(targetLevel, builderId, upgradeEndsAt)
        }}
      />
    </li>
  )
}
