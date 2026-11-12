import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssetResolutionDto } from '../../../shared/ipc/contracts'

type ItemImageProps = {
  itemId: string
  /** Item name, used as alt text. */
  name: string
  /** Level to show; omit for the item's canonical image. */
  level?: number | null
  /** Rendered size in pixels (square). */
  size?: number
  className?: string
}

/**
 * Item artwork with honest fallbacks:
 * - exact level art when it exists;
 * - the canonical image, marked "Generic", when the requested level has none;
 * - a neutral placeholder when there is no image or it fails to load.
 */
export function ItemImage({
  itemId,
  name,
  level = null,
  size = 40,
  className
}: ItemImageProps): React.JSX.Element {
  const [resolution, setResolution] = useState<AssetResolutionDto | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResolution(null)
    setFailed(false)
    const api = window.clashForge
    if (!api) {
      setResolution({ kind: 'placeholder', itemId, url: null })
      return
    }
    api.assets
      .resolve({ itemId, level })
      .then((result) => {
        if (cancelled) return
        setResolution(result.ok ? result.data : { kind: 'placeholder', itemId, url: null })
      })
      .catch(() => {
        if (!cancelled) setResolution({ kind: 'placeholder', itemId, url: null })
      })
    return () => {
      cancelled = true
    }
  }, [itemId, level])

  const frame = cn(
    'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2',
    className
  )
  const style = { width: size, height: size }

  if (resolution === null) {
    return <span className={cn(frame, 'animate-pulse')} style={style} aria-hidden />
  }

  if (resolution.kind === 'placeholder' || failed) {
    return (
      <span className={frame} style={style} role="img" aria-label={`${name} (no image available)`} title="No image available">
        <ImageOff className="size-1/2 text-muted opacity-60" strokeWidth={1.5} />
      </span>
    )
  }

  const isGeneric = resolution.kind === 'generic'
  const title = isGeneric
    ? `${name}: generic image (level ${level} artwork not available)`
    : `${name}${resolution.level !== null ? `, level ${resolution.level}` : ''}`

  return (
    <span className={frame} style={style} title={title}>
      <img
        src={resolution.url}
        alt={title}
        width={size}
        height={size}
        className="size-full object-contain"
        draggable={false}
        onError={() => setFailed(true)}
      />
      {isGeneric && (
        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[9px] font-medium uppercase leading-3 tracking-wide text-white/90">
          Generic
        </span>
      )}
    </span>
  )
}
