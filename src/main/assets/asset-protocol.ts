import type { Protocol } from 'electron'
import type { AssetFileStore } from './asset-file-store'

export const ASSET_SCHEME = 'clashforge-asset'
const ASSET_HOST = 'bundled'

/** URL the renderer uses for a bundled asset path. */
export function toAssetUrl(assetPath: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${assetPath}`
}

/** Inverse of toAssetUrl; null for anything that is not a bundled asset URL. */
export function parseAssetUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.host !== ASSET_HOST) return null
  if (parsed.search || parsed.hash) return null
  const path = parsed.pathname.replace(/^\//, '')
  return path || null
}

/** Must run before the app is ready. */
export function registerAssetSchemePrivileges(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true } }
  ])
}

/** Builds the request handler; kept separate from Electron for testing. */
export function createAssetRequestHandler(store: AssetFileStore) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') {
      return new Response(null, { status: 405 })
    }
    const assetPath = parseAssetUrl(request.url)
    if (assetPath === null) {
      return new Response(null, { status: 400 })
    }
    const result = await store.read(assetPath)
    if (!result.ok) {
      return new Response(null, { status: result.status })
    }
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  }
}

export function handleAssetProtocol(
  protocol: Pick<Protocol, 'handle'>,
  store: AssetFileStore
): void {
  protocol.handle(ASSET_SCHEME, createAssetRequestHandler(store))
}
