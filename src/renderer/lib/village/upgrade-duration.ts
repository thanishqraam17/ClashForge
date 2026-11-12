/**
 * Time remaining on an upgrade, as typed by the player. The clock is never
 * read here: callers pass `now` (the page uses `new Date()` at the moment the
 * player confirms), so results are deterministic and testable.
 *
 * All three fields empty means "unknown": no end time is recorded.
 * A total of zero is rejected, because an upgrade with no time left is
 * finished and should be recorded with Finish instead.
 */

export type DurationText = { days: string; hours: string; minutes: string }

export const EMPTY_DURATION: DurationText = { days: '', hours: '', minutes: '' }

const LIMITS = { days: 365, hours: 23, minutes: 59 } as const
const MS = { days: 86_400_000, hours: 3_600_000, minutes: 60_000 } as const

export type DurationResult = { ok: true; ms: number | null } | { ok: false; error: string }

export function readDuration(text: DurationText): DurationResult {
  const fields = ['days', 'hours', 'minutes'] as const
  if (fields.every((f) => text[f].trim() === '')) return { ok: true, ms: null }
  let ms = 0
  for (const field of fields) {
    const raw = text[field].trim()
    if (raw === '') continue
    if (!/^\d+$/.test(raw)) return { ok: false, error: `${capital(field)} must be a whole number of 0 or more` }
    const value = Number(raw)
    if (value > LIMITS[field]) return { ok: false, error: `${capital(field)} must be at most ${LIMITS[field]}` }
    ms += value * MS[field]
  }
  if (ms === 0) {
    return { ok: false, error: 'Time remaining must be more than zero. Leave it empty if unknown, or use Finish if it is done.' }
  }
  return { ok: true, ms }
}

/** ISO end time, or null when the remaining time is unknown. */
export function upgradeEndsAt(now: Date, ms: number | null): string | null {
  if (ms === null) return null
  if (!Number.isFinite(now.getTime())) throw new Error('now must be a valid date')
  return new Date(now.getTime() + ms).toISOString()
}

function capital(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1)
}
