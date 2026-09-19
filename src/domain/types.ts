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

/** The sizes the counter offers. 50 was taken off the picker on Sep 18 — it has
 * no measured insert, so no camera path, and the team chose not to offer it at
 * the counter. It stays in BOX_SIZES so records that already exist, the API's
 * validation and the dashboard keep accepting it. */
export const OFFERED_SIZES: readonly BoxSize[] = [6, 10, 16, 30]

/** Every input method feeds the same box. The camera never bypasses the session. */
export type PieceSource = 'tap' | 'camera'

export interface Piece {
  flavorId: FlavorId
  source: PieceSource
  /** Epoch milliseconds. */
  addedAt: number
  /** Camera only: match confidence from 0 to 1. */
  confidence?: number
  /** Camera only: the insert slot (1-based row and column) the piece was read
   * from, so a second photo of the same box does not count it again. Never on
   * a tapped piece, and never saved — tally() collapses it away. */
  cell?: { row: number; col: number }
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
  /** Which shop this tablet stands in. Set once per device on the Records
   * screen; absent on records saved before a location was chosen, and on any
   * tablet where nobody set one. The dashboard hides its location filter
   * entirely when no record carries this, rather than offering a filter that
   * matches nothing. */
  locationId?: string
  /** Stamped by the API (api/_lib/record.ts) when it first accepted the record.
   * Never set on the device; present on records read back from /api/boxes, so
   * the dashboard can tell "new to the server" from "old box synced late". */
  receivedAt?: string
}

/** The display case as a grid, row by row. `null` is an empty plate. */
export interface CaseLayout {
  rows: number
  cols: number
  /** Length is rows * cols. */
  cells: (FlavorId | null)[]
}
