import { describe, expect, it } from 'vitest'
import { topCombos, topFlavors } from './stats.ts'
import type { BoxRecord } from '../../domain/types.ts'

function box(id: string, pieces: BoxRecord['pieces']): BoxRecord {
  return {
    id,
    size: 6,
    pieces,
    startedAt: '2026-09-14T00:00:00.000Z',
    completedAt: '2026-09-14T00:00:10.000Z',
    durationMs: 10_000,
    undoCount: 0,
    method: 'tap',
    demo: false,
  }
}

describe('topFlavors', () => {
  it('sums piece counts across boxes and sorts descending', () => {
    const records = [
      box('a', [{ flavorId: 'amaretto', count: 3 }]),
      box('b', [
        { flavorId: 'amaretto', count: 1 },
        { flavorId: 'raspberry', count: 5 },
      ]),
    ]
    expect(topFlavors(records)).toEqual([
      { flavorId: 'raspberry', count: 5 },
      { flavorId: 'amaretto', count: 4 },
    ])
  })

  it('returns an empty list for no records', () => {
    expect(topFlavors([])).toEqual([])
  })
})

describe('topCombos', () => {
  it('counts repeated flavor sets regardless of piece counts or order', () => {
    const records = [
      box('a', [
        { flavorId: 'amaretto', count: 2 },
        { flavorId: 'raspberry', count: 4 },
      ]),
      box('b', [
        { flavorId: 'raspberry', count: 1 },
        { flavorId: 'amaretto', count: 1 },
      ]),
      box('c', [{ flavorId: 'amaretto', count: 6 }]),
    ]
    const combos = topCombos(records)
    expect(combos).toEqual([{ flavorIds: ['amaretto', 'raspberry'], count: 2 }])
  })

  it('ignores single-flavor boxes as not being a combination', () => {
    const records = [box('a', [{ flavorId: 'amaretto', count: 6 }])]
    expect(topCombos(records)).toEqual([])
  })
})
