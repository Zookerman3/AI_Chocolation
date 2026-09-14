import { describe, expect, it } from 'vitest'
import { toCSV, toJSON } from './csv.ts'
import type { BoxRecord } from '../../domain/types.ts'

const record: BoxRecord = {
  id: 'r1',
  size: 6,
  pieces: [
    { flavorId: 'amaretto', count: 4 },
    { flavorId: 'raspberry', count: 2 },
  ],
  startedAt: '2026-09-14T10:00:00.000Z',
  completedAt: '2026-09-14T10:00:07.000Z',
  durationMs: 7000,
  undoCount: 1,
  method: 'tap',
  demo: false,
}

describe('toCSV', () => {
  it('emits a header row even with no records', () => {
    expect(toCSV([])).toBe(
      'box_id,box_size,method,demo,started_at,completed_at,duration_ms,undo_count,flavor_id,flavor_name,piece_count\n',
    )
  })

  it('emits one row per flavor in a box, resolving names from the catalog', () => {
    const csv = toCSV([record])
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 flavors
    expect(lines[1]).toBe('r1,6,tap,false,2026-09-14T10:00:00.000Z,2026-09-14T10:00:07.000Z,7000,1,amaretto,Amaretto,4')
    expect(lines[2]).toContain('raspberry,Raspberry,2')
  })
})

describe('toJSON', () => {
  it('round-trips the records exactly', () => {
    const json = toJSON([record])
    expect(JSON.parse(json)).toEqual([record])
  })
})
