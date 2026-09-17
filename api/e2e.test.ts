// End to end, with no stubs in the middle.
//
// The tablet's real sync client posts through the real API handler into the real
// store, and the records are read back out through the real GET path. Every
// other test in this repo mocks one side or the other; this one does not, so it
// is what catches the two halves drifting apart.

import { beforeEach, describe, expect, it } from 'vitest'
import boxes from './boxes.ts'
import { makeRequest, makeResponse } from './_lib/testing.ts'
import { resetMemoryStore } from './_lib/store.ts'
import type { BoxRecord } from '../src/domain/types.ts'
import { syncOnce } from '../src/features/sync/sync.ts'
import { loadAcked } from '../src/features/sync/outbox.ts'

/** Routes the sync client's push straight into the API handler. */
const pushThroughApi = async (records: readonly BoxRecord[]) => {
  const { res, captured } = makeResponse()
  await boxes(makeRequest({ method: 'POST', body: { records } }), res)
  const body = captured.body as { accepted?: string[]; rejected?: { id: unknown; why: string }[]; durable?: boolean }
  // Same rule as the real client in src/features/sync/client.ts: 200, 207 and
  // 422 are all the server giving a verdict; anything else is a transport error.
  const answered = captured.status === 200 || captured.status === 207 || captured.status === 422
  if (!answered) throw new Error(`API answered ${captured.status}`)
  return {
    accepted: body.accepted ?? [],
    rejected: body.rejected ?? [],
    durable: body.durable === true,
  }
}

async function readBack(query: Record<string, string> = {}) {
  const { res, captured } = makeResponse()
  await boxes(makeRequest({ method: 'GET', query }), res)
  return captured.body as { records: BoxRecord[]; count: number }
}

function box(id: string, overrides: Partial<BoxRecord> = {}): BoxRecord {
  return {
    id,
    size: 16,
    pieces: [
      { flavorId: 'grey-salt-caramel', count: 8 },
      { flavorId: 'raspberry', count: 5 },
      { flavorId: 'amaretto', count: 3 },
    ],
    startedAt: '2026-09-16T17:00:00.000Z',
    completedAt: '2026-09-16T17:00:42.000Z',
    durationMs: 42_000,
    undoCount: 2,
    method: 'camera-assisted',
    demo: false,
    ...overrides,
  }
}

beforeEach(() => {
  resetMemoryStore()
  localStorage.clear()
})

describe('tablet -> API -> dashboard', () => {
  it('a box saved at the counter arrives intact at the office', async () => {
    const original = box('bx-1', { locationId: 'bradley' })
    const outcome = await syncOnce({ records: [original], push: pushThroughApi })
    expect(outcome).toMatchObject({ sent: 1, remaining: 0, error: null })

    const { records } = await readBack()
    expect(records).toHaveLength(1)
    // receivedAt is stamped by the server; everything else must survive untouched.
    const { receivedAt, ...delivered } = records[0] as BoxRecord & { receivedAt: string }
    expect(delivered).toEqual(original)
    expect(receivedAt).toBeTruthy()
  })

  it('carries locationId end to end, which is what makes the per-shop filter work', async () => {
    await syncOnce({
      records: [box('a', { locationId: 'downtown' }), box('b', { locationId: 'vegas' })],
      push: pushThroughApi,
    })
    expect((await readBack({ location: 'downtown' })).count).toBe(1)
    expect((await readBack({ location: 'vegas' })).count).toBe(1)
    expect((await readBack({ location: 'all' })).count).toBe(2)
  })

  it('a second sync sends nothing, and the server holds one copy, not two', async () => {
    const records = [box('bx-1')]
    await syncOnce({ records, push: pushThroughApi })
    const second = await syncOnce({ records, push: pushThroughApi })
    expect(second.sent).toBe(0)
    expect((await readBack()).count).toBe(1)
  })

  it('re-syncing after the tablet loses its acknowledgements does not duplicate anything', async () => {
    const records = [box('bx-1'), box('bx-2')]
    await syncOnce({ records, push: pushThroughApi })
    // Exactly what clearing site data on the tablet does.
    localStorage.clear()
    expect(loadAcked().size).toBe(0)
    const again = await syncOnce({ records, push: pushThroughApi })
    expect(again.sent).toBe(2)
    expect((await readBack()).count).toBe(2)
  })

  it('an offline stretch drains in order once the wifi returns', async () => {
    const backlog = Array.from({ length: 7 }, (_, i) =>
      box(`bx-${i}`, { completedAt: new Date(Date.UTC(2026, 8, 10 + i, 12)).toISOString() }),
    )
    const outcome = await syncOnce({ records: backlog, push: pushThroughApi })
    expect(outcome.sent).toBe(7)
    const { records } = await readBack()
    // The API returns newest first; the backlog is all there.
    expect(records.map((r) => r.id)).toEqual(['bx-6', 'bx-5', 'bx-4', 'bx-3', 'bx-2', 'bx-1', 'bx-0'])
  })

  it('demo data never reaches the shop API', async () => {
    await syncOnce({ records: [box('demo-1', { demo: true })], push: pushThroughApi })
    expect((await readBack()).count).toBe(0)
  })

  it('a record the server rejects is reported, not retried forever', async () => {
    // A box whose counts do not add up cannot come from the tablet's own save
    // path, but a corrupted localStorage entry could produce one.
    const broken = box('broken', { pieces: [{ flavorId: 'lemon', count: 3 }] })
    const outcome = await syncOnce({ records: [broken], push: pushThroughApi })
    expect(outcome.sent).toBe(0)
    expect(outcome.remaining).toBe(0)
    expect(outcome.rejected[0]).toMatchObject({ id: 'broken' })
    expect(String(outcome.rejected[0].why)).toMatch(/not the box size/)
    expect((await readBack()).count).toBe(0)
  })

  it('date filtering matches what the dashboard asks for', async () => {
    await syncOnce({
      records: [
        box('old', { completedAt: '2026-08-01T12:00:00.000Z' }),
        box('new', { completedAt: '2026-09-16T12:00:00.000Z' }),
      ],
      push: pushThroughApi,
    })
    expect((await readBack({ from: '2026-09-01T00:00:00.000Z' })).count).toBe(1)
  })
})
