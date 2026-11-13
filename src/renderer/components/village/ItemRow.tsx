import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ItemImage } from '@/components/items/ItemImage'
import { Button } from '@/components/ui/button'
import { parseWholeNumber } from '@/lib/village/village-form'
import type { ItemGroup } from '@/lib/village/village-view-model'
import type { BuilderDto, VillageItemDto } from '../../../shared/ipc/contracts'
import { InstanceRow } from './InstanceRow'

export type ItemRowActions = {
  onSetLevel: (instance: VillageItemDto, level: number) => void
  onAdd: (itemId: string, instanceNumber: number, level: number) => void
  onRemove: (instance: VillageItemDto) => void
  onStartUpgrade: (instance: VillageItemDto, targetLevel: number, builderId: number, upgradeEndsAt: string | null) => void
  onFinishUpgrade: (instance: VillageItemDto) => void
  onCancelUpgrade: (instance: VillageItemDto) => void
  onOpenBulkEdit: (group: ItemGroup) => void
}

export type ItemRowProps = {
  group: ItemGroup
  expanded: boolean
  onToggle: () => void
  freeBuilders: BuilderDto[]
  isInstancePending: (instance: VillageItemDto) => boolean
  instanceError: (instance: VillageItemDto) => string | null
  actions: ItemRowActions
}

/** One catalogue item: image, name, count against the Town Hall limit, and an expandable instance list. */
export function ItemRow({ group, expanded, onToggle, freeBuilders, isInstancePending, instanceError, actions }: ItemRowProps): React.JSX.Element {
  const { item, limit } = group
  const [addLevel, setAddLevel] = useState('1')
  const maxLevel = limit.status === 'available' ? limit.maxLevel : null
  const addLevelValue = parseWholeNumber(addLevel)
  const addLevelInvalid = addLevelValue === null || addLevelValue < 1 || (maxLevel !== null && addLevelValue > maxLevel)

  const countText =
    limit.status === 'available'
      ? `${group.count} / ${limit.maxQuantity}`
      : limit.status === 'locked'
        ? `Unlocks at Town Hall ${limit.unlocksAtTownHall}`
        : `${group.count} recorded`

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {expanded ? <ChevronDown className="size-4 shrink-0 text-muted" /> : <ChevronRight className="size-4 shrink-0 text-muted" />}
          <ItemImage itemId={item.id} name={item.name} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-foreground">{item.name}</span>
            <span className="block text-xs text-muted">
              {countText}
              {limit.status === 'available' && group.instances.length > 0 && ` · levels ${Math.min(...group.instances.map((i) => i.level))}–${Math.max(...group.instances.map((i) => i.level))} of ${limit.maxLevel}`}
            </span>
          </span>
        </button>
        {group.count > 1 && (
          <Button size="sm" variant="secondary" onClick={() => actions.onOpenBulkEdit(group)}>
            Bulk edit
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 pl-7">
          <ul className="space-y-2">
            {group.instances.map((instance) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                itemName={item.name}
                maxLevel={maxLevel}
                freeBuilders={freeBuilders}
                pending={isInstancePending(instance)}
                error={instanceError(instance)}
                onSetLevel={(level) => actions.onSetLevel(instance, level)}
                onRemove={() => actions.onRemove(instance)}
                onStartUpgrade={(targetLevel, builderId, upgradeEndsAt) =>
                  actions.onStartUpgrade(instance, targetLevel, builderId, upgradeEndsAt)
                }
                onFinishUpgrade={() => actions.onFinishUpgrade(instance)}
                onCancelUpgrade={() => actions.onCancelUpgrade(instance)}
              />
            ))}
          </ul>

          {group.canAdd && (
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor={`add-level-${item.id}`} className="text-xs text-muted">
                Add at level
              </label>
              <input
                id={`add-level-${item.id}`}
                inputMode="numeric"
                value={addLevel}
                onChange={(e) => setAddLevel(e.target.value)}
                aria-invalid={addLevelInvalid ? true : undefined}
                className="h-7 w-14 rounded-md border border-border bg-surface-0 px-1.5 text-center font-mono text-xs tabular-nums aria-[invalid=true]:border-destructive"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={addLevelInvalid}
                onClick={() => addLevelValue !== null && actions.onAdd(item.id, group.nextFreeInstanceNumber, addLevelValue)}
              >
                Add instance
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
