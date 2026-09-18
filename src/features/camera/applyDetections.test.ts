import { describe, expect, it } from 'vitest'
import { applyDetections, confirmDetection } from './applyDetections.ts'
import { addPiece, startSession, undoLast } from '../box/boxSession.ts'
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

  describe('a second photo of the same box', () => {
    const slot11 = detection({ flavorId: a.id, cell: { row: 1, col: 1 } })
    const slot12 = detection({ flavorId: a.id, cell: { row: 1, col: 2 } })
    const slot21 = detection({ flavorId: b.id, cell: { row: 2, col: 1 } })

    it('two of the same flavor in two slots are two pieces', () => {
      const { session: next } = applyDetections(startSession(6, 1000), [slot11, slot12])
      expect(next.pieces.map((p) => p.flavorId)).toEqual([a.id, a.id])
      expect(next.pieces.map((p) => p.cell)).toEqual([{ row: 1, col: 1 }, { row: 1, col: 2 }])
    })

    it('adds nothing when it shows the same slots again', () => {
      const first = applyDetections(startSession(6, 1000), [slot11, slot12])
      const second = applyDetections(first.session, [slot11, slot12])
      expect(second.session).toBe(first.session)
      expect(second.alreadyCounted).toEqual([slot11, slot12])
      expect(second.needsReview).toEqual([])
    })

    it('adds only the slot that was empty the first time', () => {
      const first = applyDetections(startSession(6, 1000), [slot11])
      const second = applyDetections(first.session, [slot11, slot21])
      expect(second.session.pieces.map((p) => p.flavorId)).toEqual([a.id, b.id])
      expect(second.alreadyCounted).toEqual([slot11])
    })

    it('does not put an already-counted slot up for review even if it reads unsure this time', () => {
      const first = applyDetections(startSession(6, 1000), [slot11])
      const unsure = detection({ flavorId: a.id, confidence: 0.4, cell: { row: 1, col: 1 } })
      const second = applyDetections(first.session, [unsure])
      expect(second.needsReview).toEqual([])
      expect(second.alreadyCounted).toEqual([unsure])
    })

    it('frees the slot again when its piece is undone', () => {
      const first = applyDetections(startSession(6, 1000), [slot11])
      const undone = undoLast(first.session)
      const again = applyDetections(undone, [slot11])
      expect(again.session.pieces).toHaveLength(1)
      expect(again.alreadyCounted).toEqual([])
    })

    it('ignores tapped pieces, which have no slot', () => {
      const tapped = addPiece(startSession(6, 1000), a.id)
      const { session: next, alreadyCounted } = applyDetections(tapped, [slot11])
      expect(next.pieces).toHaveLength(2)
      expect(alreadyCounted).toEqual([])
    })

    it('cannot guard a detector that reports no slots, so those add every time', () => {
      const noSlot = detection({ flavorId: a.id })
      const first = applyDetections(startSession(6, 1000), [noSlot])
      const second = applyDetections(first.session, [noSlot])
      expect(second.session.pieces).toHaveLength(2)
    })
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

  it('remembers the slot, and is a no-op for a slot a later photo already filled', () => {
    const guess = detection({ flavorId: a.id, confidence: 0.55, cell: { row: 2, col: 3 } })
    const confirmed = confirmDetection(startSession(6, 1000), guess, a.id)
    expect(confirmed.pieces[0].cell).toEqual({ row: 2, col: 3 })

    // A second photo read that slot confidently before the cashier got to the row.
    const filled = applyDetections(startSession(6, 1000), [detection({ flavorId: b.id, cell: { row: 2, col: 3 } })]).session
    expect(confirmDetection(filled, guess, a.id)).toBe(filled)
  })
})
