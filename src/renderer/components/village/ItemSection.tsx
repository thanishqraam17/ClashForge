import { useState } from 'react'
import { DEFAULT_ITEM_FILTER, filterItemGroups, presentCategories, type ItemFilter } from '@/lib/village/item-filters'
import type { ItemGroup } from '@/lib/village/village-view-model'
import type { BuilderDto, CatalogueCoverageDto, VillageItemDto } from '../../../shared/ipc/contracts'
import { ItemRow, type ItemRowActions } from './ItemRow'

export type ItemSectionProps = {
  groups: ItemGroup[]
  coverage: CatalogueCoverageDto
  freeBuilders: BuilderDto[]
  /** Set of instance ids currently running an action, so their controls disable. */
  pendingInstanceIds: ReadonlySet<number>
  /** The service's message for the last failed action on each instance, by id. */
  instanceErrors: Readonly<Record<number, string>>
  actions: ItemRowActions
}

/**
 * Search, category filter and the list of Home Village items. While the
 * bundled catalogue cannot support item records, this explains why instead
 * of showing empty or broken controls.
 */
export function ItemSection({
  groups,
  coverage,
  freeBuilders,
  pendingInstanceIds,
  instanceErrors,
  actions
}: ItemSectionProps): React.JSX.Element {
  const [filter, setFilter] = useState<ItemFilter>(DEFAULT_ITEM_FILTER)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  if (!coverage.canRecordItems) {
    return (
      <section aria-labelledby="items-heading" className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <h2 id="items-heading" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Items
        </h2>
        <p className="mt-2 text-sm text-foreground">Item editing needs verified game data.</p>
        <p className="mt-1 text-sm text-muted">
          {coverage.reason ?? 'The bundled game data does not cover this yet.'} This build's data covers{' '}
          {coverage.catalogueItemCount} item{coverage.catalogueItemCount === 1 ? '' : 's'} (dataset{' '}
          {coverage.datasetVersion}).
        </p>
      </section>
    )
  }

  const categories = presentCategories(groups, filter.showUnrecorded)
  const visible = filterItemGroups(groups, filter)

  return (
    <section aria-labelledby="items-heading" className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <h2 id="items-heading" className="text-[11px] font-medium uppercase tracking-wide text-muted">
        Items
      </h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="item-search" className="sr-only">
          Search items
        </label>
        <input
          id="item-search"
          type="search"
          placeholder="Search items…"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          className="h-8 w-48 rounded-md border border-border bg-surface-0 px-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={filter.showUnrecorded}
            onChange={(e) => setFilter((f) => ({ ...f, showUnrecorded: e.target.checked }))}
          />
          Show items not yet recorded
        </label>
      </div>

      {categories.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
          <CategoryChip label="All" active={filter.category === null} onClick={() => setFilter((f) => ({ ...f, category: null }))} />
          {categories.map((category) => (
            <CategoryChip
              key={category}
              label={category}
              active={filter.category === category}
              onClick={() => setFilter((f) => ({ ...f, category }))}
            />
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No items match.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle">
          {visible.map((group) => (
            <ItemRow
              key={group.item.id}
              group={group}
              expanded={expanded.has(group.item.id)}
              onToggle={() =>
                setExpanded((s) => {
                  const next = new Set(s)
                  if (next.has(group.item.id)) next.delete(group.item.id)
                  else next.add(group.item.id)
                  return next
                })
              }
              freeBuilders={freeBuilders}
              isInstancePending={(instance: VillageItemDto) => pendingInstanceIds.has(instance.id)}
              instanceError={(instance: VillageItemDto) => instanceErrors[instance.id] ?? null}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? 'rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground'
          : 'rounded-full border border-border bg-surface-0 px-2.5 py-1 text-xs text-muted hover:text-foreground'
      }
    >
      {label}
    </button>
  )
}
