import { describe, expect, it, vi } from 'vitest'
import type { AssetFileStore } from './asset-file-store'
import { createAssetRequestHandler, parseAssetUrl, toAssetUrl } from './asset-protocol'

describe('asset URLs', () => {
  it('round-trips bundled asset paths', () => {
    const url = toAssetUrl('defense/cannon-3.png')
    expect(url).toBe('clashforge-asset://bundled/defense/cannon-3.png')
    expect(parseAssetUrl(url)).toBe('defense/cannon-3.png')
  })

  it('rejects other schemes, hosts, queries and empty paths', () => {
    expect(parseAssetUrl('https://bundled/defense/cannon.png')).toBeNull()
    expect(parseAssetUrl('clashforge-asset://other/defense/cannon.png')).toBeNull()
    expect(parseAssetUrl('clashforge-asset://bundled/defense/cannon.png?x=1')).toBeNull()
    expect(parseAssetUrl('clashforge-asset://bundled/')).toBeNull()
    expect(parseAssetUrl('not a url')).toBeNull()
  })
})

describe('createAssetRequestHandler', () => {
  const store: AssetFileStore = {
    cachedCount: 0,
    read: vi.fn(async (path: string) =>
      path === 'defense/cannon.png'
        ? { ok: true as const, bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' }
        : { ok: false as const, status: 404 as const, reason: 'missing' }
    )
  }
  const handler = createAssetRequestHandler(store)

  it('serves verified files with safe headers', async () => {
    const response = await handler(new Request(toAssetUrl('defense/cannon.png')))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('passes through store failures and rejects bad requests', async () => {
    expect((await handler(new Request(toAssetUrl('defense/nope.png')))).status).toBe(404)
    expect(
      (await handler(new Request('clashforge-asset://other/defense/cannon.png'))).status
    ).toBe(400)
    expect(
      (await handler(new Request(toAssetUrl('defense/cannon.png'), { method: 'POST' }))).status
    ).toBe(405)
  })
})
