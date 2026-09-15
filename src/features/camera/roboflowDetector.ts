// Client for a Roboflow-hosted object detection model, following the same approach
// as https://blog.roboflow.com/identifying-chocolates-with-computer-vision/: one
// photo of the open box, bounding boxes around each visible piece.
//
// Labeling convention (tell whoever sets up the Roboflow project): name each class
// exactly as the flavor's id in src/data/flavors.json (e.g. "creme-brulee", not
// "Crème Brûlée" or the Shopify handle) so detections map straight onto our catalog
// with no fuzzy matching. An unrecognized class name comes back with flavorId: null
// instead of being dropped, so a labeling mismatch is visible, not silent.

import type { Detection, FlavorDetector } from './types.ts'
import { FLAVORS } from '../../data/flavors.ts'

export interface RoboflowConfig {
  apiKey: string
  /** e.g. "cocoa-dolce-bonbons/3" — workspace/project slug and version number. */
  modelId: string
  /** 0-1. Roboflow's own confidence filter, applied server-side. Default 0.3, kept
   * low so borderline detections still reach the "please confirm" review step
   * instead of being discarded before the cashier ever sees them. */
  minConfidence?: number
}

const KNOWN_FLAVOR_IDS = new Set(FLAVORS.map((f) => f.id))

interface RoboflowPrediction {
  class: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

interface RoboflowResponse {
  image?: { width: number; height: number }
  predictions?: RoboflowPrediction[]
}

export function mapClassToFlavorId(rawClass: string): string | null {
  const normalized = rawClass.trim().toLowerCase()
  return KNOWN_FLAVOR_IDS.has(normalized) ? normalized : null
}

export function createRoboflowDetector(config: RoboflowConfig): FlavorDetector {
  return {
    async detect(image: Blob): Promise<Detection[]> {
      const base64 = await blobToBase64(image)
      const params = new URLSearchParams({
        api_key: config.apiKey,
        confidence: String((config.minConfidence ?? 0.3) * 100),
      })
      const res = await fetch(`https://detect.roboflow.com/${config.modelId}?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: base64,
      })
      if (!res.ok) {
        throw new Error(`Roboflow inference failed: ${res.status} ${res.statusText}`)
      }
      const data = (await res.json()) as RoboflowResponse
      const imageWidth = data.image?.width ?? 1
      const imageHeight = data.image?.height ?? 1

      return (data.predictions ?? []).map((p) => ({
        flavorId: mapClassToFlavorId(p.class),
        confidence: p.confidence,
        box: {
          x: (p.x - p.width / 2) / imageWidth,
          y: (p.y - p.height / 2) / imageHeight,
          width: p.width / imageWidth,
          height: p.height / imageHeight,
        },
        rawClass: p.class,
      }))
    },
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}
