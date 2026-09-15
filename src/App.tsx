import { useMemo, useState } from 'react'
import { BoxScreen } from './features/box/BoxScreen.tsx'
import { RecordsScreen } from './features/records/RecordsScreen.tsx'
import { StatsScreen } from './features/stats/StatsScreen.tsx'
import { generateDemoRecords } from './app/demoData.ts'

const DEMO_MODE_KEY = 'ai-chocolation:demo-mode'

function loadDemoOn(): boolean {
  try {
    return localStorage.getItem(DEMO_MODE_KEY) === '1'
  } catch {
    return false
  }
}

type Tab = 'box' | 'records' | 'stats'

export default function App() {
  const [tab, setTab] = useState<Tab>('box')
  const [refreshKey, setRefreshKey] = useState(0)
  const [demoOn, setDemoOn] = useState(loadDemoOn)
  const demoRecords = useMemo(() => (demoOn ? generateDemoRecords() : undefined), [demoOn])

  function toggleDemo() {
    const next = !demoOn
    setDemoOn(next)
    try {
      if (next) localStorage.setItem(DEMO_MODE_KEY, '1')
      else localStorage.removeItem(DEMO_MODE_KEY)
    } catch {
      // Demo toggle still works if localStorage is unavailable.
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>✦</span></div>
          <div><p className="eyebrow">Cocoa Dolce · Counter tools</p><h1>AI Chocolation</h1></div>
        </div>
        <label className="demo-toggle"><input type="checkbox" checked={demoOn} onChange={toggleDemo} /><span className="toggle-track" aria-hidden="true" /><span>Demo mode</span></label>
      </header>
      <nav className="app-nav" aria-label="Screens">
        <button type="button" aria-label="Box" aria-current={tab === 'box'} onClick={() => setTab('box')}><span aria-hidden="true">▦</span> Box</button>
        <button type="button" aria-label="Records" aria-current={tab === 'records'} onClick={() => setTab('records')}><span aria-hidden="true">☷</span> Records</button>
        <button type="button" aria-label="Stats" aria-current={tab === 'stats'} onClick={() => setTab('stats')}><span aria-hidden="true">↗</span> Stats</button>
      </nav>
      {tab === 'box' && <BoxScreen onSaved={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'records' && <RecordsScreen key={refreshKey} demoRecords={demoRecords} onChange={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'stats' && <StatsScreen key={refreshKey} demoRecords={demoRecords} />}
      <footer className="app-footer"><span>Made for the sweet spot.</span><span>Offline-ready · v1.0</span></footer>
    </main>
  )
}
