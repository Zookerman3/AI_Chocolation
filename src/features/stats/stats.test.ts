import { describe, expect, it } from 'vitest'
import { secondsPerBox, topCombos, topFlavors } from './stats.ts'
import type { BoxRecord, BoxSize } from '../../domain/types.ts'

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

function timedBox(id: string, size: BoxSize, seconds: number): BoxRecord {
  return {
    ...box(id, [{ flavorId: 'amaretto', count: 1 }]),
    size,
    durationMs: seconds * 1000,
  }
}

describe('secondsPerBox', () => {
  it('reports every box size, including sizes with nothing saved yet', () => {
    const rows = secondsPerBox([timedBox('a', 16, 30)])
    expect(rows.map((r) => r.size)).toEqual([6, 10, 16, 30, 50])

    const six = rows.find((r) => r.size === 6)!
    expect(six).toEqual({ size: 6, count: 0, medianSeconds: null, fastestSeconds: null, slowestSeconds: null })
  })

  it('takes the median, not the mean, so one abandoned box cannot skew the number', () => {
    // four quick boxes and one left open for ten minutes
    const rows = secondsPerBox([
      timedBox('a', 16, 22),
      timedBox('b', 16, 24),
      timedBox('c', 16, 26),
      timedBox('d', 16, 28),
      timedBox('e', 16, 600),
    ])
    const sixteen = rows.find((r) => r.size === 16)!
    expect(sixteen.medianSeconds).toBe(26) // mean would be 140
    expect(sixteen.count).toBe(5)
    expect(sixteen.fastestSeconds).toBe(22)
    expect(sixteen.slowestSeconds).toBe(600)
  })

  it('averages the middle pair when the count is even', () => {
    const rows = secondsPerBox([timedBox('a', 10, 20), timedBox('b', 10, 25)])
    expect(rows.find((r) => r.size === 10)!.medianSeconds).toBe(23) // 22.5, rounded
  })

  it('keeps each size separate, since a 50-piece box is not a 6-piece box', () => {
    const rows = secondsPerBox([timedBox('a', 6, 10), timedBox('b', 50, 120)])
    expect(rows.find((r) => r.size === 6)!.medianSeconds).toBe(10)
    expect(rows.find((r) => r.size === 50)!.medianSeconds).toBe(120)
  })
})
