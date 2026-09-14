// A box session is the in-progress state of one box being assembled at the counter.
// Every input method (tap, camera, ...) goes through addPiece, so the count check,
// save, and export logic never need to know where a piece came from.

import type { BoxRecord, BoxSession, BoxSize, FlavorId, PieceSource } from '../../domain/types.ts'

export function startSession(size: BoxSize, now = Date.now()): BoxSession {
  return { id: crypto.randomUUID(), size, pieces: [], startedAt: now, undoCount: 0 }
}

/** Adds a piece. Ignored once the box is full, so a stray extra tap can't overfill it. */
export function addPiece(
  session: BoxSession,
  flavorId: FlavorId,
  source: PieceSource = 'tap',
  confidence?: number,
  now = Date.now(),
): BoxSession {
  if (session.pieces.length >= session.size) return session
  return {
    ...session,
    pieces: [...session.pieces, { flavorId, source, addedAt: now, ...(confidence !== undefined ? { confidence } : {}) }],
  }
}

export function undoLast(session: BoxSession): BoxSession {
  if (session.pieces.length === 0) return session
  return { ...session, pieces: session.pieces.slice(0, -1), undoCount: session.undoCount + 1 }
}

export function isComplete(session: BoxSession): boolean {
  return session.pieces.length === session.size
}

export function remaining(session: BoxSession): number {
  return session.size - session.pieces.length
}

/** Turns a complete session into a saved record, collapsing pieces into per-flavor
 * counts. Throws on an incomplete box: the UI must gate the save button on
 * isComplete() so this should never fire from a real tap. */
export function toRecord(session: BoxSession, now = Date.now()): BoxRecord {
  if (!isComplete(session)) {
    throw new Error(`Cannot save box ${session.id}: has ${session.pieces.length} of ${session.size} pieces`)
  }

  const counts = new Map<FlavorId, number>()
  for (const piece of session.pieces) {
    counts.set(piece.flavorId, (counts.get(piece.flavorId) ?? 0) + 1)
  }
  const method = session.pieces.some((p) => p.source === 'camera') ? 'camera-assisted' : 'tap'

  return {
    id: crypto.randomUUID(),
    size: session.size,
    pieces: [...counts.entries()].map(([flavorId, count]) => ({ flavorId, count })),
    startedAt: new Date(session.startedAt).toISOString(),
    completedAt: new Date(now).toISOString(),
    durationMs: now - session.startedAt,
    undoCount: session.undoCount,
    method,
    demo: false,
  }
}
