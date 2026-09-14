import { formatDuration } from '@/lib/utils'
import type { BuilderQueueItem } from '@domain/placeholder-village'

type BuilderQueueListProps = {
  items: BuilderQueueItem[]
}

export function BuilderQueueList({ items }: BuilderQueueListProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-surface-1">
      <div className="border-b border-border-subtle px-4 py-2.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
          Current builder queue
        </h2>
      </div>
      <ul className="divide-y divide-border-subtle">
        {items.map((item) => (
          <li key={item.builderIndex} className="flex gap-4 px-4 py-3">
            <div className="w-20 shrink-0">
              <p className="text-[13px] font-medium text-foreground">
                Builder {item.builderIndex}
              </p>
              <p
                className={
                  item.kind === 'available'
                    ? 'text-[11px] text-success'
                    : 'text-[11px] text-muted'
                }
              >
                {item.kind === 'available' ? 'Available' : 'Upgrading'}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              {item.kind === 'working' ? (
                <>
                  <p className="text-[13px] text-foreground">{item.label}</p>
                  <p className="text-xs text-muted">
                    Level {item.fromLevel} → {item.toLevel}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted">Available</p>
                  <p className="mt-0.5 text-xs text-foreground">
                    Recommended:{' '}
                    <span className="text-foreground/90">
                      {item.recommended.label} {item.recommended.fromLevel} →{' '}
                      {item.recommended.toLevel}
                    </span>
                  </p>
                </>
              )}
            </div>

            <div className="shrink-0 text-right">
              {item.kind === 'working' ? (
                <p className="font-mono text-xs tabular-nums text-foreground">
                  {formatDuration(item.remainingMinutes)} remaining
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
