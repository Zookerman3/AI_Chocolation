import { describe, expect, it } from 'vitest'
import { AlignmentTracker, cornersOf } from './alignment.ts'
import { outlineHomography } from './gridFinder.ts'
import type { GridFit } from './gridFinder.ts'
import { outlineRect } from './grid.ts'

const grid = { rows: 4, cols: 4 }
const outline = outlineRect(grid, 480, 360)
const cellW = outline.width / grid.cols

/** A fit sitting exactly on the outline, nudged by (dx, dy) in normalised frame units. */
function fitAt(dx = 0, dy = 0): GridFit {
  const h = outlineHomography(grid, outline)
  h[2] += dx
  h[5] += dy
  return { homography: h, landmarks: 12, inliers: 10, pitch: cellW }
}

describe('AlignmentTracker', () => {
  it('is searching while there is no fit', () => {
    const t = new AlignmentTracker(grid, outline)
    expect(t.push(null)).toMatchObject({ phase: 'searching', corners: null, stableTicks: 0 })
  })

  it('locks after three steady readings on the outline, and not before', () => {
    const t = new AlignmentTracker(grid, outline)
    expect(t.push(fitAt()).phase).toBe('aligning')
    expect(t.push(fitAt()).phase).toBe('aligning')
    const third = t.push(fitAt())
    expect(third.phase).toBe('locked')
    expect(third.stableTicks).toBe(3)
    expect(third.corners).toHaveLength(4)
  })

  it('stays aligning while the box keeps moving, and the count restarts', () => {
    const t = new AlignmentTracker(grid, outline)
    t.push(fitAt())
    t.push(fitAt())
    // A third of a cell sideways is a hand still settling, not a box in place.
    const moved = t.push(fitAt(cellW / 3, 0))
    expect(moved.phase).toBe('aligning')
    expect(moved.stableTicks).toBe(0)
    expect(t.push(fitAt(cellW / 3, 0)).stableTicks).toBe(1)
  })

  it('does not lock on a box that is found but well off the outline', () => {
    const t = new AlignmentTracker(grid, outline)
    for (let i = 0; i < 5; i++) expect(t.push(fitAt(cellW, cellW)).phase).toBe('aligning')
  })

  it('a lost fit and a reset both forget the run-up', () => {
    const t = new AlignmentTracker(grid, outline)
    t.push(fitAt())
    t.push(fitAt())
    expect(t.push(null).phase).toBe('searching')
    expect(t.push(fitAt()).stableTicks).toBe(1)
    t.push(fitAt())
    t.reset()
    expect(t.push(fitAt()).stableTicks).toBe(1)
  })

  it('honours a custom number of steady readings', () => {
    const t = new AlignmentTracker(grid, outline, { stableTicksNeeded: 1 })
    expect(t.push(fitAt()).phase).toBe('locked')
  })
})

describe('cornersOf', () => {
  it('returns the outline corners for the outline homography', () => {
    const [tl, tr, br, bl] = cornersOf(fitAt(), grid)
    expect(tl.x).toBeCloseTo(outline.x)
    expect(tl.y).toBeCloseTo(outline.y)
    expect(tr.x).toBeCloseTo(outline.x + outline.width)
    expect(br.y).toBeCloseTo(outline.y + outline.height)
    expect(bl.x).toBeCloseTo(outline.x)
  })
})
