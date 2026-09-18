// Records are stored on the device (localStorage); that copy is the source of truth.
// src/features/sync/ posts each saved box to the API (api/boxes.ts) and never
// writes back here.
//
// Sample data (src/app/demoData.ts) is display-only and is never written here; the
// Records and Stats screens accept it as an optional override, but the app no longer
// offers a switch for it.

import type { BoxRecord } from '../../domain/types.ts'

const STORAGE_KEY = 'ai-chocolation:records'

export function listRecords(): BoxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BoxRecord[]) : []
  } catch {
    return []
  }
}

/** Returns false when the device refused the write (a full quota, storage
 * disabled) instead of throwing. A throw here reaches the counter as the
 * render-crash card mid-rush, which is the one thing this screen must not do —
 * every other write in the app is guarded the same way. */
export function saveRecord(record: BoxRecord): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...listRecords()]))
    return true
  } catch {
    return false
  }
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
