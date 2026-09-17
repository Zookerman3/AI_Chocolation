// One sync pass: find what the server has not acknowledged, send it in batches,
// and remember only what actually came back acknowledged.
//
// Nothing here throws into the caller's render path, and nothing here touches
// the saved records themselves — a sync can fail in every possible way and the
// counter keeps working exactly as it did before there was an API.

import type { BoxRecord } from '../../domain/types.ts'
import { BATCH_SIZE, pushBatch, SyncError } from './client.ts'
import { loadAcked, markAcked, markSyncedNow, pending } from './outbox.ts'

export interface SyncOutcome {
  /** Boxes the server acknowledged this pass. */
  sent: number
  /** Boxes the server refused; they are marked acknowledged so we stop retrying
   * a record it will never accept, and reported so a human can see why. */
  rejected: { id: unknown; why: string }[]
  /** Still waiting after this pass — usually because the network went away. */
  remaining: number
  durable: boolean
  error: string | null
}

export interface SyncOptions {
  records: readonly BoxRecord[]
  signal?: AbortSignal
  push?: typeof pushBatch
}

export async function syncOnce(options: SyncOptions): Promise<SyncOutcome> {
  const push = options.push ?? pushBatch
  const acked = loadAcked()
  const queue = pending(options.records, acked)

  if (queue.length === 0) {
    markSyncedNow()
    return { sent: 0, rejected: [], remaining: 0, durable: false, error: null }
  }

  let sent = 0
  let durable = false
  const rejected: SyncOutcome['rejected'] = []

  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const batch = queue.slice(i, i + BATCH_SIZE)
    try {
      const result = await push(batch, options.signal)
      durable = result.durable
      markAcked(result.accepted)
      sent += result.accepted.length

      if (result.rejected.length) {
        rejected.push(...result.rejected)
        // A record the server has judged invalid will never become valid by
        // being sent again. Stop retrying it, but keep the reason.
        markAcked(
          result.rejected
            .map((r) => r.id)
            .filter((id): id is string => typeof id === 'string'),
        )
      }
    } catch (cause) {
      // Stop at the first failure: the rest of the queue is almost certainly
      // blocked by the same cause, and hammering a dead endpoint from a counter
      // tablet helps nobody. Everything unacknowledged stays queued.
      const remaining = pending(options.records, loadAcked()).length
      return {
        sent,
        rejected,
        remaining,
        durable,
        error: cause instanceof SyncError ? cause.message : 'Sync failed.',
      }
    }
  }

  markSyncedNow()
  return {
    sent,
    rejected,
    remaining: pending(options.records, loadAcked()).length,
    durable,
    error: null,
  }
}
