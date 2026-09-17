// Which saved boxes the server has acknowledged, and which are still waiting.
//
// The rule this file exists to enforce: **localStorage stays the source of truth
// on the tablet.** A box is saved locally first and is never held back, delayed,
// or lost because the network is down. Sync is something that happens to a box
// afterwards, never something a box waits for.
//
// We track acknowledged ids rather than a queue of pending records, so the
// outbox can never disagree with the records themselves — it is derived.

import type { BoxRecord } from '../../domain/types.ts'

const ACKED_KEY = 'ai-chocolation:synced-ids'
const LAST_SYNC_KEY = 'ai-chocolation:last-sync'
/** Bound the set so a year of trading cannot fill the quota. */
const MAX_ACKED = 5000

export function loadAcked(): Set<string> {
  try {
    const raw = localStorage.getItem(ACKED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function markAcked(ids: readonly string[]): void {
  if (ids.length === 0) return
  try {
    const acked = loadAcked()
    for (const id of ids) acked.add(id)
    const list = [...acked]
    localStorage.setItem(ACKED_KEY, JSON.stringify(list.slice(-MAX_ACKED)))
  } catch {
    // A tablet with no storage quota left still syncs; it just re-sends, and the
    // server is idempotent on record id, so re-sending is harmless.
  }
}

/** Real boxes the server has not acknowledged yet, oldest first so the shop's
 * history arrives in the order it happened. */
export function pending(records: readonly BoxRecord[], acked: ReadonlySet<string>): BoxRecord[] {
  return records
    .filter((r) => !r.demo && !acked.has(r.id))
    .slice()
    .sort((a, b) => (a.completedAt < b.completedAt ? -1 : 1))
}

export function loadLastSync(): Date | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    if (!raw) return null
    const date = new Date(raw)
    return Number.isFinite(date.getTime()) ? date : null
  } catch {
    return null
  }
}

export function markSyncedNow(when: Date = new Date()): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, when.toISOString())
  } catch {
    // Not worth failing a sync over.
  }
}

export function clearOutbox(): void {
  try {
    localStorage.removeItem(ACKED_KEY)
    localStorage.removeItem(LAST_SYNC_KEY)
  } catch {
    // Nothing to do.
  }
}
