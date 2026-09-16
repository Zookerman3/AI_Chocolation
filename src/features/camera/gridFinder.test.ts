import { describe, expect, it } from 'vitest'
import { cellBounds, findGrid, findLandmarks, outlineHomography, project, warpCell } from './gridFinder.ts'
import type { Homography } from './gridFinder.ts'
import { outlineRect } from './grid.ts'
import type { GridSpec } from './grid.ts'

const W = 640
const H = 480
const grid: GridSpec = { rows: 5, cols: 6 }
const outline = outlineRect(grid, W, H)

/** The outline's lattice, moved by (du, dv) cells, scaled and turned (pixel space). */
function movedLattice(du: number, dv: number, scale: number, degrees: number): Homography {
  const base = outlineHomography(grid, outline)
  const t = (degrees * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const aspect = W / H
  const cw = base[0] * scale
  const ch = base[4] * scale
  const cx = outline.x + outline.width / 2 + du * base[0]
  const cy = outline.y + outline.height / 2 + dv * base[4]
  const h = new Float64Array(9)
  h[0] = cw * cos
  h[1] = (-ch * sin) / aspect
  h[2] = cx - h[0] * (grid.cols / 2) - h[1] * (grid.rows / 2)
  h[3] = cw * sin * aspect
  h[4] = ch * cos
  h[5] = cy - h[3] * (grid.cols / 2) - h[4] * (grid.rows / 2)
  h[8] = 1
  return h
}

/** A dark frame with a saturated disc in every non-empty cell of the lattice,
 * plus a big coloured "lid" across the top edge that must not count. */
function frameWith(h: Homography, empty: string[] = [], lid = true): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < W * H; i++) px.set([22, 20, 24, 255], i * 4)
  const pitch = Math.hypot((project(h, 1, 0).x - project(h, 0, 0).x) * W, (project(h, 1, 0).y - project(h, 0, 0).y) * H)
  const colours: [number, number, number][] = [
    [200, 40, 40],
    [40, 160, 220],
    [230, 200, 30],
    [120, 60, 200],
    [40, 190, 90],
  ]
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      if (empty.includes(`${r}.${c}`)) continue
      const centre = project(h, c - 0.5, r - 0.5)
      const cx = centre.x * W
      const cy = centre.y * H
      const radius = 0.3 * pitch
      const [cr, cg, cb] = colours[(r + c) % colours.length]
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue
          px.set([cr, cg, cb, 255], (y * W + x) * 4)
        }
      }
    }
  }
  if (lid) {
    for (let y = 0; y < 18; y++) for (let x = 0; x < W; x++) px.set([180, 30, 90, 255], (y * W + x) * 4)
  }
  return px
}

function maxCentreError(found: Homography, truth: Homography): number {
  let worst = 0
  const pitch = Math.hypot((project(truth, 1, 0).x - project(truth, 0, 0).x) * W, (project(truth, 1, 0).y - project(truth, 0, 0).y) * H)
  for (let r = 1; r <= grid.rows; r++) {
    for (let c = 1; c <= grid.cols; c++) {
      const a = project(found, c - 0.5, r - 0.5)
      const b = project(truth, c - 0.5, r - 0.5)
      worst = Math.max(worst, Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) / pitch)
    }
  }
  return worst
}

describe('findLandmarks', () => {
  it('finds one landmark per piece and ignores the lid', () => {
    const truth = movedLattice(0, 0, 1, 0)
    const cellPx = (outline.width * W) / grid.cols
    const found = findLandmarks(frameWith(truth, ['1.1', '3.4']), W, H, cellPx)
    expect(found).toHaveLength(28)
    expect(found.every((p) => p.y > 0.05)).toBe(true)
  })
})

describe('findGrid', () => {
  it('recovers a lattice that is off the outline, smaller and turned', () => {
    const truth = movedLattice(0.7, -0.4, 0.85, 14)
    const fit = findGrid(frameWith(truth, ['2.2', '4.5', '5.6']), W, H, grid, outline)
    expect(fit).not.toBeNull()
    expect(fit?.inliers).toBeGreaterThanOrEqual(25)
    expect(maxCentreError(fit!.homography, truth)).toBeLessThan(0.08)
  })

  it('recovers a tilted lattice (perspective)', () => {
    // A plane seen at an angle: rows farther from the camera are narrower. A
    // perspective about the frame centre, x' = cx + (x-cx)/w, y' = cy + (y-cy)/w,
    // w = 1 + k(y-cy), applied after the base lattice.
    const base = movedLattice(0, 0, 0.95, 0)
    const cx = 0.5
    const cy = 0.5
    const k = 0.5 // far edge ~0.64 x the near edge
    const P = [1, k * cx, -k * cx * cy, 0, 1 + k * cy, -k * cy * cy, 0, k, 1 - k * cy]
    const truth = new Float64Array(9)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) truth[r * 3 + c] = P[r * 3] * base[c] + P[r * 3 + 1] * base[3 + c] + P[r * 3 + 2] * base[6 + c]
    for (let i = 0; i < 9; i++) truth[i] /= truth[8]
    const fit = findGrid(frameWith(truth, ['1.6']), W, H, grid, outline)
    expect(fit).not.toBeNull()
    expect(maxCentreError(fit!.homography, truth)).toBeLessThan(0.1)
  })

  it('prefers the lattice nearest the outline when an edge column is empty', () => {
    // whole last column empty: a lattice shifted one cell right also fits the
    // points; the one closer to the outline must win
    const truth = movedLattice(0.2, 0, 1, 0)
    const fit = findGrid(frameWith(truth, ['1.6', '2.6', '3.6', '4.6', '5.6']), W, H, grid, outline)
    expect(fit).not.toBeNull()
    expect(maxCentreError(fit!.homography, truth)).toBeLessThan(0.08)
  })

  it('gives up on an empty frame and on too few pieces', () => {
    const truth = movedLattice(0, 0, 1, 0)
    expect(findGrid(frameWith(truth, [], false).fill(20), W, H, grid, outline)).toBeNull()
    const almostEmpty = [...Array(grid.rows * grid.cols).keys()].map((i) => `${Math.floor(i / grid.cols) + 1}.${(i % grid.cols) + 1}`).slice(3)
    expect(findGrid(frameWith(truth, almostEmpty), W, H, grid, outline)).toBeNull()
  })
})

describe('warpCell and cellBounds', () => {
  it('reads a cell through the fitted homography', () => {
    const truth = movedLattice(0.5, 0.3, 0.9, -12)
    const frame = frameWith(truth, ['3.3'])
    const crop = warpCell(frame, W, H, truth, 2, 2, 64) // (2,2) is (r+c)%5 = 4 -> green
    const mid = (32 * 64 + 32) * 4
    expect(crop[mid + 1]).toBeGreaterThan(150)
    expect(crop[mid]).toBeLessThan(80)
    const emptyCrop = warpCell(frame, W, H, truth, 3, 3, 64)
    expect(emptyCrop[mid]).toBeLessThan(40)
    const bounds = cellBounds(truth, 2, 2)
    const centre = project(truth, 1.5, 1.5)
    expect(centre.x).toBeGreaterThan(bounds.x)
    expect(centre.x).toBeLessThan(bounds.x + bounds.width)
    expect(centre.y).toBeGreaterThan(bounds.y)
    expect(centre.y).toBeLessThan(bounds.y + bounds.height)
  })
})
