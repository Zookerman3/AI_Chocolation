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

export function saveRecord(record: BoxRecord): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...listRecords()]))
}

export function clearRecords(): void {
  localStorage.removeItem(STORAGE_KEY)
}
