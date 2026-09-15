// Every input method feeds the same box (see boxSession.ts) — the camera is no
// exception. This is the only place that decides what a detection does to the
// session; the UI just renders the result.

import type { BoxSession, FlavorId } from '../../domain/types.ts'
import { addPiece, isComplete } from '../box/boxSession.ts'
import type { Detection } from './types.ts'

/** Matches the Phase 2 checkpoint's top-1 accuracy bar in CLAUDE.md: a detection
 * this confident is auto-added, anything under it goes to the cashier instead. */
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
}

export function applyDetections(
  session: BoxSession,
  detections: Detection[],
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
): ApplyDetectionsResult {
  let next = session
  const needsReview: Detection[] = []
  const overflowed: Detection[] = []

  for (const detection of detections) {
    const meetsBar = detection.flavorId !== null && detection.confidence >= confidenceThreshold
    if (!meetsBar) {
      needsReview.push(detection)
      continue
    }
    if (isComplete(next)) {
      overflowed.push(detection)
      continue
    }
    next = addPiece(next, detection.flavorId as FlavorId, 'camera', detection.confidence)
  }

  return { session: next, needsReview, overflowed }
}

/** Resolves one "needs review" detection once the cashier has looked at it. Keeps
 * the model's confidence if they accepted its guess; drops it (undefined) if they
 * picked something else, since that confidence was never about the corrected
 * flavor. Ignored once the box is already full, same as a normal tap. */
export function confirmDetection(session: BoxSession, detection: Detection, chosenFlavorId: FlavorId): BoxSession {
  const confidence = chosenFlavorId === detection.flavorId ? detection.confidence : undefined
  return addPiece(session, chosenFlavorId, 'camera', confidence)
}
