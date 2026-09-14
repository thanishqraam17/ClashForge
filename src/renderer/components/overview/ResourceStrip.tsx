import { formatNumber } from '@/lib/utils'
import type { ResourceSnapshot } from '@domain/placeholder-village'

type ResourceStripProps = {
  gold: ResourceSnapshot
  elixir: ResourceSnapshot
  darkElixir: ResourceSnapshot
}

function ResourceCell({
  name,
  snapshot
}: {
  name: string
  snapshot: ResourceSnapshot
}): React.JSX.Element {
  const pct =
    snapshot.capacity > 0
      ? Math.min(100, Math.round((snapshot.current / snapshot.capacity) * 100))
      : 0

  return (
    <div className="min-w-0 flex-1 border-r border-border-subtle px-4 py-3 last:border-r-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {name}
      </p>
      <p className="mt-1 truncate font-mono text-[13px] tabular-nums text-foreground">
        {formatNumber(snapshot.current)}
        <span className="text-muted"> / {formatNumber(snapshot.capacity)}</span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-foreground/25"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted">
          {pct}%
        </span>
      </div>
    </div>
  )
}

export function ResourceStrip({
  gold,
  elixir,
  darkElixir
}: ResourceStripProps): React.JSX.Element {
  return (
    <div className="flex rounded-lg border border-border bg-surface-1">
      <ResourceCell name="Gold" snapshot={gold} />
      <ResourceCell name="Elixir" snapshot={elixir} />
      <ResourceCell name="Dark Elixir" snapshot={darkElixir} />
    </div>
  )
}
