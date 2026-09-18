// Every input method feeds the same box (see boxSession.ts) — the camera is no
// exception. This is the only place that decides what a detection does to the
// session; the UI just renders the result.

import type { BoxSession, FlavorId } from '../../domain/types.ts'
import { addPiece, cellKey, filledCells, isComplete } from '../box/boxSession.ts'
import type { Detection } from './types.ts'

/** A detection this confident is auto-added, anything under it goes to the
 * cashier instead. For the on-device recogniser "confidence" is the winner's
 * share of the nearest-neighbour vote, and 0.8 is where scripts/build-gallery.ts
 * measured ~89% of slots auto-filling at ~97% precision. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.8

export interface ApplyDetectionsResult {
  session: BoxSession
  /** Unmapped class, or below the confidence threshold — the cashier confirms or
   * fixes each one with a single tap (see confirmDetection). */
  needsReview: Detection[]
  /** Would have auto-added, but the box was already full by the time we got to it
   * — surfaced instead of silently dropped, so the cashier knows the photo found
   * more pieces than the box holds. */
  overflowed: Detection[]
  /** Read from a slot an earlier photo of this box already filled: the same piece
   * seen again, not a second piece. Skipped — neither added nor put up for review
   * — and counted so the screen can say so. A real box can hold two of one flavor
   * in two slots; those are two pieces, which is why the key is the slot and never
   * the flavor. */
  alreadyCounted: Detection[]
}

export function applyDetections(
  session: BoxSession,
  detections: Detection[],
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): ApplyDetectionsResult {
  let next = session
  const needsReview: Detection[] = []
  const overflowed: Detection[] = []
  const alreadyCounted: Detection[] = []
  const taken = filledCells(session)

  for (const detection of detections) {
    if (detection.cell && taken.has(cellKey(detection.cell))) {
      alreadyCounted.push(detection)
      continue
    }
    const meetsBar = detection.flavorId !== null && detection.confidence >= confidenceThreshold
    if (!meetsBar) {
      needsReview.push(detection)
      continue
    }
    if (isComplete(next)) {
      overflowed.push(detection)
      continue
    }
    next = addPiece(next, detection.flavorId as FlavorId, 'camera', detection.confidence, undefined, detection.cell)
    if (detection.cell) taken.add(cellKey(detection.cell))
  }

  return { session: next, needsReview, overflowed, alreadyCounted }
}

/** Resolves one "needs review" detection once the cashier has looked at it. Keeps
 * the model's confidence if they accepted its guess; drops it (undefined) if they
 * picked something else, since that confidence was never about the corrected
 * flavor. Ignored once the box is already full, same as a normal tap — and ignored
 * if a later photo already filled that slot, so a stale review row can't double it. */
export function confirmDetection(session: BoxSession, detection: Detection, chosenFlavorId: FlavorId): BoxSession {
  if (detection.cell && filledCells(session).has(cellKey(detection.cell))) return session
  const confidence = chosenFlavorId === detection.flavorId ? detection.confidence : undefined
  return addPiece(session, chosenFlavorId, 'camera', confidence, undefined, detection.cell)
}
