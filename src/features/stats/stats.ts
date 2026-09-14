// Stretch goal: a view across many boxes for whoever plans production and flavors.

import type { BoxRecord, FlavorId } from '../../domain/types.ts'

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
