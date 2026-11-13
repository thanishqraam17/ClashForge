import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SAMPLE_ITEMS } from '../../../game-data/fixtures/sample-catalogue'
import type {
  BuilderDto,
  CatalogueCoverageDto,
  CatalogueItemDto,
  ItemAtTownHallDto,
  VillageItemDto
} from '../../../shared/ipc/contracts'
import { buildItemGroups, type ItemGroup } from '../../lib/village/village-view-model'
import { BulkEditDialog } from './BulkEditDialog'
import { InstanceRow } from './InstanceRow'
import { ItemRow } from './ItemRow'
import { ItemSection } from './ItemSection'
import { UpgradeDialog } from './UpgradeDialog'

const items = SAMPLE_ITEMS as unknown as CatalogueItemDto[]
const prov = { source: 'manual' as const, confidence: 1, confirmedAt: '2026-11-12T00:00:00.000Z' }

let nextId = 1
function instance(overrides: Partial<VillageItemDto> = {}): VillageItemDto {
  return {
    id: nextId++,
    itemId: 'test-cannon',
    instanceNumber: 1,
    level: 3,
    targetLevel: null,
    upgradeStartedAt: null,
    upgradeEndsAt: null,
    builderId: null,
    builderAssignment: null,
    upgradeObservedTimer: null,
    upgradeObservedAt: null,
    ...prov,
    ...overrides
  }
}

const builder = (id: number, slot: number, status: BuilderDto['status']): BuilderDto => ({
  id,
  slot,
  kind: 'legacy-unclassified',
  status,
  assignedItemInstanceId: null,
  ...prov
})

const noActions = {
  onSetLevel: () => undefined,
  onAdd: () => undefined,
  onRemove: () => undefined,
  onStartUpgrade: () => undefined,
  onFinishUpgrade: () => undefined,
  onCancelUpgrade: () => undefined,
  onOpenBulkEdit: () => undefined
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const coverage = (overrides: Partial<CatalogueCoverageDto> = {}): CatalogueCoverageDto => ({
  datasetVersion: '0.0.1',
  validationStatus: 'verified',
  catalogueItemCount: 10,
  maxTownHall: 8,
  villageTownHall: 6,
  canRecordItems: true,
  reason: null,
  ...overrides
})

describe('item section rendering', () => {
  it('explains the empty-catalogue state and shows no item controls', () => {
    const html = renderToStaticMarkup(
      <ItemSection
        groups={[]}
        coverage={coverage({ canRecordItems: false, reason: 'No catalogue data is bundled yet.', catalogueItemCount: 0 })}
        freeBuilders={[]}
        pendingInstanceIds={new Set()}
        instanceErrors={{}}
        actions={noActions}
      />
    )
    expect(text(html)).toContain('Item editing needs verified game data.')
    expect(text(html)).toContain('No catalogue data is bundled yet.')
    expect(text(html)).toContain('covers 0 items')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('Bulk edit')
  })

  it('shows the Town Hall limit, locked items, and disables Remove on an upgrading instance', () => {
    const limits: Record<string, ItemAtTownHallDto | null | undefined> = {
      'test-cannon': { available: true, itemId: 'test-cannon', townHall: 6, maxLevel: 6, maxQuantity: 3, unlockRequires: [] },
      'test-knight': { available: false, itemId: 'test-knight', townHall: 6, unlocksAtTownHall: 7 }
    }
    const idle = instance({ id: 11, instanceNumber: 1 })
    const upgrading = instance({ id: 12, instanceNumber: 2, targetLevel: 4, builderId: 1, builderAssignment: 'confirmed' })
    const groups = buildItemGroups(
      { items: [idle, upgrading] } as never,
      items,
      limits
    ).map((g) => ({ ...g, instances: g.item.id === 'test-cannon' ? [idle, upgrading] : g.instances, count: g.item.id === 'test-cannon' ? 2 : g.count }))
    const html = renderToStaticMarkup(
      <ItemSection
        groups={groups}
        coverage={coverage()}
        freeBuilders={[]}
        pendingInstanceIds={new Set()}
        instanceErrors={{ 12: 'Cannot remove: active upgrade' }}
        actions={noActions}
      />
    )
    expect(text(html)).toContain('2 / 3')

    const rowProps = {
      itemName: 'Test Cannon',
      maxLevel: 6,
      freeBuilders: [],
      pending: false,
      onSetLevel: () => undefined,
      onRemove: () => undefined,
      onStartUpgrade: () => undefined,
      onFinishUpgrade: () => undefined,
      onCancelUpgrade: () => undefined
    }
    const idleHtml = renderToStaticMarkup(<InstanceRow instance={idle} {...rowProps} />)
    expect(idleHtml).toMatch(/<button[^>]*>Remove<\/button>/)
    const upgradingHtml = renderToStaticMarkup(
      <InstanceRow instance={upgrading} error="Cannot remove: active upgrade" {...rowProps} />
    )
    expect(text(upgradingHtml)).toContain('Cannot remove: active upgrade')
    // The disabled attribute sits on the Remove button for the upgrading instance.
    expect(upgradingHtml).toMatch(/<button[^>]*disabled=""[^>]*>Remove<\/button>/)

    const lockedGroup = groups.find((g) => g.item.id === 'test-knight')!
    const rowHtml = renderToStaticMarkup(
      <ItemRow
        group={lockedGroup}
        expanded={false}
        onToggle={() => undefined}
        freeBuilders={[]}
        isInstancePending={() => false}
        instanceError={() => null}
        actions={noActions}
      />
    )
    expect(text(rowHtml)).toContain('Unlocks at Town Hall 7')
  })
})

describe('upgrade dialog rendering', () => {
  it('explains when no builder is certainly free and disables Start upgrade', () => {
    const html = renderToStaticMarkup(
      <UpgradeDialog open currentLevel={3} maxLevel={6} freeBuilders={[]} pending={false} onCancel={() => undefined} onConfirm={() => undefined} />
    )
    expect(text(html)).toContain('No builder is certainly free, so an upgrade cannot be started.')
    expect(html).not.toContain('<select')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start upgrade<\/button>/)
  })

  it('offers only the given free builders', () => {
    const html = renderToStaticMarkup(
      <UpgradeDialog
        open
        currentLevel={3}
        maxLevel={6}
        freeBuilders={[builder(1, 1, 'free'), builder(2, 2, 'free')]}
        pending={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    )
    const options = [...html.matchAll(/<option value="(\d*)"[^>]*>([^<]*)<\/option>/g)].map((m) => m[2])
    expect(options).toEqual(['Choose a free builder', 'Builder 1', 'Builder 2'])
  })
})

describe('bulk edit dialog rendering', () => {
  const sampleItem = items.find((i) => i.id === 'test-cannon')!
  const group = (instances: VillageItemDto[]): ItemGroup => ({
    item: sampleItem,
    instances,
    count: instances.length,
    limit: { status: 'available', maxLevel: 6, maxQuantity: 5 },
    canAdd: true,
    nextFreeInstanceNumber: instances.length + 1
  })

  it('lists upgrading instances and never marks one ended unless ticked', () => {
    const a = instance({ id: 21, instanceNumber: 1, level: 3 })
    const b = instance({ id: 22, instanceNumber: 2, level: 3, targetLevel: 4, builderId: 1, builderAssignment: 'confirmed' })
    const html = renderToStaticMarkup(
      <BulkEditDialog
        open
        group={group([a, b])}
        pending={false}
        error={null}
        onCancel={() => undefined}
        onSubmitLevels={() => undefined}
        onSubmitCount={() => undefined}
      />
    )
    expect(text(html)).toContain('Bulk edit: Test Cannon')
    expect(text(html)).toContain('End the upgrade on #2')
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*\/>\s*End the upgrade on #2/)
    // Confirm starts disabled because #2's upgrade is not ticked.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm<\/button>/)
  })

  it('shows a destructive message instead of implying a finish', () => {
    const b = instance({ id: 22, instanceNumber: 2, level: 3, targetLevel: 4 })
    const html = renderToStaticMarkup(
      <BulkEditDialog
        open
        group={group([b])}
        pending={false}
        error="Test Cannon #2: a bulk edit never finishes an upgrade; edit it on its own"
        onCancel={() => undefined}
        onSubmitLevels={() => undefined}
        onSubmitCount={() => undefined}
      />
    )
    expect(html).toContain('role="alert"')
    expect(text(html)).toContain('a bulk edit never finishes an upgrade')
  })
})
