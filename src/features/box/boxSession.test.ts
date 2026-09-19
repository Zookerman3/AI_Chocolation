import { describe, expect, it } from 'vitest'
import { addPiece, isComplete, remaining, removeOne, startSession, tally, toRecord, undoLast } from './boxSession.ts'

describe('boxSession', () => {
  it('starts empty', () => {
    const session = startSession(6, 1000)
    expect(session.size).toBe(6)
    expect(session.pieces).toHaveLength(0)
    expect(session.startedAt).toBe(1000)
    expect(isComplete(session)).toBe(false)
    expect(remaining(session)).toBe(6)
  })

  it('adds pieces up to the box size and ignores extras', () => {
    let session = startSession(6, 1000)
    for (let i = 0; i < 6; i++) {
      session = addPiece(session, 'amaretto', 'tap', undefined, 1000 + i)
    }
    expect(isComplete(session)).toBe(true)

    const overfilled = addPiece(session, 'raspberry', 'tap', undefined, 2000)
    expect(overfilled.pieces).toHaveLength(6)
  })

  it('undo removes the last piece and tracks how many times it was used', () => {
    let session = startSession(6, 1000)
    session = addPiece(session, 'amaretto')
    session = addPiece(session, 'raspberry')
    session = undoLast(session)
    expect(session.pieces.map((p) => p.flavorId)).toEqual(['amaretto'])
    expect(session.undoCount).toBe(1)

    // undo on an empty session is a no-op, not an error
    let empty = startSession(6, 1000)
    empty = undoLast(empty)
    expect(empty.undoCount).toBe(0)
  })

  it('refuses to save an incomplete box', () => {
    const session = startSession(6, 1000)
    expect(() => toRecord(session)).toThrow()
  })

  it('collapses pieces into per-flavor counts and records timing', () => {
    let session = startSession(6, 1000)
    for (let i = 0; i < 4; i++) session = addPiece(session, 'amaretto', 'tap', undefined, 1100 + i)
    for (let i = 0; i < 2; i++) session = addPiece(session, 'raspberry', 'tap', undefined, 1200 + i)

    const record = toRecord(session, 5000)
    expect(record.size).toBe(6)
    expect(record.durationMs).toBe(4000)
    expect(record.method).toBe('tap')
    expect(record.demo).toBe(false)
    expect(record.pieces).toEqual(
      expect.arrayContaining([
        { flavorId: 'amaretto', count: 4 },
        { flavorId: 'raspberry', count: 2 },
      ]),
    )
  })

  it('marks a box camera-assisted if any piece came from the camera', () => {
    let session = startSession(6, 1000)
    for (let i = 0; i < 5; i++) session = addPiece(session, 'amaretto', 'tap')
    session = addPiece(session, 'raspberry', 'camera', 0.92)
    const record = toRecord(session)
    expect(record.method).toBe('camera-assisted')
  })

  it('tally reflects live counts in first-seen order, matching the saved record', () => {
    let session = startSession(6, 1000)
    session = addPiece(session, 'raspberry')
    session = addPiece(session, 'amaretto')
    session = addPiece(session, 'raspberry')
    expect(tally(session)).toEqual([
      { flavorId: 'raspberry', count: 2 },
      { flavorId: 'amaretto', count: 1 },
    ])
  })

  it('tally lists camera-read flavors in box order, even one confirmed late from the review list', () => {
    // The camera auto-added slots 1 and 3 of a row, and slot 2 came back as "please
    // confirm". The cashier confirms it last, so it is the last piece added — but the
    // check list must still read like the box: slot 1, slot 2, slot 3.
    let session = startSession(6, 1000)
    session = addPiece(session, 'raspberry', 'camera', 0.95, 1000, { row: 1, col: 1 })
    session = addPiece(session, 'turtle', 'camera', 0.91, 1000, { row: 1, col: 3 })
    session = addPiece(session, 'amaretto', 'camera', 0.62, 1000, { row: 1, col: 2 })
    expect(tally(session).map((t) => t.flavorId)).toEqual(['raspberry', 'amaretto', 'turtle'])
  })

  it('tally orders slots row by row, and a flavor sits at its earliest slot', () => {
    let session = startSession(10, 1000)
    session = addPiece(session, 'turtle', 'camera', 0.9, 1000, { row: 2, col: 1 })
    session = addPiece(session, 'lemon', 'camera', 0.9, 1000, { row: 1, col: 5 })
    session = addPiece(session, 'turtle', 'camera', 0.9, 1000, { row: 1, col: 2 })
    expect(tally(session)).toEqual([
      { flavorId: 'turtle', count: 2 }, // earliest slot is row 1 col 2
      { flavorId: 'lemon', count: 1 },
    ])
  })

  it('tally puts tapped flavors after camera-read ones, in first-tap order', () => {
    let session = startSession(6, 1000)
    session = addPiece(session, 'lemon') // tapped first, before the photo
    session = addPiece(session, 'turtle', 'camera', 0.9, 1000, { row: 1, col: 2 })
    session = addPiece(session, 'pistachio') // tapped to fill the last slot
    session = addPiece(session, 'amaretto', 'camera', 0.9, 1000, { row: 1, col: 1 })
    expect(tally(session).map((t) => t.flavorId)).toEqual(['amaretto', 'turtle', 'lemon', 'pistachio'])
  })

  it('removeOne removes a single piece of the given flavor, not the last tap overall', () => {
    let session = startSession(6, 1000)
    session = addPiece(session, 'amaretto')
    session = addPiece(session, 'raspberry')
    session = addPiece(session, 'amaretto')

    session = removeOne(session, 'amaretto')
    expect(tally(session)).toEqual(
      expect.arrayContaining([
        { flavorId: 'amaretto', count: 1 },
        { flavorId: 'raspberry', count: 1 },
      ]),
    )
    expect(session.undoCount).toBe(1)

    // removing a flavor that isn't in the box is a no-op, not an error
    const before = session
    session = removeOne(session, 'turtle')
    expect(session).toBe(before)
  })
})
