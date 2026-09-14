// Records are stored on the device (localStorage). There is no backend for Phase 1.

import type { BoxRecord } from '../../domain/types.ts'

const STORAGE_KEY = 'ai-chocolation:records'
const DEMO_STASH_KEY = 'ai-chocolation:records-before-demo'

export function listRecords(): BoxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BoxRecord[]) : []
  } catch {
    return []
  }
}

export function replaceRecords(records: BoxRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
}

export function saveRecord(record: BoxRecord): void {
  replaceRecords([record, ...listRecords()])
}

export function clearRecords(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Swaps in sample data for judges, stashing any real saved boxes so they come back
 * untouched when demo mode is turned off. */
export function enterDemoMode(demoRecords: BoxRecord[]): void {
  localStorage.setItem(DEMO_STASH_KEY, JSON.stringify(listRecords().filter((r) => !r.demo)))
  replaceRecords(demoRecords)
}

export function exitDemoMode(): void {
  const raw = localStorage.getItem(DEMO_STASH_KEY)
  replaceRecords(raw ? (JSON.parse(raw) as BoxRecord[]) : [])
  localStorage.removeItem(DEMO_STASH_KEY)
}
