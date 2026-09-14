import { Link } from 'react-router-dom'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BuilderQueueList } from '@/components/overview/BuilderQueueList'
import { ResourceStrip } from '@/components/overview/ResourceStrip'
import { formatRelativeTime } from '@/lib/utils'
import { PLACEHOLDER_VILLAGE } from '@domain/placeholder-village'

export function OverviewPage(): React.JSX.Element {
  const village = PLACEHOLDER_VILLAGE

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Village overview
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              TH {village.townHallLevel}
            </h1>
            <p className="text-sm text-muted">
              {village.buildersAvailable} / {village.buildersTotal} builders available
            </p>
          </div>
          <p className="mt-1 text-xs text-muted">
            Last scanned: {formatRelativeTime(village.lastScannedAt)}
          </p>
        </div>

        <Button asChild size="lg" className="shrink-0">
          <Link to="/scan">
            <ScanLine />
            Scan Village
          </Link>
        </Button>
      </header>

      <section className="mt-6" aria-label="Resources">
        <ResourceStrip
          gold={village.gold}
          elixir={village.elixir}
          darkElixir={village.darkElixir}
        />
      </section>

      <section className="mt-6" aria-label="Builder queue">
        <BuilderQueueList items={village.builderQueue} />
      </section>
    </div>
  )
}
