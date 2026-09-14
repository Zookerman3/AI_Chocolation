import { useState } from 'react'
import { clearRecords, listRecords } from './records.ts'
import { toCSV, toJSON } from './csv.ts'
import { getFlavor } from '../../data/flavors.ts'

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface RecordsScreenProps {
  onChange?: () => void
}

export function RecordsScreen({ onChange }: RecordsScreenProps) {
  const [records, setRecords] = useState(() => listRecords())

  function refresh() {
    setRecords(listRecords())
  }

  function handleClear() {
    if (!window.confirm('Clear all saved box records? This cannot be undone.')) return
    clearRecords()
    refresh()
    onChange?.()
  }

  return (
    <section aria-labelledby="records-heading">
      <h2 id="records-heading">Saved boxes ({records.length})</h2>
      <div className="records-actions">
        <button type="button" onClick={refresh}>
          Refresh
        </button>
        <button type="button" onClick={() => download('box-records.csv', toCSV(records), 'text/csv')} disabled={records.length === 0}>
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => download('box-records.json', toJSON(records), 'application/json')}
          disabled={records.length === 0}
        >
          Export JSON
        </button>
        <button type="button" onClick={handleClear} disabled={records.length === 0}>
          Clear all
        </button>
      </div>
      {records.length === 0 ? (
        <p>No boxes saved yet.</p>
      ) : (
        <ul className="records-list">
          {records.map((r) => (
            <li key={r.id}>
              <strong>{r.size}-piece</strong> · {r.demo ? 'demo · ' : ''}
              {(r.durationMs / 1000).toFixed(1)}s
              {r.undoCount > 0 ? ` · ${r.undoCount} undo${r.undoCount === 1 ? '' : 's'}` : ''}
              <br />
              {r.pieces.map((p) => `${getFlavor(p.flavorId).name} ×${p.count}`).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
