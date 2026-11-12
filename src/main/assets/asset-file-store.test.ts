import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetEntry } from '../../domain/assets'
import { createAssetService } from '../../services/asset-service'
import { createAssetFileStore } from './asset-file-store'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function entry(assetPath: string, checksum: string): AssetEntry {
  return {
    itemId: assetPath.split('/')[1]!.replace(/\.\w+$/, ''),
    level: null,
    assetPath,
    sourceName: 'Test',
    sourceUrl: null,
    attribution: 'Test',
    checksum,
    lastVerifiedAt: '2026-11-12'
  }
}

describe('createAssetFileStore', () => {
  let dir: string
  const logger = { warn: vi.fn() }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clashforge-assets-'))
    mkdirSync(join(dir, 'defense'))
    writeFileSync(join(dir, 'defense', 'good.png'), PNG_BYTES)
    writeFileSync(join(dir, 'defense', 'tampered.png'), Buffer.from('not the original'))
    writeFileSync(join(dir, 'defense', 'unlisted.png'), PNG_BYTES)
    logger.warn.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function store(maxCachedFiles?: number) {
    const assets = createAssetService({
      assets: [
        entry('defense/good.png', sha256(PNG_BYTES)),
        entry('defense/tampered.png', sha256(PNG_BYTES)),
        entry('defense/missing.png', sha256(PNG_BYTES)),
        entry('other/second.webp', sha256(PNG_BYTES))
      ]
    })
    return createAssetFileStore({ directory: dir, assets, maxCachedFiles, logger })
  }

  it('serves verified manifest files with the right content type and caches them', async () => {
    const files = store()
    const result = await files.read('defense/good.png')
    expect(result).toEqual({ ok: true, bytes: PNG_BYTES, contentType: 'image/png' })
    expect(files.cachedCount).toBe(1)

    rmSync(join(dir, 'defense', 'good.png'))
    expect((await files.read('defense/good.png')).ok).toBe(true)
  })

  it('refuses files that are not in the manifest', async () => {
    expect(await store().read('defense/unlisted.png')).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses malformed or traversal paths before touching the disk', async () => {
    for (const path of ['../secret.png', 'defense/../../x.png', '/etc/passwd', 'defense\\good.png']) {
      expect(await store().read(path), path).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('reports missing files and checksum mismatches without serving them', async () => {
    const files = store()
    expect(await files.read('defense/missing.png')).toMatchObject({ ok: false, status: 404 })
    expect(await files.read('defense/tampered.png')).toMatchObject({ ok: false, status: 500 })
    expect(files.cachedCount).toBe(0)
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used file beyond the cache limit', async () => {
    mkdirSync(join(dir, 'other'))
    writeFileSync(join(dir, 'other', 'second.webp'), PNG_BYTES)
    const files = store(1)
    await files.read('defense/good.png')
    const second = await files.read('other/second.webp')
    expect(second).toMatchObject({ ok: true, contentType: 'image/webp' })
    expect(files.cachedCount).toBe(1)
  })
})
