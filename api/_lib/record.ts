// Server-side validation of a BoxRecord.
//
// This mirrors src/domain/types.ts. It is duplicated rather than imported
// because a Vercel serverless function is bundled separately from the browser
// app and must not drag the React tree in with it. The shapes must stay in step;
// `api/api.test.ts` covers this side, and the dashboard's
// `src/lib/interop.test.ts` is the round-trip contract test between them.

export const BOX_SIZES = [6, 10, 16, 30, 50] as const
export type BoxSize = (typeof BOX_SIZES)[number]
export type CaptureMethod = 'tap' | 'camera-assisted'

export interface BoxRecord {
  id: string
  size: BoxSize
  pieces: { flavorId: string; count: number }[]
  startedAt: string
  completedAt: string
  durationMs: number
  undoCount: number
  method: CaptureMethod
  demo: boolean
  locationId?: string
  /** Stamped by the API when the record is first accepted. Never trusted from
   * the client — a tablet's clock is not authoritative and this is what lets the
   * dashboard tell "new to the server" from "old box synced late". */
  receivedAt?: string
}

const METHODS: CaptureMethod[] = ['tap', 'camera-assisted']
const MAX_PIECES = 50
const MAX_ID = 128

function isIsoish(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(new Date(value).getTime())
}

export type Validation =
  | { ok: true; record: BoxRecord }
  | { ok: false; why: string }

/** Accepts only what the tablet actually writes, and normalises the rest.
 * Anything unrecognised is rejected with a reason the client can display. */
export function validateRecord(input: unknown): Validation {
  if (typeof input !== 'object' || input === null) return { ok: false, why: 'not an object' }
  const raw = input as Record<string, unknown>

  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > MAX_ID) {
    return { ok: false, why: 'missing or oversized id' }
  }
  const size = Number(raw.size)
  if (!(BOX_SIZES as readonly number[]).includes(size)) {
    return { ok: false, why: `unknown box size ${String(raw.size)}` }
  }
  if (!Array.isArray(raw.pieces) || raw.pieces.length === 0 || raw.pieces.length > MAX_PIECES) {
    return { ok: false, why: 'pieces must be a non-empty list' }
  }

  const pieces: BoxRecord['pieces'] = []
  let total = 0
  for (const entry of raw.pieces) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, why: 'malformed piece' }
    const piece = entry as Record<string, unknown>
    const count = Number(piece.count)
    if (typeof piece.flavorId !== 'string' || !piece.flavorId || piece.flavorId.length > MAX_ID) {
      return { ok: false, why: 'piece without a usable flavorId' }
    }
    if (!Number.isInteger(count) || count <= 0 || count > 50) {
      return { ok: false, why: 'piece count must be a positive whole number' }
    }
    pieces.push({ flavorId: piece.flavorId, count })
    total += count
  }
  // The tablet will not let a box save unless the count matches exactly, so a
  // mismatch here means something other than the tablet is posting.
  if (total !== size) {
    return { ok: false, why: `piece counts total ${total}, which is not the box size ${size}` }
  }

  if (!isIsoish(raw.completedAt)) return { ok: false, why: 'missing or unparseable completedAt' }
  if (!METHODS.includes(raw.method as CaptureMethod)) {
    return { ok: false, why: `unknown capture method ${String(raw.method)}` }
  }

  const durationMs = Number(raw.durationMs)
  const undoCount = Number(raw.undoCount)

  return {
    ok: true,
    record: {
      id: raw.id,
      size: size as BoxSize,
      pieces,
      startedAt: isIsoish(raw.startedAt) ? raw.startedAt : raw.completedAt,
      completedAt: new Date(raw.completedAt).toISOString(),
      durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0,
      undoCount: Number.isInteger(undoCount) && undoCount >= 0 ? undoCount : 0,
      method: raw.method as CaptureMethod,
      demo: raw.demo === true,
      ...(typeof raw.locationId === 'string' && raw.locationId && raw.locationId.length <= MAX_ID
        ? { locationId: raw.locationId }
        : {}),
    },
  }
}
