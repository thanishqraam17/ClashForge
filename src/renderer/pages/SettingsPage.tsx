import { useEffect, useState } from 'react'
import { FanContentNotice } from '@/components/legal/FanContentNotice'
import type { AttributionDto, DatasetInfoDto } from '../../shared/ipc/contracts'

type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

const STATUS_LABELS: Record<DatasetInfoDto['validationStatus'], string> = {
  unverified: 'Unverified',
  partial: 'Partially verified',
  verified: 'Verified'
}

function useAboutData(): LoadState<{ dataset: DatasetInfoDto; attributions: AttributionDto[] }> {
  const [state, setState] = useState<
    LoadState<{ dataset: DatasetInfoDto; attributions: AttributionDto[] }>
  >({ status: 'loading' })

  useEffect(() => {
    const api = window.clashForge
    if (!api) {
      setState({ status: 'error', message: 'The desktop bridge is not available.' })
      return
    }
    let cancelled = false
    Promise.all([api.catalogue.getDatasetInfo(), api.assets.getAttributions()])
      .then(([dataset, attributions]) => {
        if (cancelled) return
        if (!dataset.ok) return setState({ status: 'error', message: dataset.error.message })
        if (!attributions.ok) return setState({ status: 'error', message: attributions.error.message })
        setState({ status: 'ready', data: { dataset: dataset.data, attributions: attributions.data } })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Could not load data information.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-4 py-1.5 text-sm">
      <dt className="w-36 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  )
}

export function SettingsPage(): React.JSX.Element {
  const about = useAboutData()

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Profiles, backups and preferences will be added in a later phase.
      </p>

      <section className="mt-8" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-[11px] font-medium uppercase tracking-wide text-muted">
          About &amp; data sources
        </h2>

        {about.status === 'loading' && <p className="mt-3 text-sm text-muted">Loading…</p>}
        {about.status === 'error' && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {about.message}
          </p>
        )}

        {about.status === 'ready' && (
          <>
            <dl className="mt-3 rounded-md border border-border-subtle bg-surface-1 px-4 py-2">
              <Row label="Game data version">{about.data.dataset.datasetVersion}</Row>
              <Row label="Released">{about.data.dataset.releasedAt}</Row>
              <Row label="Game version">{about.data.dataset.gameVersion ?? 'Not specified'}</Row>
              <Row label="Status">
                <span
                  className={
                    about.data.dataset.validationStatus === 'verified' ? 'text-success' : 'text-warning'
                  }
                >
                  {STATUS_LABELS[about.data.dataset.validationStatus]}
                </span>
                {about.data.dataset.isStale && (
                  <span className="ml-2 text-warning">
                    · {about.data.dataset.ageInDays} days old; values may be out of date
                  </span>
                )}
              </Row>
              <Row label="Catalogue items">{about.data.dataset.itemCount}</Row>
            </dl>

            {about.data.dataset.knownOmissions.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-foreground">Not yet covered</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">
                  {about.data.dataset.knownOmissions.map((omission) => (
                    <li key={omission}>{omission}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6">
              <h3 className="text-sm font-medium text-foreground">Artwork sources</h3>
              {about.data.attributions.length === 0 ? (
                <p className="mt-1.5 text-sm text-muted">
                  No game artwork is bundled yet. Items are shown with a neutral placeholder.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-2 text-sm">
                  {about.data.attributions.map((entry) => (
                    <li key={`${entry.sourceName}-${entry.attribution}`}>
                      <span className="text-foreground">{entry.sourceName}</span>
                      {entry.sourceUrl && <span className="ml-2 text-muted">{entry.sourceUrl}</span>}
                      <p className="text-muted">{entry.attribution}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <FanContentNotice className="mt-6 border-t border-border-subtle pt-4 text-xs leading-relaxed text-muted" />
      </section>
    </div>
  )
}
