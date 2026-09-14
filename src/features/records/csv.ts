// One row per flavor within a box (long format), so the production/flavor-planning
// side of the shop can pivot by flavor directly instead of parsing a nested column.

import type { BoxRecord } from '../../domain/types.ts'
import { getFlavor } from '../../data/flavors.ts'

const HEADERS = [
  'box_id',
  'box_size',
  'method',
  'demo',
  'started_at',
  'completed_at',
  'duration_ms',
  'undo_count',
  'flavor_id',
  'flavor_name',
  'piece_count',
] as const

function csvField(value: string | number | boolean): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(records: readonly BoxRecord[]): string {
  const rows = records.flatMap((record) =>
    record.pieces.map((piece) =>
      [
        record.id,
        record.size,
        record.method,
        record.demo,
        record.startedAt,
        record.completedAt,
        record.durationMs,
        record.undoCount,
        piece.flavorId,
        getFlavor(piece.flavorId).name,
        piece.count,
      ].map(csvField),
    ),
  )
  return [HEADERS.join(','), ...rows.map((row) => row.join(','))].join('\n') + '\n'
}

export function toJSON(records: readonly BoxRecord[]): string {
  return JSON.stringify(records, null, 2) + '\n'
}
