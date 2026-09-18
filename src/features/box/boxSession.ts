// A box session is the in-progress state of one box being assembled at the counter.
// Every input method (tap, camera, ...) goes through addPiece, so the count check,
// save, and export logic never need to know where a piece came from.

import type { BoxRecord, BoxSession, BoxSize, FlavorId, Piece, PieceSource } from '../../domain/types.ts'
import { newId } from '../../app/id.ts'
import { loadLocationId } from '../sync/location.ts'

export function startSession(size: BoxSize, now = Date.now()): BoxSession {
  return { id: newId(), size, pieces: [], startedAt: now, undoCount: 0 }
}

/** Adds a piece. Ignored once the box is full, so a stray extra tap can't overfill it.
 * `cell` is the insert slot a camera piece was read from (see Piece). */
export function addPiece(
  session: BoxSession,
  flavorId: FlavorId,
  source: PieceSource = 'tap',
  confidence?: number,
  now = Date.now(),
  cell?: Piece['cell'],
): BoxSession {
  if (session.pieces.length >= session.size) return session
  return {
    ...session,
    pieces: [
      ...session.pieces,
      { flavorId, source, addedAt: now, ...(confidence !== undefined ? { confidence } : {}), ...(cell ? { cell } : {}) },
    ],
  }
}

/** The insert slots already holding a camera-read piece, as "row:col" keys. */
export function filledCells(session: BoxSession): Set<string> {
  return new Set(session.pieces.flatMap((p) => (p.cell ? [cellKey(p.cell)] : [])))
}

export function cellKey(cell: NonNullable<Piece['cell']>): string {
  return `${cell.row}:${cell.col}`
}

export function undoLast(session: BoxSession): BoxSession {
  if (session.pieces.length === 0) return session
  return { ...session, pieces: session.pieces.slice(0, -1), undoCount: session.undoCount + 1 }
}

/** Removes one piece of a specific flavor (the most recently added one of that
 * flavor), not just whatever was tapped last overall. Lets the cashier fix a
 * mistake a few taps back without undoing everything after it too. */
export function removeOne(session: BoxSession, flavorId: FlavorId): BoxSession {
  const index = session.pieces.map((p) => p.flavorId).lastIndexOf(flavorId)
  if (index === -1) return session
  return {
    ...session,
    pieces: [...session.pieces.slice(0, index), ...session.pieces.slice(index + 1)],
    undoCount: session.undoCount + 1,
  }
}

export function isComplete(session: BoxSession): boolean {
  return session.pieces.length === session.size
}

export function remaining(session: BoxSession): number {
  return session.size - session.pieces.length
}

export interface FlavorTally {
  flavorId: FlavorId
  count: number
}

/** Collapses the session's pieces into per-flavor counts, in the order each
 * flavor was first tapped. Used for both the live running tally in the UI and
 * the saved record, so what the cashier sees while assembling is exactly what
 * gets saved. */
export function tally(session: BoxSession): FlavorTally[] {
  const counts = new Map<FlavorId, number>()
  for (const piece of session.pieces) {
    counts.set(piece.flavorId, (counts.get(piece.flavorId) ?? 0) + 1)
  }
  return [...counts.entries()].map(([flavorId, count]) => ({ flavorId, count }))
}

/** Turns a complete session into a saved record. Throws on an incomplete box: the
 * UI must gate the save button on isComplete() so this should never fire from a
 * real tap. */
/** `locationId` defaults to whatever this tablet was set to on the Records
 * screen. It is a parameter so tests can pin it, and so a caller that knows
 * better can override it. */
export function toRecord(
  session: BoxSession,
  now = Date.now(),
  locationId: string | undefined = loadLocationId(),
): BoxRecord {
  if (!isComplete(session)) {
    throw new Error(`Cannot save box ${session.id}: has ${session.pieces.length} of ${session.size} pieces`)
  }

  const method = session.pieces.some((p) => p.source === 'camera') ? 'camera-assisted' : 'tap'

  return {
    id: newId(),
    size: session.size,
    pieces: tally(session),
    startedAt: new Date(session.startedAt).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationMs: now - session.startedAt,
    undoCount: session.undoCount,
    method,
    demo: false,
    ...(locationId ? { locationId } : {}),
  }
}
