import { describe, expect, it } from 'vitest'
import { applyDetections, confirmDetection } from './applyDetections.ts'
import { addPiece, startSession } from '../box/boxSession.ts'
import type { Detection } from './types.ts'
import { FLAVORS } from '../../data/flavors.ts'

const [a, b] = FLAVORS

function detection(overrides: Partial<Detection>): Detection {
  return {
    flavorId: a.id,
    confidence: 0.9,
    box: { x: 0, y: 0, width: 0.1, height: 0.1 },
    rawClass: a.id,
    ...overrides,
  }
}

describe('applyDetections', () => {
  it('auto-adds detections that clear the confidence bar and have a mapped flavor', () => {
    const session = startSession(6, 1000)
    const { session: next, needsReview, overflowed } = applyDetections(session, [
      detection({ flavorId: a.id, confidence: 0.95 }),
      detection({ flavorId: b.id, confidence: 0.82 }),
    ])
    expect(next.pieces.map((p) => p.flavorId)).toEqual([a.id, b.id])
    expect(next.pieces.every((p) => p.source === 'camera')).toBe(true)
    expect(needsReview).toEqual([])
    expect(overflowed).toEqual([])
  })

  it('sends low-confidence and unmapped detections to review instead of adding them', () => {
    const session = startSession(6, 1000)
    const low = detection({ flavorId: a.id, confidence: 0.5 })
    const unmapped = detection({ flavorId: null, confidence: 0.99, rawClass: 'something-unlabeled' })
    const { session: next, needsReview } = applyDetections(session, [low, unmapped])
    expect(next.pieces).toHaveLength(0)
    expect(needsReview).toEqual([low, unmapped])
  })

  it('respects a custom confidence threshold', () => {
    const session = startSession(6, 1000)
    const { needsReview } = applyDetections(session, [detection({ confidence: 0.6 })], 0.5)
    expect(needsReview).toEqual([])
  })

  it('marks high-confidence detections that would overfill the box as overflowed, not silently dropped', () => {
    let session = startSession(6, 1000)
    for (let i = 0; i < 5; i++) session = addPiece(session, a.id) // 5/6, room for exactly one more
    const first = detection({ flavorId: a.id, confidence: 0.9 })
    const second = detection({ flavorId: b.id, confidence: 0.9 })
    const { session: next, overflowed } = applyDetections(session, [first, second])
    expect(next.pieces).toHaveLength(6)
    expect(overflowed).toEqual([second])
  })
})

describe('confirmDetection', () => {
  it('keeps the detection confidence when the cashier accepts the suggested flavor', () => {
    const session = startSession(6, 1000)
    const guess = detection({ flavorId: a.id, confidence: 0.55 })
    const next = confirmDetection(session, guess, a.id)
    expect(next.pieces[0]).toMatchObject({ flavorId: a.id, source: 'camera', confidence: 0.55 })
  })

  it('drops the confidence when the cashier corrects to a different flavor', () => {
    const session = startSession(6, 1000)
    const guess = detection({ flavorId: a.id, confidence: 0.55 })
    const next = confirmDetection(session, guess, b.id)
    expect(next.pieces[0]).toMatchObject({ flavorId: b.id, source: 'camera' })
    expect(next.pieces[0].confidence).toBeUndefined()
  })
})
