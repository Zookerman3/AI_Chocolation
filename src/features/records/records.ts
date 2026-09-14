// Records are stored on the device (localStorage). There is no backend for Phase 1.
//
// Demo mode (see src/app/demoData.ts) never touches this storage: it's generated fresh
// and passed down as a display-only override in App.tsx, so a real box saved while
// demo mode happens to be on can never be lost or overwritten.

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
