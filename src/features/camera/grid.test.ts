import { describe, expect, it } from 'vitest'
import { BOX_SIZES } from '../../domain/types.ts'
import { cells, GRID_BY_SIZE, gridFor, outlineRect } from './grid.ts'

describe('gridFor', () => {
  it('knows the measured inserts and admits what it does not know', () => {
    expect(gridFor(16)).toEqual({ rows: 4, cols: 4 })
    expect(gridFor(30)).toEqual({ rows: 5, cols: 6 })
    expect(gridFor(50)).toBeNull()
  })

  it('every grid it does know holds exactly that many pieces', () => {
    for (const size of BOX_SIZES) {
      const g = GRID_BY_SIZE[size]
      if (g) expect(g.rows * g.cols).toBe(size)
    }
  })
})

describe('outlineRect', () => {
  it('is centred with square cells and stays inside the frame', () => {
    const r = outlineRect({ rows: 4, cols: 4 }, 1920, 1440)
    expect(r.x).toBeCloseTo((1 - r.width) / 2, 6)
    expect(r.y).toBeCloseTo((1 - r.height) / 2, 6)
    expect(r.width * 1920).toBeCloseTo(r.height * 1440, 3) // square cells
    expect(r.x).toBeGreaterThan(0)
    expect(r.y).toBeGreaterThan(0)
    expect(r.x + r.width).toBeLessThan(1)
    expect(r.y + r.height).toBeLessThan(1)
  })

  it('fits a wide insert in a portrait frame by width', () => {
    const r = outlineRect({ rows: 5, cols: 6 }, 3024, 4032)
    expect(r.width).toBeCloseTo(0.88, 6)
  })
})

describe('cells', () => {
  it('lists cells in the same reading order as the training labels: left to right, then down', () => {
    const grid = { rows: 2, cols: 3 }
    const list = cells(grid, outlineRect(grid, 1200, 800))
    expect(list.map((c) => `${c.row}.${c.col}`)).toEqual(['1.1', '1.2', '1.3', '2.1', '2.2', '2.3'])
    expect(list[1].box.x).toBeGreaterThan(list[0].box.x)
    expect(list[3].box.y).toBeGreaterThan(list[0].box.y)
  })

  it('reads an inset region so the divider walls stay out of the crop', () => {
    const grid = { rows: 1, cols: 1 }
    const [c] = cells(grid, { x: 0, y: 0, width: 1, height: 1 })
    expect(c.read.x).toBeGreaterThan(c.box.x)
    expect(c.read.width).toBeLessThan(c.box.width)
    expect(c.read.x + c.read.width).toBeLessThan(c.box.x + c.box.width)
  })
})
