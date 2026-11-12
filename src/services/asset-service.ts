import type { AssetEntry, AssetManifest } from '../domain/assets'
import type { ItemId } from '../domain/catalogue'

/**
 * How an item image was resolved:
 * - `exact-level`: artwork for the requested level.
 * - `canonical`: the item's standard image, and no specific level was requested.
 * - `generic`: a level was requested but only the canonical image exists; the UI
 *   must label it as a generic image.
 * - `placeholder`: no usable image; the UI shows a neutral placeholder.
 *
 * Artwork from a different level is never used, because showing it as the
 * requested level would be misleading.
 */
export type AssetResolution =
  | { kind: 'exact-level' | 'canonical' | 'generic'; itemId: ItemId; entry: AssetEntry }
  | { kind: 'placeholder'; itemId: ItemId }

export type AttributionEntry = {
  sourceName: string
  sourceUrl: string | null
  attribution: string
}

export type AssetService = {
  resolve: (itemId: ItemId, level?: number | null) => AssetResolution
  /** Entry for a bundled asset path, or null if the path is not in the manifest. */
  getByPath: (assetPath: string) => AssetEntry | null
  /** Distinct attributions for every bundled asset, for an attribution screen. */
  getAttributions: () => AttributionEntry[]
}

function key(itemId: ItemId, level: number | null): string {
  return `${itemId}@${level ?? 'canonical'}`
}

export function createAssetService(manifest: AssetManifest): AssetService {
  const byKey = new Map(manifest.assets.map((entry) => [key(entry.itemId, entry.level), entry]))
  const byPath = new Map(manifest.assets.map((entry) => [entry.assetPath, entry]))

  return {
    resolve(itemId, level = null) {
      if (level !== null) {
        const exact = byKey.get(key(itemId, level))
        if (exact) return { kind: 'exact-level', itemId, entry: exact }
      }
      const canonical = byKey.get(key(itemId, null))
      if (canonical) {
        return { kind: level === null ? 'canonical' : 'generic', itemId, entry: canonical }
      }
      return { kind: 'placeholder', itemId }
    },

    getByPath(assetPath) {
      return byPath.get(assetPath) ?? null
    },

    getAttributions() {
      const seen = new Map<string, AttributionEntry>()
      for (const { sourceName, sourceUrl, attribution } of manifest.assets) {
        const id = `${sourceName}\u0000${sourceUrl ?? ''}\u0000${attribution}`
        if (!seen.has(id)) seen.set(id, { sourceName, sourceUrl, attribution })
      }
      return [...seen.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName))
    }
  }
}
