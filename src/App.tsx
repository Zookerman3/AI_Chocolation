import { useState } from 'react'
import { BoxScreen } from './features/box/BoxScreen.tsx'
import { RecordsScreen } from './features/records/RecordsScreen.tsx'
import { StatsScreen } from './features/stats/StatsScreen.tsx'
import { ErrorBoundary } from './app/ErrorBoundary.tsx'
import { SyncStatus } from './features/sync/SyncStatus.tsx'
import { LocationPicker } from './features/sync/LocationPicker.tsx'
import { useSync } from './features/sync/useSync.ts'

type Tab = 'box' | 'records' | 'stats'

export default function App() {
  const [tab, setTab] = useState<Tab>('box')
  const [refreshKey, setRefreshKey] = useState(0)
  // Sync runs off the same counter that already remounts Records and Stats after
  // a save, so a new box is offered to the server the moment it is stored — and
  // never before it is stored. Nothing on the counter waits for this.
  const sync = useSync(refreshKey)

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>✦</span></div>
          <div><p className="eyebrow">Cocoa Dolce · Counter tools</p><h1>AI Chocolation</h1></div>
        </div>
        <div className="header-tools">
          <SyncStatus state={sync} />
        </div>
      </header>
      <nav className="app-nav" aria-label="Screens">
        <button type="button" aria-label="Box" aria-current={tab === 'box'} onClick={() => setTab('box')}><span aria-hidden="true">▦</span> Box</button>
        <button type="button" aria-label="Records" aria-current={tab === 'records'} onClick={() => setTab('records')}><span aria-hidden="true">☷</span> Records</button>
        <button type="button" aria-label="Stats" aria-current={tab === 'stats'} onClick={() => setTab('stats')}><span aria-hidden="true">↗</span> Stats</button>
      </nav>
      {/* A saved layout or record can outlive the catalog it points at. Render paths use
          flavorOrPlaceholder and don't throw; this is the backstop for everything else,
          so a crash shows a reload card instead of a blank tablet mid-rush. */}
      <ErrorBoundary>
        {tab === 'box' && <BoxScreen onSaved={() => setRefreshKey((k) => k + 1)} />}
        {tab === 'records' && <RecordsScreen key={refreshKey} onChange={() => setRefreshKey((k) => k + 1)} />}
        {tab === 'stats' && <StatsScreen key={refreshKey} />}
      </ErrorBoundary>
      <footer className="app-footer">
        <LocationPicker onChange={() => sync.syncNow()} />
        <div className="app-footer-meta"><span>Made for the sweet spot.</span><span>Offline-ready · v1.0</span></div>
      </footer>
    </main>
  )
}
