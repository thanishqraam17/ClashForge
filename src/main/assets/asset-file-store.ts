import { createHash } from 'crypto'
import { readFile } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { ASSET_PATH_PATTERN } from '../../domain/assets'
import type { AssetService } from '../../services/asset-service'

export type AssetFileResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; status: 400 | 404 | 500; reason: string }

export type AssetFileStore = {
  read: (assetPath: string) => Promise<AssetFileResult>
  /** Number of verified files held in memory. */
  readonly cachedCount: number
}

export type AssetFileStoreOptions = {
  /** Directory holding bundled assets; manifest paths are relative to it. */
  directory: string
  assets: AssetService
  /** Maximum verified files kept in memory (least recently used evicted first). */
  maxCachedFiles?: number
  logger?: { warn: (message: string) => void }
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp'
}

/**
 * Reads bundled asset files safely:
 * - only paths listed in the asset manifest are served;
 * - the resolved file must stay inside the assets directory;
 * - file contents must match the manifest's SHA-256 checksum.
 * Verified files are cached in memory so each one is hashed only once.
 */
export function createAssetFileStore(options: AssetFileStoreOptions): AssetFileStore {
  const directory = resolve(options.directory)
  const maxCached = options.maxCachedFiles ?? 200
  const logger = options.logger ?? console
  const cache = new Map<string, { bytes: Buffer; contentType: string }>()

  return {
    get cachedCount() {
      return cache.size
    },

    async read(assetPath) {
      if (!ASSET_PATH_PATTERN.test(assetPath)) {
        return { ok: false, status: 400, reason: 'invalid asset path' }
      }
      const cached = cache.get(assetPath)
      if (cached) {
        cache.delete(assetPath)
        cache.set(assetPath, cached)
        return { ok: true, ...cached }
      }

      const entry = options.assets.getByPath(assetPath)
      if (!entry) {
        return { ok: false, status: 404, reason: 'asset not in manifest' }
      }

      const filePath = resolve(directory, assetPath)
      const fromRoot = relative(directory, filePath)
      if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
        return { ok: false, status: 400, reason: 'asset path escapes assets directory' }
      }

      let bytes: Buffer
      try {
        bytes = await readFile(filePath)
      } catch {
        logger.warn(`[ClashForge] Asset file missing: ${assetPath}`)
        return { ok: false, status: 404, reason: 'asset file missing' }
      }

      const checksum = createHash('sha256').update(bytes).digest('hex')
      if (checksum !== entry.checksum) {
        logger.warn(`[ClashForge] Asset checksum mismatch: ${assetPath}`)
        return { ok: false, status: 500, reason: 'asset checksum mismatch' }
      }

      const extension = assetPath.slice(assetPath.lastIndexOf('.') + 1)
      const value = { bytes, contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' }
      cache.set(assetPath, value)
      if (cache.size > maxCached) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return { ok: true, ...value }
    }
  }
}
