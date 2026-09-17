import { beforeEach, describe, expect, it } from 'vitest'
import type { BoxRecord } from '../../domain/types.ts'
import { clearOutbox, loadAcked, loadLastSync, markAcked, markSyncedNow, pending } from './outbox.ts'

function box(id: string, overrides: Partial<BoxRecord> = {}): BoxRecord {
  return {
    id, size: 6, pieces: [{ flavorId: 'lemon', count: 6 }],
    startedAt: '2026-09-16T17:00:00.000Z', completedAt: '2026-09-16T17:00:30.000Z',
    durationMs: 30_000, undoCount: 0, method: 'tap', demo: false, ...overrides,
  }
}

beforeEach(() => { localStorage.clear(); clearOutbox() })

describe('pending', () => {
  it('is everything when nothing has been acknowledged', () => {
    expect(pending([box('a'), box('b')], new Set())).toHaveLength(2)
  })

  it('never queues a demo record — sample data must not reach the shop API', () => {
    expect(pending([box('a', { demo: true }), box('b')], new Set()).map((r) => r.id)).toEqual(['b'])
  })

  it('drops what the server already acknowledged', () => {
    expect(pending([box('a'), box('b')], new Set(['a'])).map((r) => r.id)).toEqual(['b'])
  })

  it('sends oldest first, so the shop history arrives in order', () => {
    const out = pending([
      box('new', { completedAt: '2026-09-16T12:00:00.000Z' }),
      box('old', { completedAt: '2026-08-01T12:00:00.000Z' }),
    ], new Set())
    expect(out.map((r) => r.id)).toEqual(['old', 'new'])
  })

  it('does not mutate the array it was given', () => {
    const records = [box('b'), box('a', { completedAt: '2026-01-01T00:00:00.000Z' })]
    pending(records, new Set())
    expect(records.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('acknowledgements', () => {
  it('round-trips through storage', () => {
    markAcked(['a', 'b'])
    expect([...loadAcked()].sort()).toEqual(['a', 'b'])
  })

  it('is additive across passes and de-duplicates', () => {
    markAcked(['a'])
    markAcked(['a', 'b'])
    expect(loadAcked().size).toBe(2)
  })

  it('survives corrupt storage by starting empty instead of throwing', () => {
    localStorage.setItem('ai-chocolation:synced-ids', '{not json')
    expect(loadAcked().size).toBe(0)
  })

  it('ignores an empty list', () => {
    markAcked([])
    expect(loadAcked().size).toBe(0)
  })
})

describe('last sync', () => {
  it('is null before anything has synced, and a date after', () => {
    expect(loadLastSync()).toBeNull()
    markSyncedNow(new Date('2026-09-16T18:00:00.000Z'))
    expect(loadLastSync()?.toISOString()).toBe('2026-09-16T18:00:00.000Z')
  })

  it('treats a corrupt timestamp as never synced', () => {
    localStorage.setItem('ai-chocolation:last-sync', 'whenever')
    expect(loadLastSync()).toBeNull()
  })
})
