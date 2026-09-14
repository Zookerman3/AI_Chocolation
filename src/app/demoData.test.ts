import { describe, expect, it } from 'vitest'
import { generateDemoRecords } from './demoData.ts'
import { getFlavor } from '../data/flavors.ts'

describe('generateDemoRecords', () => {
  it('produces records whose piece counts add up to the box size', () => {
    const records = generateDemoRecords(30)
    expect(records).toHaveLength(30)
    for (const record of records) {
      const total = record.pieces.reduce((sum, p) => sum + p.count, 0)
      expect(total).toBe(record.size)
      expect(record.demo).toBe(true)
      for (const piece of record.pieces) {
        expect(() => getFlavor(piece.flavorId)).not.toThrow()
      }
    }
  })

  it('is deterministic across calls', () => {
    const now = Date.now()
    expect(generateDemoRecords(10, now)).toEqual(generateDemoRecords(10, now))
  })
})
