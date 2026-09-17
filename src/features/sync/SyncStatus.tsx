// A small, honest status line in the header. It says what is true: how many
// boxes the office has, how many are still on this tablet, and whether the
// server is keeping them.

import type { SyncState } from './useSync.ts'

export function SyncStatus({ state, onSync }: { state: SyncState & { syncNow: () => void }; onSync?: () => void }) {
  const { phase, queued, lastSync, lastError, online } = state

  const label =
    !online ? 'Offline · boxes saved here'
    : phase === 'syncing' ? 'Syncing…'
    : queued > 0 ? `${queued} box${queued === 1 ? '' : 'es'} waiting`
    : phase === 'error' ? 'Sync failed'
    : lastSync ? 'Synced'
    : 'Not synced yet'

  const tone: 'ok' | 'waiting' | 'error' =
    phase === 'error' ? 'error' : !online || queued > 0 ? 'waiting' : 'ok'

  const detail =
    lastError ??
    (lastSync ? `Last synced ${lastSync.toLocaleTimeString()}` : 'Boxes are saved on this tablet either way.')

  return (
    <button
      type="button"
      className={`sync-status sync-status-${tone}`}
      onClick={() => { onSync?.(); state.syncNow() }}
      title={detail}
      aria-label={`${label}. ${detail}. Tap to sync now.`}
    >
      <span className="sync-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
