import { useState } from 'react'
import { BoxScreen } from './features/box/BoxScreen.tsx'
import { RecordsScreen } from './features/records/RecordsScreen.tsx'
import { StatsScreen } from './features/stats/StatsScreen.tsx'
import { generateDemoRecords } from './app/demoData.ts'
import { enterDemoMode, exitDemoMode, listRecords } from './features/records/records.ts'

type Tab = 'box' | 'records' | 'stats'

export default function App() {
  const [tab, setTab] = useState<Tab>('box')
  const [refreshKey, setRefreshKey] = useState(0)
  const [demoOn, setDemoOn] = useState(() => listRecords().some((r) => r.demo))

  function toggleDemo() {
    if (demoOn) {
      exitDemoMode()
      setDemoOn(false)
    } else {
      enterDemoMode(generateDemoRecords())
      setDemoOn(true)
    }
    setRefreshKey((k) => k + 1)
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
      {tab === 'box' && <BoxScreen key={refreshKey} onSaved={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'records' && <RecordsScreen key={refreshKey} onChange={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'stats' && <StatsScreen key={refreshKey} />}
    </main>
  )
}
