import { beforeEach, describe, expect, it } from 'vitest'
import { defaultLayout, loadLayout, saveLayout, swapCells } from './caseLayout.ts'
import { FLAVORS } from '../../data/flavors.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('caseLayout', () => {
  it('builds a default grid that fits every flavor exactly once', () => {
    const layout = defaultLayout()
    expect(layout.cells).toHaveLength(layout.rows * layout.cols)
    const ids = layout.cells.filter((c): c is string => c !== null)
    expect(new Set(ids).size).toBe(FLAVORS.length)
    expect(ids.sort()).toEqual(
      FLAVORS.map((f) => f.id)
        .slice()
        .sort(),
    )
  })

  it('falls back to the default layout when nothing is saved', () => {
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('round-trips through localStorage', () => {
    const swapped = swapCells(defaultLayout(), 0, 1)
    saveLayout(swapped)
    expect(loadLayout()).toEqual(swapped)
  })

  it('falls back to default if saved data references an unknown flavor', () => {
    localStorage.setItem(
      'ai-chocolation:case-layout',
      JSON.stringify({ rows: 1, cols: 1, cells: ['not-a-real-flavor'] }),
    )
    expect(loadLayout()).toEqual(defaultLayout())
  })

  it('swaps two cells without mutating the input', () => {
    const layout = defaultLayout()
    const before = [...layout.cells]
    const swapped = swapCells(layout, 0, 2)
    expect(layout.cells).toEqual(before)
    expect(swapped.cells[0]).toBe(before[2])
    expect(swapped.cells[2]).toBe(before[0])
  })
})
