import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { CaseLayout } from '../../domain/types.ts'
import { getFlavor } from '../../data/flavors.ts'

interface FlavorGridProps { layout: CaseLayout; onTapCell: (index: number) => void; selectedIndex?: number | null; disabled?: boolean; query?: string }

export function FlavorGrid({ layout, onTapCell, selectedIndex = null, disabled = false, query = '' }: FlavorGridProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [focusedIndex, setFocusedIndex] = useState(() => layout.cells.findIndex((c) => c !== null))
  const normalizedQuery = query.trim().toLowerCase()

  function moveFocus(from: number, deltaRow: number, deltaCol: number) { const row = Math.floor(from / layout.cols) + deltaRow; const col = (from % layout.cols) + deltaCol; if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) return; const next = row * layout.cols + col; if (layout.cells[next] === null) return; setFocusedIndex(next); buttonRefs.current[next]?.focus() }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) { if (event.key === 'ArrowRight') { event.preventDefault(); moveFocus(index, 0, 1) } if (event.key === 'ArrowLeft') { event.preventDefault(); moveFocus(index, 0, -1) } if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(index, 1, 0) } if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(index, -1, 0) } }

  return <div className="flavor-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }} role="grid">{layout.cells.map((flavorId, index) => {
    if (!flavorId) return <div key={index} className="flavor-tile flavor-tile--empty" aria-hidden="true" />
    const flavor = getFlavor(flavorId)
    const matches = !normalizedQuery || flavor.name.toLowerCase().includes(normalizedQuery)
    const classes = ['flavor-tile']; if (selectedIndex === index) classes.push('flavor-tile--selected'); if (normalizedQuery && !matches) classes.push('flavor-tile--dim')
    return <button key={index} ref={(el) => { buttonRefs.current[index] = el }} type="button" className={classes.join(' ')} tabIndex={index === focusedIndex ? 0 : -1} onFocus={() => setFocusedIndex(index)} onKeyDown={(e) => handleKeyDown(e, index)} onClick={() => onTapCell(index)} disabled={disabled}>
      <span className="flavor-image-wrap"><img src={flavor.imageUrl} alt="" loading="lazy" /><span className={`chocolate-dot chocolate-${flavor.chocolate ?? 'mixed'}`} /></span><span className="flavor-name">{flavor.name}</span>{(flavor.seasonal || flavor.allergens.length > 0) && <span className="flavor-tile-badges">{flavor.seasonal && <span className="badge badge-seasonal">Seasonal</span>}{flavor.allergens.slice(0, 2).map((allergen) => <span key={allergen} className="badge">{allergen}</span>)}</span>}
    </button>
  })}</div>
}
