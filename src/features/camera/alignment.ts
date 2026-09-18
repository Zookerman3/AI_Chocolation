// Live alignment: turns the stream of grid fits from the preview into
// "searching / aligning / locked", so the tablet can take the photo itself once
// the box has been found, sits near the outline, and has held still for a
// moment. Pure: no DOM, no timers — the loop lives in useAutoCapture.ts.
//
// Units are cells, the same yardstick fitLattice uses for its own plausibility
// gate, so "near" and "still" mean the same thing whatever the box size.

import { project } from './gridFinder.ts'
import type { GridFit } from './gridFinder.ts'
import type { GridSpec, Rect } from './grid.ts'

export type AlignmentPhase = 'searching' | 'aligning' | 'locked'

export interface Point {
  x: number
  y: number
}

export interface AlignmentReading {
  phase: AlignmentPhase
  /** The fitted lattice's four corners in normalised frame coordinates, or
   * null while nothing has been found. */
  corners: Point[] | null
  /** Consecutive steady readings so far; 0 while searching or just after a move. */
  stableTicks: number
  /** Steady readings needed before it counts as locked. */
  stableTicksNeeded: number
}

export interface AlignmentOptions {
  /** Consecutive steady readings before the box counts as lined up. */
  stableTicksNeeded?: number
  /** How far the fitted centre may sit from the outline centre, in cells. */
  maxDrift?: number
  /** How far the corners may move between two readings, in cells. */
  maxMove?: number
}

export class AlignmentTracker {
  private stable = 0
  private prev: Point[] | null = null
  private readonly needed: number
  private readonly maxDrift: number
  private readonly maxMove: number
  private readonly cellW: number
  private readonly cellH: number
  private readonly centre: Point

  constructor(
    private readonly grid: GridSpec,
    outline: Rect,
    options: AlignmentOptions = {},
  ) {
    this.needed = options.stableTicksNeeded ?? 3
    this.maxDrift = options.maxDrift ?? 0.6
    this.maxMove = options.maxMove ?? 0.15
    this.cellW = outline.width / grid.cols
    this.cellH = outline.height / grid.rows
    this.centre = { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 }
  }

  /** One reading per analysed frame. */
  push(fit: GridFit | null): AlignmentReading {
    if (!fit) {
      this.stable = 0
      this.prev = null
      return this.reading('searching', null)
    }
    const corners = cornersOf(fit, this.grid)
    const centre = project(fit.homography, this.grid.cols / 2, this.grid.rows / 2)
    const drift = Math.hypot((centre.x - this.centre.x) / this.cellW, (centre.y - this.centre.y) / this.cellH)
    const moved = this.prev ? meanMove(corners, this.prev, this.cellW, this.cellH) : 0
    this.prev = corners

    if (drift > this.maxDrift || moved > this.maxMove) {
      this.stable = 0
      return this.reading('aligning', corners)
    }
    this.stable = Math.min(this.needed, this.stable + 1)
    return this.reading(this.stable >= this.needed ? 'locked' : 'aligning', corners)
  }

  /** Forget the run-up, e.g. after a photo has been taken and the cashier asks
   * for another. */
  reset(): void {
    this.stable = 0
    this.prev = null
  }

  private reading(phase: AlignmentPhase, corners: Point[] | null): AlignmentReading {
    return { phase, corners, stableTicks: this.stable, stableTicksNeeded: this.needed }
  }
}

/** The lattice's outer corners, clockwise from top-left, in frame coordinates. */
export function cornersOf(fit: GridFit, grid: GridSpec): Point[] {
  const h = fit.homography
  return [project(h, 0, 0), project(h, grid.cols, 0), project(h, grid.cols, grid.rows), project(h, 0, grid.rows)]
}

function meanMove(a: Point[], b: Point[], cellW: number, cellH: number): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.hypot((a[i].x - b[i].x) / cellW, (a[i].y - b[i].y) / cellH)
  }
  return sum / a.length
}
