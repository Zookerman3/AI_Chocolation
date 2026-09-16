import type { FlavorId } from '../../domain/types.ts'

/** One detected piece in a photo, in normalized (0-1) image coordinates so the UI
 * doesn't need to know the photo's pixel dimensions to draw or crop around it. */
export interface Detection {
  /** null when the detector's class name doesn't map to a known flavor — still
   * shown to the cashier so nothing silently disappears, but never auto-added. */
  flavorId: FlavorId | null
  confidence: number
  box: { x: number; y: number; width: number; height: number }
  /** The detector's raw class string, kept for debugging an unmapped detection. */
  rawClass: string
  /** Grid position, when the detector reads fixed cells (1-based, reading order). */
  cell?: { row: number; col: number }
  /** Small data-URL image of what was read, so the cashier can see what the camera
   * saw next to its guess instead of trusting a name and a percentage. */
  thumbnail?: string
}

/** Anything that can turn a photo into a list of detections implements this — the
 * on-device recogniser (localDetector.ts), the opt-in Roboflow client, or the stub
 * that sees nothing. The box session and UI never need to know which. */
export interface FlavorDetector {
  detect(image: Blob): Promise<Detection[]>
}
