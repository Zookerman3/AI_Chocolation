import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FlavorGrid } from './FlavorGrid.tsx'
import { defaultLayout } from './caseLayout.ts'
import { FLAVORS } from '../../data/flavors.ts'

describe('FlavorGrid', () => {
  it('dims tiles that do not match the search query, without disabling them', () => {
    const layout = defaultLayout()
    const onTapCell = vi.fn()
    render(<FlavorGrid layout={layout} onTapCell={onTapCell} query={FLAVORS[0].name} />)

    const match = screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) })
    const nonMatch = screen.getByRole('button', { name: new RegExp(FLAVORS[1].name) })
    expect(match.className).not.toContain('flavor-tile--dim')
    expect(nonMatch.className).toContain('flavor-tile--dim')

    fireEvent.click(nonMatch)
    expect(onTapCell).toHaveBeenCalledWith(1)
  })

  it('moves focus between tiles with arrow keys, following the grid shape', () => {
    const layout = defaultLayout()
    render(<FlavorGrid layout={layout} onTapCell={vi.fn()} />)

    const first = screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) })
    first.focus()
    expect(document.activeElement).toBe(first)

    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const second = screen.getByRole('button', { name: new RegExp(FLAVORS[1].name) })
    expect(document.activeElement).toBe(second)

    // Down from column 1 lands one full row later, whatever width the catalog makes the grid.
    fireEvent.keyDown(second, { key: 'ArrowDown' })
    const belowSecond = screen.getByRole('button', { name: new RegExp(FLAVORS[1 + layout.cols].name) })
    expect(document.activeElement).toBe(belowSecond)
  })

  it('shows allergen badges from the catalog data', () => {
    const layout = defaultLayout()
    render(<FlavorGrid layout={layout} onTapCell={vi.fn()} />)
    const amaretto = FLAVORS.find((f) => f.id === 'amaretto')!
    expect(amaretto.allergens.length).toBeGreaterThan(0)
    const tile = screen.getByRole('button', { name: new RegExp(amaretto.name) })
    for (const allergen of amaretto.allergens) {
      expect(tile).toHaveTextContent(allergen)
    }
  })
})
