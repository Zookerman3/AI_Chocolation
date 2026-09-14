import { useState } from 'react'
import { listRecords } from '../records/records.ts'
import { topCombos, topFlavors } from './stats.ts'
import { getFlavor } from '../../data/flavors.ts'
import type { BoxRecord } from '../../domain/types.ts'

interface StatsScreenProps {
  /** When set, shows stats for this instead of real storage (demo mode). */
  demoRecords?: BoxRecord[]
}

export function StatsScreen({ demoRecords }: StatsScreenProps) {
  const isDemo = demoRecords !== undefined
  const [stored, setStored] = useState(() => listRecords())
  const records = isDemo ? demoRecords : stored
  const flavors = topFlavors(records)
  const combos = topCombos(records)
  const maxFlavorCount = flavors[0]?.count ?? 1

  return (
    <section aria-labelledby="stats-heading">
      <div className="stats-header">
        <h2 id="stats-heading">
          Across {records.length} saved boxes{isDemo ? ' · demo' : ''}
        </h2>
        <button type="button" onClick={() => setStored(listRecords())} disabled={isDemo}>
          Refresh
        </button>
      </div>

      <h3>Most-picked flavors</h3>
      {flavors.length === 0 ? (
        <p>No boxes saved yet.</p>
      ) : (
        <ul className="stats-bars">
          {flavors.map(({ flavorId, count }) => (
            <li key={flavorId}>
              <span className="stats-bar-label">{getFlavor(flavorId).name}</span>
              <span className="stats-bar-track">
                <span className="stats-bar-fill" style={{ width: `${(count / maxFlavorCount) * 100}%` }} />
              </span>
              <span className="stats-bar-count">{count}</span>
            </li>
          ))}
        </ul>
      )}

      <h3>Combinations customers keep coming back to</h3>
      {combos.length === 0 ? (
        <p>Not enough multi-flavor boxes yet.</p>
      ) : (
        <ol className="stats-combos">
          {combos.map((combo) => (
            <li key={combo.flavorIds.join('|')}>
              {combo.flavorIds.map((id) => getFlavor(id).name).join(' + ')} — {combo.count} box
              {combo.count === 1 ? '' : 'es'}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
