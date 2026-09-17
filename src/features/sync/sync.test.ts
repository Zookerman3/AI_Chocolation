import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoxRecord } from '../../domain/types.ts'
import { SyncError } from './client.ts'
import { loadAcked, loadLastSync } from './outbox.ts'
import { syncOnce } from './sync.ts'

function box(id: string, overrides: Partial<BoxRecord> = {}): BoxRecord {
  return {
    id, size: 6, pieces: [{ flavorId: 'lemon', count: 6 }],
    startedAt: '2026-09-16T17:00:00.000Z', completedAt: '2026-09-16T17:00:30.000Z',
    durationMs: 30_000, undoCount: 0, method: 'tap', demo: false, ...overrides,
  }
}

const accepts = (records: readonly BoxRecord[]) =>
  Promise.resolve({ accepted: records.map((r) => r.id), rejected: [], durable: true })

beforeEach(() => localStorage.clear())

describe('syncOnce', () => {
  it('sends everything pending and remembers the acknowledgements', async () => {
    const out = await syncOnce({ records: [box('a'), box('b')], push: accepts })
    expect(out).toMatchObject({ sent: 2, remaining: 0, error: null, durable: true })
    expect(loadAcked().size).toBe(2)
  })

  it('is a no-op second time — nothing is sent twice', async () => {
    const push = vi.fn(accepts)
    const records = [box('a')]
    await syncOnce({ records, push })
    await syncOnce({ records, push })
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('only marks what the server actually acknowledged', async () => {
    const out = await syncOnce({
      records: [box('a'), box('b')],
      push: async () => ({ accepted: ['a'], rejected: [], durable: false }),
    })
    expect(out.sent).toBe(1)
    expect(out.remaining).toBe(1)
    expect([...loadAcked()]).toEqual(['a'])
  })

  it('stops retrying a record the server has judged invalid, and keeps the reason', async () => {
    const out = await syncOnce({
      records: [box('bad')],
      push: async () => ({ accepted: [], rejected: [{ id: 'bad', why: 'unknown box size 7' }], durable: true }),
    })
    expect(out.rejected).toEqual([{ id: 'bad', why: 'unknown box size 7' }])
    expect(out.remaining).toBe(0)
    expect(loadAcked().has('bad')).toBe(true)
  })

  it('keeps the queue and reports the reason when the network is down', async () => {
    const out = await syncOnce({
      records: [box('a'), box('b')],
      push: async () => { throw new SyncError('No answer from the sync endpoint.') },
    })
    expect(out.sent).toBe(0)
    expect(out.remaining).toBe(2)
    expect(out.error).toMatch(/No answer/)
    expect(loadAcked().size).toBe(0)
  })

  it('keeps what succeeded when a later batch fails mid-queue', async () => {
    const records = Array.from({ length: 150 }, (_, i) => box(`bx-${i}`))
    let call = 0
    const out = await syncOnce({
      records,
      push: async (batch) => {
        call += 1
        if (call === 1) return { accepted: batch.map((r) => r.id), rejected: [], durable: true }
        throw new SyncError('Connection lost.')
      },
    })
    expect(out.sent).toBe(100)
    expect(out.remaining).toBe(50)
    expect(out.error).toMatch(/Connection lost/)
  })

  it('batches at 100 so a long offline stretch does not post one giant body', async () => {
    const push = vi.fn(accepts)
    await syncOnce({ records: Array.from({ length: 250 }, (_, i) => box(`bx-${i}`)), push })
    expect(push).toHaveBeenCalledTimes(3)
    expect(push.mock.calls[0][0]).toHaveLength(100)
    expect(push.mock.calls[2][0]).toHaveLength(50)
  })

  it('never sends demo records', async () => {
    const push = vi.fn(accepts)
    const out = await syncOnce({ records: [box('d', { demo: true })], push })
    expect(push).not.toHaveBeenCalled()
    expect(out).toMatchObject({ sent: 0, remaining: 0, error: null })
  })

  it('does nothing, successfully, when there is nothing to send', async () => {
    const push = vi.fn(accepts)
    const out = await syncOnce({ records: [], push })
    expect(push).not.toHaveBeenCalled()
    expect(out.error).toBeNull()
    // Nothing went up, so nothing was synced: the chip must not turn green on this.
    expect(loadLastSync()).toBeNull()
  })

  it('stamps the last sync only when the server acknowledged something', async () => {
    await syncOnce({ records: [box('a')], push: accepts })
    const stamped = loadLastSync()
    expect(stamped).not.toBeNull()
    // A later empty pass leaves the stamp at the time of the real push.
    await syncOnce({ records: [box('a')], push: accepts })
    expect(loadLastSync()?.getTime()).toBe(stamped?.getTime())
  })
})

describe('a batch the server rejects wholesale', () => {
  it('is a verdict, not a transport failure — it must never be retried forever', async () => {
    // Mirrors the API's 422 response: nothing accepted, everything explained.
    const out = await syncOnce({
      records: [box('broken')],
      push: async () => ({ accepted: [], rejected: [{ id: 'broken', why: 'piece counts total 3, which is not the box size 16' }], durable: true }),
    })
    expect(out.error).toBeNull()
    expect(out.remaining).toBe(0)
    expect(loadAcked().has('broken')).toBe(true)
  })
})
