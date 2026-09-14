// Shared contracts for every area of the app. Change only in a PR that explains why.

/** Slug of the product title, e.g. "Crème Brulée" -> "creme-brulee". Never the store handle. */
export type FlavorId = string

export type ChocolateType = 'dark' | 'milk' | 'white' | 'gold'

export interface Flavor {
  id: FlavorId
  /** Product title from the store, e.g. "Grey Salt Caramel". */
  name: string
  imageUrl: string
  chocolate: ChocolateType | null
  /** From store tags, e.g. ["milk", "soy", "nut"]. */
  allergens: string[]
  seasonal: boolean
  /** Public product page this came from. */
  sourceUrl: string
}

export const BOX_SIZES = [6, 10, 16, 30, 50] as const
export type BoxSize = (typeof BOX_SIZES)[number]

/** Every input method feeds the same box. The camera never bypasses the session. */
export type PieceSource = 'tap' | 'camera'

export interface Piece {
  flavorId: FlavorId
  source: PieceSource
  /** Epoch milliseconds. */
  addedAt: number
  /** Camera only: match confidence from 0 to 1. */
  confidence?: number
}

/** A box being assembled right now. */
export interface BoxSession {
  id: string
  size: BoxSize
  pieces: Piece[]
  /** Epoch milliseconds when the cashier chose the box size. */
  startedAt: number
  undoCount: number
}

/** One saved box: which pieces, how many, and how long it took. */
export interface BoxRecord {
  id: string
  size: BoxSize
  /** One entry per flavor in the box. Counts add up to `size`. */
  pieces: { flavorId: FlavorId; count: number }[]
  /** ISO 8601 timestamps. */
  startedAt: string
  completedAt: string
  durationMs: number
  undoCount: number
  /** "camera-assisted" when any piece came from the camera. */
  method: 'tap' | 'camera-assisted'
  /** True for generated sample data shown in demo mode. */
  demo: boolean
}

/** The display case as a grid, row by row. `null` is an empty plate. */
export interface CaseLayout {
  rows: number
  cols: number
  /** Length is rows * cols. */
  cells: (FlavorId | null)[]
}
