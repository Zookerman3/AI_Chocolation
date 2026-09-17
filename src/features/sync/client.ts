// Posting boxes to the API. Pure transport: no React, no storage.

import type { BoxRecord } from '../../domain/types.ts'

/** Same-origin by default — on Vercel the API is deployed alongside this app, so
 * a counter tablet needs no configuration at all. */
export const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? '/api/boxes'
export const HEALTH_URL: string = SYNC_URL.replace(/\/boxes$/, '/health')
const SYNC_TOKEN: string | undefined = import.meta.env.VITE_SYNC_TOKEN

/** Batches stay well under the server's limit of 500. */
export const BATCH_SIZE = 100

export class SyncError extends Error {}

export interface PushResult {
  accepted: string[]
  rejected: { id: unknown; why: string }[]
  durable: boolean
}

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(SYNC_TOKEN ? { 'x-sync-token': SYNC_TOKEN } : {}),
  }
}

export async function pushBatch(records: readonly BoxRecord[], signal?: AbortSignal): Promise<PushResult> {
  let response: Response
  try {
    response = await fetch(SYNC_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ records }),
      signal,
    })
  } catch (cause) {
    throw new SyncError('No answer from the sync endpoint.', { cause })
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  // 200 = all accepted, 207 = some rejected, 422 = all rejected. All three are
  // the server giving a verdict on these records, and all three carry a
  // `rejected` list. Only the rest are transport failures worth retrying —
  // without this, a single permanently-invalid box would be re-sent from a
  // counter tablet every minute, forever.
  const answered = response.ok || response.status === 207 || response.status === 422
  if (!answered) {
    const detail = (payload as { error?: string })?.error
    throw new SyncError(detail ?? `The sync endpoint answered ${response.status}.`)
  }

  const body = (payload ?? {}) as Partial<PushResult>
  return {
    accepted: Array.isArray(body.accepted) ? body.accepted.filter((v): v is string => typeof v === 'string') : [],
    rejected: Array.isArray(body.rejected) ? body.rejected : [],
    durable: body.durable === true,
  }
}

export interface Health {
  ok: boolean
  store: string
  durable: boolean
  count: number
  writesProtected: boolean
  note?: string
}

export async function checkHealth(signal?: AbortSignal): Promise<Health> {
  let response: Response
  try {
    response = await fetch(HEALTH_URL, { signal, headers: { accept: 'application/json' } })
  } catch (cause) {
    throw new SyncError('The sync endpoint is not reachable.', { cause })
  }
  if (!response.ok) throw new SyncError(`Health check answered ${response.status}.`)
  return (await response.json()) as Health
}
