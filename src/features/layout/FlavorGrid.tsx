import type { CaseLayout } from '../../domain/types.ts'
import { getFlavor } from '../../data/flavors.ts'

interface FlavorGridProps {
  layout: CaseLayout
  onTapCell: (index: number) => void
  /** Highlights a cell, e.g. the first pick of a rearrange swap. */
  selectedIndex?: number | null
  disabled?: boolean
}

export function FlavorGrid({ layout, onTapCell, selectedIndex = null, disabled = false }: FlavorGridProps) {
  return (
    <div className="flavor-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)` }} role="grid">
      {layout.cells.map((flavorId, index) => {
        if (!flavorId) {
          return <div key={index} className="flavor-tile flavor-tile--empty" aria-hidden="true" />
        }
        const flavor = getFlavor(flavorId)
        return (
          <button
            key={index}
            type="button"
            className={`flavor-tile${selectedIndex === index ? ' flavor-tile--selected' : ''}`}
            onClick={() => onTapCell(index)}
            disabled={disabled}
          >
            <img src={flavor.imageUrl} alt="" loading="lazy" />
            <span>{flavor.name}</span>
          </button>
        )
      })}
    </div>
  )
}
