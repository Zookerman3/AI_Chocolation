// GET  /api/boxes?from=&to=&location=&limit=   — what the dashboard reads
// POST /api/boxes                              — what the tablet syncs up
//
// One route for both so the pair can never drift apart: the same validation, the
// same store, the same record shape in and out.

import {
  applyCors, fail, param, parseBody, preflight, writeAllowed,
} from './_lib/http.js'
import type { ApiRequest, ApiResponse } from './_lib/http.js'
import { validateRecord } from './_lib/record.js'
import type { BoxRecord } from './_lib/record.js'
import { getStore } from './_lib/store.js'

const MAX_BATCH = 500
const DEFAULT_LIMIT = 5000

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (preflight(req, res)) return

  const store = getStore()

  if (req.method === 'GET') {
    const from = parseDate(param(req, 'from'))
    const to = parseDate(param(req, 'to'))
    if (param(req, 'from') && !from) return fail(res, 400, '`from` is not a date we can read.')
    if (param(req, 'to') && !to) return fail(res, 400, '`to` is not a date we can read.')

    const rawLimit = Number(param(req, 'limit'))
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, DEFAULT_LIMIT) : DEFAULT_LIMIT

    const location = param(req, 'location')
    try {
      const records = await store.list({
        from,
        to,
        locationId: location && location !== 'all' ? location : undefined,
        limit,
      })
      applyCors(res)
      // A stale dashboard is worse than a slow one: boxes land continuously.
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        records,
        count: records.length,
        store: store.kind,
        durable: store.durable,
        generatedAt: new Date().toISOString(),
      })
    } catch (cause) {
      return fail(res, 502, 'The box store could not be read.', {
        detail: cause instanceof Error ? cause.message : String(cause),
      })
    }
    return
  }

  if (req.method === 'POST') {
    const allowed = writeAllowed(req)
    if (!allowed.ok) return fail(res, 401, allowed.why)

    const body = parseBody(req.body)
    if (body === undefined) return fail(res, 400, 'The request body is not valid JSON.')

    // Accept one record, a bare array, or { records: [...] } — the tablet may
    // send a single box or drain a whole offline queue.
    const list: unknown[] = Array.isArray(body)
      ? body
      : Array.isArray((body as { records?: unknown })?.records)
        ? (body as { records: unknown[] }).records
        : [body]

    if (list.length === 0) return fail(res, 400, 'No records in that request.')
    if (list.length > MAX_BATCH) {
      return fail(res, 413, `That batch has ${list.length} records; the limit is ${MAX_BATCH}.`)
    }

    const receivedAt = new Date().toISOString()
    const accepted: BoxRecord[] = []
    const rejected: { id: unknown; why: string }[] = []

    for (const entry of list) {
      const result = validateRecord(entry)
      if (result.ok) accepted.push({ ...result.record, receivedAt })
      else rejected.push({ id: (entry as { id?: unknown })?.id ?? null, why: result.why })
    }

    if (accepted.length === 0) {
      return fail(res, 422, 'No record in that request could be accepted.', { rejected })
    }

    try {
      await store.put(accepted)
    } catch (cause) {
      return fail(res, 502, 'The box store could not be written to.', {
        detail: cause instanceof Error ? cause.message : String(cause),
      })
    }

    applyCors(res)
    // The tablet clears an id from its outbox only when that id comes back here,
    // so this list is the acknowledgement, not a courtesy.
    res.status(rejected.length ? 207 : 200).json({
      accepted: accepted.map((r) => r.id),
      acceptedCount: accepted.length,
      rejected,
      store: store.kind,
      durable: store.durable,
      receivedAt,
    })
    return
  }

  applyCors(res)
  res.setHeader('Allow', 'GET, POST, OPTIONS')
  res.status(405).json({ error: `${req.method ?? 'That method'} is not allowed here. Use GET or POST.` })
}
