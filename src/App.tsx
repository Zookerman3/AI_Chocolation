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

  // Demo mode is a pure display overlay: generated fresh, never written to the same
  // storage as real records, so a real box saved while it's on can't be lost.
  const demoRecords = useMemo(() => (demoOn ? generateDemoRecords() : undefined), [demoOn])

  function toggleDemo() {
    const next = !demoOn
    setDemoOn(next)
    try {
      if (next) localStorage.setItem(DEMO_MODE_KEY, '1')
      else localStorage.removeItem(DEMO_MODE_KEY)
    } catch {
      // localStorage unavailable (private mode, etc.) — demo toggle just won't persist
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <h1>AI Chocolation</h1>
        <label className="demo-toggle">
          <input type="checkbox" checked={demoOn} onChange={toggleDemo} />
          Demo mode
        </label>
      </header>
      <nav className="app-nav" aria-label="Screens">
        <button type="button" aria-current={tab === 'box'} onClick={() => setTab('box')}>
          Box
        </button>
        <button type="button" aria-current={tab === 'records'} onClick={() => setTab('records')}>
          Records
        </button>
        <button type="button" aria-current={tab === 'stats'} onClick={() => setTab('stats')}>
          Stats
        </button>
      </nav>
      {tab === 'box' && <BoxScreen onSaved={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'records' && <RecordsScreen key={refreshKey} demoRecords={demoRecords} onChange={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'stats' && <StatsScreen key={refreshKey} demoRecords={demoRecords} />}
    </main>
  )
}
