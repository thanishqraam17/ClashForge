import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BuilderDto, VillageStateDto } from '../../../shared/ipc/contracts'
import { BuilderPanel, type BuilderPanelProps } from './BuilderPanel'

const prov = { source: 'manual' as const, confidence: 1, confirmedAt: '2026-11-12T00:00:00.000Z' }

function builder(id: number, slot: number, kind: BuilderDto['kind']): BuilderDto {
  return { id, slot, kind, status: 'free', assignedItemInstanceId: null, ...prov }
}

function stateWith(builders: BuilderDto[]): VillageStateDto {
  return {
    village: {
      id: 1, townHallLevel: 6, gold: 0, elixir: 0, darkElixir: 0, goldCapacity: 0, elixirCapacity: 0,
      darkElixirCapacity: 0, lastScannedAt: null, ...prov, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z'
    },
    coverage: { datasetVersion: '0.0.1', validationStatus: 'verified', catalogueItemCount: 10, maxTownHall: 8, villageTownHall: 6, canRecordItems: true, reason: null },
    builders,
    builderAvailability: { total: builders.length, busyAssigned: 0, busyUnassigned: 0, freeMin: builders.length, freeMax: builders.length, isConfirmed: true, inconsistent: false },
    items: [],
    research: [],
    activeResearchItemId: null,
    latestSnapshot: null,
    legacyRecords: { pending: 0, converted: 0, dismissed: 0 }
  }
}

const noop = () => undefined
const defaults: Omit<BuilderPanelProps, 'state'> = {
  nameOf: (id) => id,
  pending: null,
  ordinaryError: null,
  bobError: null,
  reclassifyError: null,
  removeError: null,
  assignError: null,
  onSetOrdinaryCount: noop,
  onSetBob: noop,
  onReclassify: noop,
  onRemoveUnclassified: noop,
  onAssign: noop
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('BuilderPanel ownership controls', () => {
  it('shows no legacy reclassification section when there is nothing unclassified', () => {
    const html = renderToStaticMarkup(
      <BuilderPanel {...defaults} state={stateWith([builder(1, 1, 'ordinary'), builder(2, 2, 'bob')])} />
    )
    expect(html).not.toContain('carried over')
    expect(html).not.toContain('reclassify-ordinary')
  })

  it('shows the legacy section with a pre-filled target and per-row removal', () => {
    const html = renderToStaticMarkup(
      <BuilderPanel
        {...defaults}
        state={stateWith([builder(1, 1, 'ordinary'), builder(2, 2, 'legacy-unclassified'), builder(3, 3, 'legacy-unclassified')])}
      />
    )
    expect(text(html)).toContain('2 builders carried over from before this update')
    // Pre-filled to confirmed (1) + legacy (2) = 3.
    expect(html).toMatch(/id="reclassify-ordinary"[^>]*value="3"/)
    expect(text(html)).toContain('Unclassified builder 2')
    expect(text(html)).toContain('Unclassified builder 3')
    expect([...html.matchAll(/>Remove<\/button>/g)]).toHaveLength(2)
  })

  it('disables the B.O.B. select in the legacy form once B.O.B. is already confirmed', () => {
    const html = renderToStaticMarkup(
      <BuilderPanel {...defaults} state={stateWith([builder(1, 1, 'bob'), builder(2, 2, 'legacy-unclassified')])} />
    )
    expect(html).toMatch(/id="reclassify-bob"[^>]*disabled=""/)
  })

  it('shows the ordinary-hut and B.O.B. errors independently, next to their own controls', () => {
    const html = renderToStaticMarkup(
      <BuilderPanel
        {...defaults}
        state={stateWith([builder(1, 1, 'ordinary')])}
        ordinaryError="Ordinary Builder Hut 1 is busy; finish or reassign its upgrade first"
        bobError="B.O.B. is busy; finish or reassign its upgrade first"
      />
    )
    const t = text(html)
    expect(t).toContain('Ordinary Builder Hut 1 is busy')
    expect(t).toContain('B.O.B. is busy')
  })

  it('shows a removal error only against the builder it belongs to', () => {
    const html = text(
      renderToStaticMarkup(
        <BuilderPanel
          {...defaults}
          state={stateWith([builder(10, 1, 'legacy-unclassified'), builder(11, 2, 'legacy-unclassified')])}
          removeError={{ id: 11, message: 'Builder 2 is busy; finish or reassign its upgrade first' }}
        />
      )
    )
    expect(html).toContain('Builder 2 is busy')
  })

  it('disables every control while any ownership action is pending', () => {
    const html = renderToStaticMarkup(
      <BuilderPanel {...defaults} state={stateWith([builder(1, 1, 'legacy-unclassified')])} pending="reclassify" />
    )
    expect(html).toMatch(/type="checkbox"[^>]*disabled=""/)
    expect(html).toMatch(/>Removing…<\/button>|disabled=""[^>]*>Remove<\/button>/)
  })
})
