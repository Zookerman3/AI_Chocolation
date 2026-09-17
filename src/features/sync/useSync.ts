// Sync as a background concern. Nothing in here is on the path between a
// cashier's tap and a saved box.

import { useCallback, useEffect, useRef, useState } from 'react'
import { listRecords } from '../records/records.ts'
import { loadLastSync, pending, loadAcked } from './outbox.ts'
import { syncOnce } from './sync.ts'
import type { SyncOutcome } from './sync.ts'

/** Quiet retry while boxes are waiting. Long enough not to hammer a dead
 * endpoint from a counter tablet, short enough that the office sees today's
 * boxes today. */
const RETRY_MS = 60_000

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'waiting' | 'error'

export interface SyncState {
  phase: SyncPhase
  queued: number
  lastSync: Date | null
  lastError: string | null
  rejected: SyncOutcome['rejected']
  durable: boolean
  online: boolean
}

export function useSync(trigger: unknown): SyncState & { syncNow: () => void } {
  const [state, setState] = useState<SyncState>(() => ({
    phase: 'idle',
    queued: 0,
    lastSync: loadLastSync(),
    lastError: null,
    rejected: [],
    durable: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  }))

  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    setState((s) => ({ ...s, phase: 'syncing' }))
    try {
      const records = listRecords()
      const outcome = await syncOnce({ records })
      if (!alive.current) return
      setState((s) => ({
        ...s,
        phase: outcome.error ? 'error' : outcome.remaining > 0 ? 'waiting' : 'synced',
        queued: outcome.remaining,
        lastSync: loadLastSync(),
        lastError: outcome.error,
        rejected: outcome.rejected.length ? outcome.rejected : s.rejected,
        durable: outcome.durable,
      }))
    } catch (cause) {
      if (!alive.current) return
      // Belt and braces: syncOnce is written not to throw, but a sync must never
      // be able to take the counter down.
      setState((s) => ({
        ...s,
        phase: 'error',
        lastError: cause instanceof Error ? cause.message : 'Sync failed.',
      }))
    } finally {
      running.current = false
    }
  }, [])

  // Recount the queue whenever records change, without touching the network.
  useEffect(() => {
    setState((s) => ({ ...s, queued: pending(listRecords(), loadAcked()).length }))
  }, [trigger])

  // Sync on mount and after every saved box.
  useEffect(() => { void run() }, [run, trigger])

  // And whenever the tablet comes back onto the wifi.
  useEffect(() => {
    const onOnline = () => {
      setState((s) => ({ ...s, online: true }))
      void run()
    }
    const onOffline = () => setState((s) => ({ ...s, online: false, phase: 'waiting' }))
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [run])

  // Quiet retry while anything is still queued.
  useEffect(() => {
    if (state.queued === 0) return
    const timer = window.setInterval(() => { void run() }, RETRY_MS)
    return () => window.clearInterval(timer)
  }, [state.queued, run])

  return { ...state, syncNow: () => { void run() } }
}
