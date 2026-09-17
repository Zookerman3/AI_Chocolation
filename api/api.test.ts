import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import boxes from './boxes.ts'
import health from './health.ts'
import { makeRequest, makeResponse } from './_lib/testing.ts'
import { resetMemoryStore } from './_lib/store.ts'
import { validateRecord } from './_lib/record.ts'

function box(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bx-1',
    size: 6,
    pieces: [{ flavorId: 'amaretto', count: 4 }, { flavorId: 'lemon', count: 2 }],
    startedAt: '2026-09-16T17:00:00.000Z',
    completedAt: '2026-09-16T17:00:30.000Z',
    durationMs: 30_000,
    undoCount: 1,
    method: 'tap',
    demo: false,
    ...overrides,
  }
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { res, captured } = makeResponse()
  await boxes(makeRequest({ method: 'POST', body, headers }), res)
  return captured
}

async function get(query: Record<string, string> = {}) {
  const { res, captured } = makeResponse()
  await boxes(makeRequest({ method: 'GET', query }), res)
  return captured
}

beforeEach(() => resetMemoryStore())
afterEach(() => { delete process.env.SYNC_TOKEN })

describe('POST /api/boxes', () => {
  it('accepts a single record and echoes the id back as the acknowledgement', async () => {
    const out = await post(box())
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ accepted: ['bx-1'], acceptedCount: 1, rejected: [] })
  })

  it('accepts a bare array and a { records } wrapper', async () => {
    expect((await post([box({ id: 'a' })])).status).toBe(200)
    expect((await post({ records: [box({ id: 'b' })] })).status).toBe(200)
    expect((await get()).body).toMatchObject({ count: 2 })
  })

  it('is idempotent: re-posting the same box overwrites rather than duplicating', async () => {
    await post(box())
    await post(box({ undoCount: 9 }))
    const listed = (await get()).body as { records: { undoCount: number }[]; count: number }
    expect(listed.count).toBe(1)
    expect(listed.records[0].undoCount).toBe(9)
  })

  it('stamps receivedAt on the server, ignoring whatever the client claimed', async () => {
    await post(box({ receivedAt: '1999-01-01T00:00:00.000Z' }))
    const listed = (await get()).body as { records: { receivedAt: string }[] }
    expect(new Date(listed.records[0].receivedAt).getFullYear()).toBe(new Date().getFullYear())
  })

  it('rejects a box whose piece counts do not add up to its size', async () => {
    const out = await post(box({ pieces: [{ flavorId: 'lemon', count: 3 }] }))
    expect(out.status).toBe(422)
    expect(JSON.stringify(out.body)).toMatch(/not the box size/)
  })

  it('accepts the good records in a mixed batch and reports the bad ones (207)', async () => {
    const out = await post([box({ id: 'good' }), box({ id: 'bad', size: 7 })])
    expect(out.status).toBe(207)
    expect(out.body).toMatchObject({ accepted: ['good'], acceptedCount: 1 })
    expect((out.body as { rejected: unknown[] }).rejected).toHaveLength(1)
  })

  it('refuses an oversized batch instead of trying to swallow it', async () => {
    const out = await post(Array.from({ length: 501 }, (_, i) => box({ id: `bx-${i}` })))
    expect(out.status).toBe(413)
  })

  it('refuses a body that is not JSON', async () => {
    const out = await post('{not json')
    expect(out.status).toBe(400)
  })

  it('parses a JSON string body, which is how some clients send it', async () => {
    const out = await post(JSON.stringify(box()))
    expect(out.status).toBe(200)
  })
})

describe('write protection', () => {
  it('is open while SYNC_TOKEN is unset', async () => {
    expect((await post(box())).status).toBe(200)
  })

  it('requires a matching token once SYNC_TOKEN is set', async () => {
    process.env.SYNC_TOKEN = 'secret'
    expect((await post(box())).status).toBe(401)
    expect((await post(box(), { 'x-sync-token': 'wrong' })).status).toBe(401)
    expect((await post(box(), { 'x-sync-token': 'secret' })).status).toBe(200)
  })

  it('never gates reads — the dashboard link must open with no login', async () => {
    process.env.SYNC_TOKEN = 'secret'
    expect((await get()).status).toBe(200)
  })
})

describe('GET /api/boxes', () => {
  beforeEach(async () => {
    await post([
      box({ id: 'old', completedAt: '2026-08-01T12:00:00.000Z', locationId: 'downtown' }),
      box({ id: 'mid', completedAt: '2026-09-01T12:00:00.000Z', locationId: 'bradley' }),
      box({ id: 'new', completedAt: '2026-09-16T12:00:00.000Z', locationId: 'downtown' }),
    ])
  })

  it('returns newest first', async () => {
    const body = (await get()).body as { records: { id: string }[] }
    expect(body.records.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })

  it('filters by from, to and location', async () => {
    expect(((await get({ from: '2026-09-01T00:00:00Z' })).body as { count: number }).count).toBe(2)
    expect(((await get({ to: '2026-08-15T00:00:00Z' })).body as { count: number }).count).toBe(1)
    expect(((await get({ location: 'downtown' })).body as { count: number }).count).toBe(2)
    expect(((await get({ location: 'all' })).body as { count: number }).count).toBe(3)
  })

  it('caps with limit', async () => {
    expect(((await get({ limit: '2' })).body as { count: number }).count).toBe(2)
  })

  it('explains an unreadable date rather than returning nonsense', async () => {
    const out = await get({ from: 'yesterday-ish' })
    expect(out.status).toBe(400)
    expect(JSON.stringify(out.body)).toMatch(/not a date/)
  })

  it('sends CORS and no-store headers, because the dashboard is another origin', async () => {
    const out = await get()
    expect(out.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(out.headers['Cache-Control']).toBe('no-store')
  })
})

describe('method handling', () => {
  it('answers preflight with 204 and the allowed methods', async () => {
    const { res, captured } = makeResponse()
    await boxes(makeRequest({ method: 'OPTIONS' }), res)
    expect(captured.status).toBe(204)
    expect(captured.headers['Access-Control-Allow-Methods']).toMatch(/POST/)
  })

  it('405s anything else and says what is allowed', async () => {
    const { res, captured } = makeResponse()
    await boxes(makeRequest({ method: 'DELETE' }), res)
    expect(captured.status).toBe(405)
    expect(captured.headers['Allow']).toBe('GET, POST, OPTIONS')
  })
})

describe('GET /api/health', () => {
  it('reports the store, and admits when it is not durable', async () => {
    const { res, captured } = makeResponse()
    await health(makeRequest({ method: 'GET' }), res)
    expect(captured.status).toBe(200)
    expect(captured.body).toMatchObject({ ok: true, store: 'memory', durable: false })
    expect((captured.body as { note: string }).note).toMatch(/lost when the serverless instance restarts/)
  })

  it('counts what has been stored', async () => {
    await post(box())
    const { res, captured } = makeResponse()
    await health(makeRequest({ method: 'GET' }), res)
    expect(captured.body).toMatchObject({ count: 1 })
  })
})

describe('validateRecord', () => {
  it('normalises completedAt to ISO and defaults missing startedAt to it', () => {
    const result = validateRecord(box({ startedAt: 'nonsense', completedAt: '2026-09-16T17:00:30Z' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.completedAt).toBe('2026-09-16T17:00:30.000Z')
    expect(result.record.startedAt).toBe('2026-09-16T17:00:30Z')
  })

  it('refuses an unknown capture method instead of quietly calling it a tap', () => {
    const result = validateRecord(box({ method: 'telepathy' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.why).toMatch(/unknown capture method/)
  })

  it('coerces a demo flag to a real boolean', () => {
    const result = validateRecord(box({ demo: 'true' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.demo).toBe(false)
  })
})
