// Finds the insert's actual grid in a frame, so the box only has to be roughly
// where the outline says: off-centre, turned, closer, farther, or tilted.
//
// The chocolates themselves are the landmarks, not the box edge (the lid and
// its shadow sit against the insert in half the photos). Saturated blobs with
// black plastic around them are piece candidates; a rows x cols lattice is fitted
// through them starting from the outline, trying a spread of offsets, scales
// and turns; the best fit is refined to a homography, which is what a tilted
// plane looks like to a camera. Every cell is then read through that
// homography. Empty slots and the dark-brown pieces the colour mask misses
// don't matter — a dozen good landmarks pin the lattice, and a fit that
// doesn't reach that bar is reported as null so the caller falls back to the
// outline exactly as before.
//
// Pure: RGBA bytes in, a 3x3 matrix out. Runs in Node for the measurements.

import { CELL_INSET } from './grid.ts'
import type { GridSpec, Rect } from './grid.ts'

/** Lattice coordinates: cell (row r, col c), 1-based, spans u in [c-1, c] and
 * v in [r-1, r]; its centre is (c - 0.5, r - 0.5). The homography maps (u, v)
 * to normalised frame coordinates (0..1), row-major 3x3 with h[8] = 1. */
export type Homography = Float64Array

export interface GridFit {
  homography: Homography
  /** Piece candidates found in the frame. */
  landmarks: number
  /** How many of them sit on the fitted lattice. */
  inliers: number
  /** Cell pitch in normalised frame width, at the lattice centre. */
  pitch: number
}

/** Analysis happens on a copy this wide; enough for a 5x6 box to leave ~40 px
 * per cell, cheap enough to run on a tablet in tens of milliseconds. */
const ANALYSIS_WIDTH = 480

/** Piece candidate thresholds, OpenCV 8-bit HSV scale (S, V in 0..255). */
const MIN_SAT = 58
const MIN_VAL = 45
/** The black plastic around a piece: at least this share of a ring at 0.75 x the
 * blob size must be dark. Kills the coloured lid, ribbon, tablecloth and hands. */
const RING_DARK_VAL = 110
const RING_DARK_SHARE = 0.35

/** A match counts as an inlier within this fraction of a cell pitch. */
const INLIER_TOL = 0.25

export interface Landmark {
  x: number
  y: number
}

/** Area-average downscale of an RGBA frame to `width` wide (aspect kept). */
export function downscale(rgba: Uint8ClampedArray, sw: number, sh: number, width: number): { data: Uint8ClampedArray; width: number; height: number } {
  const height = Math.max(1, Math.round((sh * width) / sw))
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * sh) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / height))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * sw) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / width))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4
        for (let xx = x0; xx < x1; xx++) {
          r += rgba[i]
          g += rgba[i + 1]
          b += rgba[i + 2]
          i += 4
          n++
        }
      }
      const o = (y * width + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  }
  return { data: out, width, height }
}

/** Piece candidates in a (small) RGBA image, as normalised coordinates.
 * `cellPx` is the expected cell size in pixels at this scale, from the outline;
 * blobs far outside a piece's plausible size range are dropped. */
export function findLandmarks(rgba: Uint8ClampedArray, width: number, height: number, cellPx: number): Landmark[] {
  const n = width * height
  const sat = new Uint8Array(n)
  const val = new Uint8Array(n)
  const mask = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const r = rgba[p * 4]
    const g = rgba[p * 4 + 1]
    const b = rgba[p * 4 + 2]
    const v = Math.max(r, g, b)
    const s = v === 0 ? 0 : (255 * (v - Math.min(r, g, b))) / v
    sat[p] = s
    val[p] = v
    mask[p] = s > MIN_SAT && v > MIN_VAL ? 1 : 0
  }

  // A piece is roughly a disc 0.6 of the cell across; allow half to double that
  // (the scale seeds go 0.6..1.3), and splatter that breaks a piece into parts.
  const expected = Math.PI * (0.3 * cellPx) ** 2
  const minArea = Math.max(25, expected * 0.12)
  const maxArea = expected * 2.5

  const labels = new Int32Array(n) // 0 = unvisited
  const stack: number[] = []
  const out: Landmark[] = []
  let next = 0
  const visit = (q: number) => {
    if (mask[q] && !labels[q]) {
      labels[q] = next
      stack.push(q)
    }
  }
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue
    next++
    labels[start] = next
    stack.push(start)
    let area = 0
    let sx = 0
    let sy = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    while (stack.length) {
      const p = stack.pop() as number
      const x = p % width
      const y = (p - x) / width
      area++
      sx += x
      sy += y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0) visit(p - 1)
      if (x < width - 1) visit(p + 1)
      if (y > 0) visit(p - width)
      if (y < height - 1) visit(p + width)
    }
    if (area < minArea || area > maxArea) continue
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    const aspect = bw / bh
    if (aspect < 0.5 || aspect > 2) continue
    const cx = sx / area
    const cy = sy / area
    // black ring test
    const radius = 0.75 * Math.max(bw, bh)
    let dark = 0
    let samples = 0
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI
      const x = Math.round(cx + radius * Math.cos(a))
      const y = Math.round(cy + radius * Math.sin(a))
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      samples++
      const p = y * width + x
      if (val[p] <= RING_DARK_VAL && sat[p] <= RING_DARK_VAL) dark++
    }
    if (samples < 8 || dark / samples < RING_DARK_SHARE) continue
    out.push({ x: (cx + 0.5) / width, y: (cy + 0.5) / height })
  }
  return out
}

/** Solves A x = b for a small square system by Gaussian elimination with
 * partial pivoting. Returns null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    if (Math.abs(M[pivot][col]) < 1e-12) return null
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

interface Match {
  u: number
  v: number
  x: number
  y: number
}

/** Least-squares affine map (u,v) -> (x,y) as a homography with zero perspective. */
function fitAffine(m: Match[]): Homography | null {
  if (m.length < 3) return null
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const bx = [0, 0, 0]
  const by = [0, 0, 0]
  for (const { u, v, x, y } of m) {
    const row = [u, v, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]
      bx[i] += row[i] * x
      by[i] += row[i] * y
    }
  }
  const p = solve(A, bx)
  const q = solve(A, by)
  if (!p || !q) return null
  return new Float64Array([p[0], p[1], p[2], q[0], q[1], q[2], 0, 0, 1])
}

/** Least-squares homography (u,v) -> (x,y), DLT with h33 = 1, normal equations. */
function fitHomography(m: Match[]): Homography | null {
  if (m.length < 5) return null
  const A: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  const b = new Array<number>(8).fill(0)
  for (const { u, v, x, y } of m) {
    const rows = [
      [u, v, 1, 0, 0, 0, -x * u, -x * v],
      [0, 0, 0, u, v, 1, -y * u, -y * v],
    ]
    const rhs = [x, y]
    rows.forEach((row, k) => {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) A[i][j] += row[i] * row[j]
        b[i] += row[i] * rhs[k]
      }
    })
  }
  const h = solve(A, b)
  if (!h) return null
  return new Float64Array([...h, 1])
}

/** Applies a homography to lattice coordinates. */
export function project(h: Homography, u: number, v: number): { x: number; y: number } {
  const w = h[6] * u + h[7] * v + h[8]
  return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w }
}

/** Frame -> lattice, by inverting the 3x3. */
function invert(h: Homography): Homography | null {
  const [a, b, c, d, e, f, g, i, j] = h
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g)
  if (Math.abs(det) < 1e-15) return null
  return new Float64Array([
    (e * j - f * i) / det,
    (c * i - b * j) / det,
    (b * f - c * e) / det,
    (f * g - d * j) / det,
    (a * j - c * g) / det,
    (c * d - a * f) / det,
    (d * i - e * g) / det,
    (b * g - a * i) / det,
    (a * e - b * d) / det,
  ])
}

/** Distance in the frame between a point and a lattice node, in units of the
 * local cell pitch — so "close" means the same thing near and far. */
function pitchAt(h: Homography, u: number, v: number): number {
  const p0 = project(h, u, v)
  const p1 = project(h, u + 1, v)
  const p2 = project(h, u, v + 1)
  return (Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p0.x, p2.y - p0.y)) / 2
}

/** One assignment round: each landmark to its nearest lattice centre (via the
 * inverse map), kept if within `tol` pitches; one landmark per node, the closest. */
function assign(h: Homography, landmarks: Landmark[], grid: GridSpec, tol: number): Match[] {
  const inv = invert(h)
  if (!inv) return []
  const best = new Map<number, { d: number; m: Match }>()
  for (const p of landmarks) {
    const l = project(inv, p.x, p.y)
    const c = Math.min(grid.cols, Math.max(1, Math.round(l.x + 0.5)))
    const r = Math.min(grid.rows, Math.max(1, Math.round(l.y + 0.5)))
    const u = c - 0.5
    const v = r - 0.5
    const q = project(h, u, v)
    const d = Math.hypot(p.x - q.x, p.y - q.y) / pitchAt(h, u, v)
    if (d > tol) continue
    const key = r * 100 + c
    const prev = best.get(key)
    if (!prev || d < prev.d) best.set(key, { d, m: { u, v, x: p.x, y: p.y } })
  }
  return [...best.values()].map((e) => e.m)
}

/** The same map with the lattice moved by whole cells: (u, v) -> h(u + du, v + dv). */
function shifted(h: Homography, du: number, dv: number): Homography {
  const out = new Float64Array(h)
  out[2] = h[0] * du + h[1] * dv + h[2]
  out[5] = h[3] * du + h[4] * dv + h[5]
  out[8] = h[6] * du + h[7] * dv + h[8]
  for (let i = 0; i < 9; i++) out[i] /= out[8]
  return out
}

/** The outline as a homography: lattice cell (c, r) -> the outline's cells. */
export function outlineHomography(grid: GridSpec, outline: Rect): Homography {
  return new Float64Array([outline.width / grid.cols, 0, outline.x, 0, outline.height / grid.rows, outline.y, 0, 0, 1])
}

/** Fits the lattice to landmarks, starting from the outline. Returns null when
 * no fit clears the bar, in which case the outline is the honest answer. */
export function fitLattice(landmarks: Landmark[], grid: GridSpec, outline: Rect, frameAspect: number): GridFit | null {
  const cellsTotal = grid.rows * grid.cols
  const needed = Math.max(4, Math.min(8, Math.ceil(cellsTotal * 0.3)))
  if (landmarks.length < needed) return null

  const base = outlineHomography(grid, outline)
  const cw = outline.width / grid.cols
  const ch = outline.height / grid.rows
  const cx = outline.x + outline.width / 2
  const cy = outline.y + outline.height / 2
  // Similarity seeds: the outline, moved by up to a cell, scaled 0.6..1.3,
  // turned up to 20 degrees. Rotation happens in pixel space, hence the aspect.
  const offsets = [-1, -0.5, 0, 0.5, 1]
  const scales = [0.6, 0.75, 0.9, 1, 1.15, 1.3]
  const turns = [-20, -10, 0, 10, 20]

  let best: { h: Homography; inliers: number; drift: number } | null = null
  for (const s of scales) {
    for (const t of turns) {
      const cos = Math.cos((t * Math.PI) / 180)
      const sin = Math.sin((t * Math.PI) / 180)
      for (const ou of offsets) {
        for (const ov of offsets) {
          // lattice -> centred, scaled, rotated (in pixel-aspect space) -> frame
          const seed = new Float64Array(9)
          const su = cw * s
          const sv = ch * s
          // x = cx + ox + su*cos*(u - cols/2) - sv*sin*(v - rows/2)/aspect
          // y = cy + oy + su*sin*(u - cols/2)*aspect + sv*cos*(v - rows/2)
          seed[0] = su * cos
          seed[1] = (-sv * sin) / frameAspect
          seed[2] = cx + ou * cw - seed[0] * (grid.cols / 2) - seed[1] * (grid.rows / 2)
          seed[3] = su * sin * frameAspect
          seed[4] = sv * cos
          seed[5] = cy + ov * ch - seed[3] * (grid.cols / 2) - seed[4] * (grid.rows / 2)
          seed[8] = 1
          let h: Homography = seed
          for (const tol of [0.45, 0.35, 0.28]) {
            const m = assign(h, landmarks, grid, tol)
            if (m.length < 3) break
            const next = fitAffine(m)
            if (!next) break
            h = next
          }
          const inliers = assign(h, landmarks, grid, INLIER_TOL).length
          if (inliers < needed) continue
          const centre = project(h, grid.cols / 2, grid.rows / 2)
          const drift = Math.hypot((centre.x - cx) / cw, (centre.y - cy) / ch)
          if (!best || inliers > best.inliers || (inliers === best.inliers && drift < best.drift)) best = { h, inliers, drift }
        }
      }
    }
  }
  if (!best) return null

  // Perspective refinement. A similarity seed can't bend to a tilted box, so
  // the best affine fit can lock on with the rows shifted by one (the far rows
  // are compressed, the near rows match, and a phantom row is hallucinated on
  // the far side). Refine from the affine fit and from each of its one-cell
  // shifts, and keep whichever ends with the most landmarks on the lattice.
  let h = best.h
  let inliers = best.inliers
  let drift = best.drift
  for (const du of [-1, 0, 1]) {
    for (const dv of [-1, 0, 1]) {
      let hs = shifted(best.h, du, dv)
      let count = 0
      for (const tol of [0.45, 0.35, 0.3]) {
        const m = assign(hs, landmarks, grid, tol)
        const refined = fitHomography(m)
        if (!refined) break
        hs = refined
        count = assign(hs, landmarks, grid, INLIER_TOL).length
      }
      if (count === 0) continue
      const centre = project(hs, grid.cols / 2, grid.rows / 2)
      const d = Math.hypot((centre.x - cx) / cw, (centre.y - cy) / ch)
      if (count > inliers || (count === inliers && d < drift)) {
        h = hs
        inliers = count
        drift = d
      }
    }
  }

  // Plausibility: the fit must still be a box near the outline, not a lattice
  // hallucinated through a tablecloth pattern.
  const pitch = pitchAt(h, grid.cols / 2, grid.rows / 2)
  const basePitch = pitchAt(base, grid.cols / 2, grid.rows / 2)
  if (pitch < 0.5 * basePitch || pitch > 1.6 * basePitch || drift > 1.6) return null
  if (inliers < needed || inliers < 0.4 * landmarks.length) return null
  return { homography: h, landmarks: landmarks.length, inliers, pitch }
}

/** The whole thing: frame in, fit out (or null). */
export function findGrid(rgba: Uint8ClampedArray, width: number, height: number, grid: GridSpec, outline: Rect): GridFit | null {
  const small = downscale(rgba, width, height, Math.min(ANALYSIS_WIDTH, width))
  const cellPx = (outline.width * small.width) / grid.cols
  const landmarks = findLandmarks(small.data, small.width, small.height, cellPx)
  return fitLattice(landmarks, grid, outline, width / height)
}

/** Reads one cell through the homography: the cell's inset square in lattice
 * space, sampled bilinearly from the frame into a `size` x `size` RGBA crop. */
export function warpCell(rgba: Uint8ClampedArray, width: number, height: number, h: Homography, row: number, col: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4)
  const span = 1 - 2 * CELL_INSET
  for (let j = 0; j < size; j++) {
    const v = row - 1 + CELL_INSET + ((j + 0.5) / size) * span
    for (let i = 0; i < size; i++) {
      const u = col - 1 + CELL_INSET + ((i + 0.5) / size) * span
      const p = project(h, u, v)
      const x = p.x * width - 0.5
      const y = p.y * height - 0.5
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const o = (j * size + i) * 4
      for (let ch = 0; ch < 3; ch++) {
        const s00 = sample(rgba, width, height, x0, y0, ch)
        const s10 = sample(rgba, width, height, x0 + 1, y0, ch)
        const s01 = sample(rgba, width, height, x0, y0 + 1, ch)
        const s11 = sample(rgba, width, height, x0 + 1, y0 + 1, ch)
        out[o + ch] = (s00 * (1 - fx) + s10 * fx) * (1 - fy) + (s01 * (1 - fx) + s11 * fx) * fy
      }
      out[o + 3] = 255
    }
  }
  return out
}

function sample(rgba: Uint8ClampedArray, width: number, height: number, x: number, y: number, ch: number): number {
  if (x < 0) x = 0
  else if (x >= width) x = width - 1
  if (y < 0) y = 0
  else if (y >= height) y = height - 1
  return rgba[(y * width + x) * 4 + ch]
}

/** Normalised frame rectangle around a cell, for the UI. */
export function cellBounds(h: Homography, row: number, col: number): Rect {
  const corners = [project(h, col - 1, row - 1), project(h, col, row - 1), project(h, col, row), project(h, col - 1, row)]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
