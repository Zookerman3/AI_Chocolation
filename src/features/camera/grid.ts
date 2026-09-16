// Where the cells are. The insert is a fixed grid, so the camera never has to
// learn what a chocolate looks like in order to find one: the cashier gets the
// box roughly inside an outline on screen, gridFinder.ts snaps a rows x cols
// lattice to the pieces it can see, and every slot — full or empty — is
// arithmetic from there. That is the difference between this and the
// object-detection approach: no bounding boxes to learn, and a half-empty box
// is no harder than a full one. This file is the arithmetic; the outline it
// describes is also the fallback when no lattice can be found.

import type { BoxSize } from '../../domain/types.ts'

export interface GridSpec {
  rows: number
  cols: number
}

/** Insert layouts per box size. The 30 was measured from the training photos
 * (5 rows of 6). The 16 is the known 4x4 insert. 6 and 10 are assumed 2 rows;
 * if the real inserts are 3x2 / 5x2, swap the numbers here and nothing else
 * changes. 50 has no insert we've seen, so the camera stays off for it. */
export const GRID_BY_SIZE: Partial<Record<BoxSize, GridSpec>> = {
  6: { rows: 2, cols: 3 },
  10: { rows: 2, cols: 5 },
  16: { rows: 4, cols: 4 },
  30: { rows: 5, cols: 6 },
}

export function gridFor(size: BoxSize): GridSpec | null {
  return GRID_BY_SIZE[size] ?? null
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** How much of the shorter frame dimension the outline may use. */
const OUTLINE_FILL = 0.88
/** Trimmed from each edge of a cell before it's read, to drop the divider walls. */
export const CELL_INSET = 0.06

/** The outline rectangle for a grid inside a frame of the given pixel size,
 * centred, with square cells, in normalised (0..1) frame coordinates. The same
 * function drives the overlay on the live preview and the crop on the captured
 * frame, so what the cashier lines up with is exactly what gets read. */
export function outlineRect(grid: GridSpec, frameWidth: number, frameHeight: number): Rect {
  const cell = Math.min((OUTLINE_FILL * frameWidth) / grid.cols, (OUTLINE_FILL * frameHeight) / grid.rows)
  const w = cell * grid.cols
  const h = cell * grid.rows
  return {
    x: (frameWidth - w) / 2 / frameWidth,
    y: (frameHeight - h) / 2 / frameHeight,
    width: w / frameWidth,
    height: h / frameHeight,
  }
}

export interface Cell {
  row: number
  col: number
  /** Normalised frame coordinates of the whole cell (what the UI draws). */
  box: Rect
  /** Normalised frame coordinates of the part that gets read (inset from the walls). */
  read: Rect
}

/** Reading order matches the training labels: left to right, then top to bottom. */
export function cells(grid: GridSpec, outline: Rect): Cell[] {
  const cw = outline.width / grid.cols
  const ch = outline.height / grid.rows
  const out: Cell[] = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const box = { x: outline.x + c * cw, y: outline.y + r * ch, width: cw, height: ch }
      out.push({
        row: r + 1,
        col: c + 1,
        box,
        read: {
          x: box.x + cw * CELL_INSET,
          y: box.y + ch * CELL_INSET,
          width: cw * (1 - 2 * CELL_INSET),
          height: ch * (1 - 2 * CELL_INSET),
        },
      })
    }
  }
  return out
}
