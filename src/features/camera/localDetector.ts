// Reads a photo of a box lined up with the on-screen outline: one crop per cell,
// one fingerprint per crop, nearest neighbours against the gallery. Everything
// runs on the tablet — no request leaves the device, and it works with the wifi
// down. Implements the same FlavorDetector interface as the Roboflow client, so
// the box session and the review UI don't know which one they're talking to.

import type { Detection, FlavorDetector } from './types.ts'
import { FLAVORS } from '../../data/flavors.ts'
import { featureFromCrop, resizeToCrop } from './features.ts'
import { classify, LABEL_EMPTY, loadGallery } from './gallery.ts'
import type { Gallery } from './gallery.ts'
import { cells, outlineRect } from './grid.ts'
import type { GridSpec, Rect } from './grid.ts'

const KNOWN_FLAVOR_IDS = new Set(FLAVORS.map((f) => f.id))

export interface LocalDetectorOptions {
  grid: GridSpec
  /** Where the box sits in the frame. Defaults to the outline the preview drew for
   * this frame size, which is the right answer for a live capture. Pass it
   * explicitly for a photo that came from somewhere else. */
  outline?: Rect
  /** Injected in tests; the app loads the shipped gallery. */
  gallery?: Promise<Gallery>
  /** Attach a small thumbnail of each cell to its detection. */
  thumbnails?: boolean
}

/** Decodes a photo into a drawable bitmap. Blob -> ImageBitmap is the fast path;
 * jsdom has neither, so tests inject a gallery and never reach this. */
async function decode(image: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode camera photos (no createImageBitmap)')
  }
  return createImageBitmap(image)
}

export function createLocalDetector(options: LocalDetectorOptions): FlavorDetector {
  const galleryPromise = options.gallery ?? loadGallery()
  return {
    async detect(image: Blob): Promise<Detection[]> {
      const [gallery, bitmap] = await Promise.all([galleryPromise, decode(image)])
      try {
        return detectOnBitmap(bitmap, gallery, options)
      } finally {
        bitmap.close?.()
      }
    },
  }
}

/** The pure part: given a decoded frame, read every cell. Exposed so the same
 * code can run on a canvas the preview already has, and so it can be tested
 * with a hand-drawn frame. */
export function detectOnBitmap(
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLVideoElement,
  gallery: Gallery,
  options: LocalDetectorOptions,
): Detection[] {
  const frameWidth = 'videoWidth' in bitmap ? bitmap.videoWidth : bitmap.width
  const frameHeight = 'videoHeight' in bitmap ? bitmap.videoHeight : bitmap.height
  const outline = options.outline ?? outlineRect(options.grid, frameWidth, frameHeight)

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not get a 2D canvas context')
  ctx.drawImage(bitmap, 0, 0)

  const threshold = gallery.meta.confidenceThreshold
  const detections: Detection[] = []

  for (const cell of cells(options.grid, outline)) {
    const sx = Math.round(cell.read.x * frameWidth)
    const sy = Math.round(cell.read.y * frameHeight)
    const sw = Math.max(1, Math.round(cell.read.width * frameWidth))
    const sh = Math.max(1, Math.round(cell.read.height * frameHeight))
    const pixels = ctx.getImageData(sx, sy, sw, sh).data
    const crop = resizeToCrop(pixels, sw, sh)
    const ranked = classify(featureFromCrop(crop), gallery)
    const best = ranked[0]
    if (!best) continue

    // A confidently empty cell is just empty. An unsure "empty" still goes to the
    // cashier with the best real flavor as the suggestion — a dark piece against
    // black plastic is exactly where the colour features are weakest.
    let pick = best
    if (best.label === LABEL_EMPTY) {
      if (best.share >= threshold) continue
      const alt = ranked.find((c) => c.label !== LABEL_EMPTY)
      if (!alt) continue
      pick = { label: alt.label, share: Math.min(alt.share, threshold - 0.01) }
    }

    detections.push({
      flavorId: KNOWN_FLAVOR_IDS.has(pick.label) ? pick.label : null,
      confidence: pick.share,
      box: cell.box,
      rawClass: pick.label,
      cell: { row: cell.row, col: cell.col },
      ...(options.thumbnails === false ? {} : { thumbnail: thumbnailDataUrl(crop) }),
    })
  }
  return detections
}

function thumbnailDataUrl(crop: Uint8ClampedArray): string {
  const c = document.createElement('canvas')
  c.width = 96
  c.height = 96
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(96, 96)
  img.data.set(crop)
  ctx.putImageData(img, 0, 0)
  try {
    return c.toDataURL('image/jpeg', 0.8)
  } catch {
    return ''
  }
}
