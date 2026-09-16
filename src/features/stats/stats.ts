// Stretch goal: a view across many boxes for whoever plans production and flavors.

import type { BoxRecord, BoxSize, FlavorId } from '../../domain/types.ts'
import { BOX_SIZES } from '../../domain/types.ts'

/** How long boxes of one size actually take, in whole seconds. */
export interface SizeDuration {
  size: BoxSize
  /** How many saved boxes of this size the numbers come from. */
  count: number
  /** Null when no box of this size has been saved yet. */
  medianSeconds: number | null
  fastestSeconds: number | null
  slowestSeconds: number | null
}

/** Seconds per box, by box size.
 *
 * This is the number the prompt actually asks about — whether the tablet is faster than
 * the paper tally — so it gets the median rather than the mean: one box abandoned
 * mid-rush and finished ten minutes later would drag a mean somewhere useless. The
 * range and n are reported alongside so a median over two boxes can't read as a result.
 * Every size is returned, including sizes with no boxes yet, so the row doesn't reflow
 * as data comes in. */
export function secondsPerBox(records: readonly BoxRecord[]): SizeDuration[] {
  return BOX_SIZES.map((size) => {
    const seconds = records
      .filter((r) => r.size === size)
      .map((r) => r.durationMs / 1000)
      .sort((a, b) => a - b)
    const n = seconds.length
    if (n === 0) return { size, count: 0, medianSeconds: null, fastestSeconds: null, slowestSeconds: null }
    const median = n % 2 ? seconds[(n - 1) / 2] : (seconds[n / 2 - 1] + seconds[n / 2]) / 2
    return {
      size,
      count: n,
      medianSeconds: Math.round(median),
      fastestSeconds: Math.round(seconds[0]),
      slowestSeconds: Math.round(seconds[n - 1]),
    }
  })
}


export interface FlavorCount {
  flavorId: FlavorId
  count: number
}

export interface ComboCount {
  flavorIds: FlavorId[]
  count: number
}

export function topFlavors(records: readonly BoxRecord[], limit = 10): FlavorCount[] {
  const counts = new Map<FlavorId, number>()
  for (const record of records) {
    for (const piece of record.pieces) {
      counts.set(piece.flavorId, (counts.get(piece.flavorId) ?? 0) + piece.count)
    }
  }
  return [...counts.entries()]
    .map(([flavorId, count]) => ({ flavorId, count }))
    .sort((a, b) => b.count - a.count || a.flavorId.localeCompare(b.flavorId))
    .slice(0, limit)
}

/** A "combination" is the distinct set of flavors in a box, order-independent. Boxes
 * that repeat the exact same set (e.g. always Amaretto + Raspberry, whatever the
 * counts) count toward the same combo. */
export function topCombos(records: readonly BoxRecord[], limit = 10): ComboCount[] {
  const counts = new Map<string, { flavorIds: FlavorId[]; count: number }>()
  for (const record of records) {
    const flavorIds = [...new Set(record.pieces.map((p) => p.flavorId))].sort()
    if (flavorIds.length < 2) continue // a single-flavor box isn't a "combination"
    const key = flavorIds.join('|')
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { flavorIds, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}
