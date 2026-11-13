import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppShell, SampleDataBanner } from '@/components/layout/AppShell'
import { MyVillageError, MyVillageLoading } from '@/pages/MyVillagePage'
import type { BuilderDto, VillageDto, VillageItemDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { BuilderPanel, type BuilderPanelProps } from './BuilderPanel'
import { ConfirmDialog } from './feedback'
import { VillageForm } from './VillageForm'

const prov = { source: 'manual' as const, confidence: 1, confirmedAt: '2026-11-12T00:00:00.000Z' }

const village: VillageDto = {
  id: 1, townHallLevel: 6, gold: 100, elixir: 200, darkElixir: 0, goldCapacity: 1000, elixirCapacity: 1000,
  darkElixirCapacity: 0, lastScannedAt: null, ...prov, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z'
}

const builder = (id: number, slot: number, status: BuilderDto['status'], assigned: number | null = null): BuilderDto => ({
  id, slot, status, assignedItemInstanceId: assigned, ...prov
})

const upgrade = (overrides: Partial<VillageItemDto>): VillageItemDto => ({
  id: 1, itemId: 'test-cannon', instanceNumber: 1, level: 3, targetLevel: 4, upgradeStartedAt: null, upgradeEndsAt: null,
  builderId: null, builderAssignment: null, upgradeObservedTimer: null, upgradeObservedAt: null, ...prov, ...overrides
})

function stateWith(builders: BuilderDto[], items: VillageItemDto[], availability: Partial<VillageStateDto['builderAvailability']>): VillageStateDto {
  return {
    village,
    coverage: { datasetVersion: '0.0.1', validationStatus: 'verified', catalogueItemCount: 10, maxTownHall: 8, villageTownHall: 6, canRecordItems: true, reason: null },
    builders,
    builderAvailability: { total: builders.length, busyAssigned: 0, busyUnassigned: 0, freeMin: 0, freeMax: 0, isConfirmed: true, inconsistent: false, ...availability },
    items,
    research: [],
    activeResearchItemId: null,
    latestSnapshot: null,
    legacyRecords: { pending: 0, converted: 0, dismissed: 0 }
  }
}

const panel = (state: VillageStateDto, extra: Partial<BuilderPanelProps> = {}) =>
  renderToStaticMarkup(
    <BuilderPanel
      state={state}
      nameOf={(id) => (id === 'test-cannon' ? 'Test Cannon' : id)}
      pending={null}
      countError={null}
      assignError={null}
      onSetCount={() => undefined}
      onAssign={() => undefined}
      {...extra}
    />
  )

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('My Village static rendering', () => {
  const globals = globalThis as { window?: unknown }
  afterEach(() => {
    delete globals.window
  })

  it('shows the TEST DATA banner and the My Village link only as intended', () => {
    expect(text(renderToStaticMarkup(<SampleDataBanner />))).toContain('TEST DATA: sample village, not your data')
    const shell = (sampleData: boolean | undefined) => {
      globals.window = sampleData === undefined ? {} : { clashForge: { sampleData } }
      return renderToStaticMarkup(
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      )
    }
    expect(shell(true)).toContain('TEST DATA')
    expect(shell(false)).not.toContain('TEST DATA')
    const normal = shell(undefined)
    expect(normal).not.toContain('TEST DATA')
    expect(normal).toMatch(/href="\/village"[^>]*>.*My Village/)
  })

  it('renders loading and error states', () => {
    expect(renderToStaticMarkup(<MyVillageLoading />)).toContain('aria-busy="true"')
    const error = renderToStaticMarkup(<MyVillageError message="An unexpected error occurred." onRetry={() => undefined} />)
    expect(error).toContain('role="alert"')
    expect(text(error)).toContain('An unexpected error occurred. Retry')
  })

  it('renders the setup form for a new village and the edit form for an existing one', () => {
    const props = { maxTownHall: 8, pending: false, error: null, onSubmit: () => undefined }
    const setup = text(renderToStaticMarkup(<VillageForm village={null} {...props} />))
    expect(setup).toContain('Set up your village')
    expect(setup).toContain('Create village')
    const edit = renderToStaticMarkup(<VillageForm village={village} {...props} maxTownHall={null} error="Town Hall 2 would leave the village above its limits" />)
    expect(text(edit)).toContain('Town Hall and resources')
    expect(edit).toContain('value="6"')
    expect(edit).not.toContain('(1–')
    expect(edit).toContain('role="alert"')
    // Unchanged form: Save is disabled.
    expect(edit).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/)
  })

  it('labels estimated availability and never offers a possibly busy builder', () => {
    const unknown = upgrade({ id: 30, instanceNumber: 3, builderAssignment: 'unknown' })
    const busy = upgrade({ id: 31, instanceNumber: 2, builderId: 1, builderAssignment: 'confirmed' })
    const html = panel(
      stateWith([builder(1, 1, 'busy', 31), builder(2, 2, 'possibly-busy')], [busy, unknown], { freeMin: 0, freeMax: 1, isConfirmed: false })
    )
    const t = text(html)
    expect(t).toContain('Estimated 0–1 of 2 free')
    expect(t).toContain('Builder 1 Test Cannon #2 → level 4 Busy')
    expect(t).toContain('Builder 2 Possibly busy')
    expect(t).toContain('Test Cannon #3 → level 4')
    expect(t).toContain('No builder is certainly free')
    expect(html).not.toContain('<select')
  })

  it('offers only certainly free builders for an unknown-builder upgrade', () => {
    const unknown = upgrade({ id: 30, instanceNumber: 3, builderAssignment: 'unknown' })
    const html = panel(
      stateWith([builder(1, 1, 'free'), builder(2, 2, 'possibly-busy'), builder(3, 3, 'free')], [unknown], { freeMin: 1, freeMax: 2, isConfirmed: false })
    )
    const options = [...html.matchAll(/<option value="(\d*)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]])
    expect(options).toEqual([
      ['', 'Choose a free builder'],
      ['1', 'Builder 1'],
      ['3', 'Builder 3']
    ])
    expect(panel(stateWith([builder(1, 1, 'free')], [], { freeMin: 1, freeMax: 1 }), { assignError: null })).not.toContain('without a known builder')
  })

  it('shows builder count errors from the service', () => {
    const html = panel(stateWith([builder(1, 1, 'free')], [], {}), { countError: 'Cannot drop below 1 builder while 1 upgrade is in progress' })
    expect(html).toContain('Cannot drop below 1 builder')
    expect(html).toContain('(0–10)')
  })

  it('renders confirmation text with Cancel first and a destructive confirm', () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog open title="Lower the Town Hall?" confirmLabel="Lower Town Hall" destructive onConfirm={() => undefined} onCancel={() => undefined}>
        Town Hall 6 becomes Town Hall 5.
      </ConfirmDialog>
    )
    expect(html.startsWith('<dialog')).toBe(true)
    expect(text(html)).toContain('Lower the Town Hall? Town Hall 6 becomes Town Hall 5. Cancel Lower Town Hall')
    expect(html).toContain('bg-destructive')
  })
})
