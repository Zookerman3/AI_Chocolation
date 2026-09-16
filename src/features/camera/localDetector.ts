// Reads a photo of a box lined up with the on-screen outline: one crop per cell,
// one feature per crop, nearest neighbours against the gallery. Everything
// runs on the tablet — no request leaves the device, and it works with the wifi
// down. Implements the same FlavorDetector interface as the Roboflow client, so
// the box session and the review UI don't know which one they're talking to.
//
// With the network loaded (recognizer.ts) each crop is described by colour
// fingerprint + embedding, fused; without it, by the colour fingerprint alone.
// Same code path either way, just a different gallery and one more step.

import type { Detection, FlavorDetector } from './types.ts'
import { FLAVORS } from '../../data/flavors.ts'
import { featureFromCrop, resizeToCrop, sharpness } from './features.ts'
import { toEmbedCrop } from './embed.ts'
import { fuse } from './fused.ts'
import { classify, LABEL_EMPTY } from './gallery.ts'
import type { Recognizer } from './recognizer.ts'
import { cells, outlineRect } from './grid.ts'
import type { GridSpec, Rect } from './grid.ts'

const KNOWN_FLAVOR_IDS = new Set(FLAVORS.map((f) => f.id))

/** Frames whose sharpest cells score under this are refused. Measured on the
 * session-4 frames: crisp frames score 850-1800 (empty slots 150-1200), a 3 px
 * blur ~35 (still 97% accurate), a 6 px blur ~6 (79%, with confident misses).
 * 15 sits in the gap with a 2x margin either side. */
export const MIN_SHARPNESS = 15
export const BLURRY_MESSAGE = 'That photo is too blurry to read. Hold still, let the camera focus, and capture again.'

export interface LocalDetectorOptions {
  grid: GridSpec
  /** Where the box sits in the frame. Defaults to the outline the preview drew for
   * this frame size, which is the right answer for a live capture. Pass it
   * explicitly for a photo that came from somewhere else. */
  outline?: Rect
  /** Injected in tests; the app loads the shipped one. */
  recognizer?: Promise<Recognizer>
  /** Attach a small thumbnail of each cell to its detection. */
  thumbnails?: boolean
}

/** One insert slot, cut out of the frame at the two sizes the features want. */
export interface CellCrop {
  row: number
  col: number
  box: Rect
  /** 96x96 RGBA for the colour fingerprint (features.ts). */
  color: Uint8ClampedArray
  /** EMBED_SIZE square RGBA for the network (embed.ts). */
  embed: Uint8ClampedArray
}

/** Decodes a photo into a drawable bitmap. Blob -> ImageBitmap is the fast path;
 * jsdom has neither, so tests go through classifyCells with hand-made crops. */
async function decode(image: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('This browser cannot decode camera photos (no createImageBitmap)')
  }
  return createImageBitmap(image)
}

export function createLocalDetector(options: LocalDetectorOptions): FlavorDetector {
  // Lazy import: the WebAssembly runtime behind the recognizer stays out of the
  // main bundle (and out of jsdom) until a detector is actually created.
  const recognizerPromise = options.recognizer ?? import('./recognizer.ts').then((m) => m.loadRecognizer())
  return {
    async detect(image: Blob): Promise<Detection[]> {
      const [recognizer, bitmap] = await Promise.all([recognizerPromise, decode(image)])
      let crops: CellCrop[]
      try {
        crops = readCells(bitmap, options)
      } finally {
        bitmap.close?.()
      }
      assertSharp(crops)
      return classifyCells(crops, recognizer, options.thumbnails !== false)
    },
  }
}

/** The DOM part: draw the frame once, cut every cell out of it. */
export function readCells(
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLVideoElement,
  options: Pick<LocalDetectorOptions, 'grid' | 'outline'>,
): CellCrop[] {
  const frameWidth = 'videoWidth' in bitmap ? bitmap.videoWidth : bitmap.width
  const frameHeight = 'videoHeight' in bitmap ? bitmap.videoHeight : bitmap.height
  const outline = options.outline ?? outlineRect(options.grid, frameWidth, frameHeight)

  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not get a 2D canvas context')
  ctx.drawImage(bitmap, 0, 0)

  return cells(options.grid, outline).map((cell) => {
    const sx = Math.round(cell.read.x * frameWidth)
    const sy = Math.round(cell.read.y * frameHeight)
    const sw = Math.max(1, Math.round(cell.read.width * frameWidth))
    const sh = Math.max(1, Math.round(cell.read.height * frameHeight))
    const pixels = ctx.getImageData(sx, sy, sw, sh).data
    return {
      row: cell.row,
      col: cell.col,
      box: cell.box,
      color: resizeToCrop(pixels, sw, sh),
      embed: toEmbedCrop(pixels, sw, sh),
    }
  })
}

/** Refuses a frame that is blurred all over. Judged on the sharpest cell: blur
 * is a property of the whole frame, so a soft frame has no cell to pass on,
 * while a nearly empty box (dark, smooth slots) still passes on its one piece. */
export function assertSharp(crops: CellCrop[]): void {
  if (crops.length === 0) return
  const sharpest = Math.max(...crops.map((c) => sharpness(c.color)))
  if (sharpest < MIN_SHARPNESS) throw new Error(BLURRY_MESSAGE)
}

/** The pure part: given the crops, say what's in each. Exposed so it can be
 * tested with hand-drawn crops and a toy gallery, no canvas needed. */
export async function classifyCells(crops: CellCrop[], recognizer: Recognizer, thumbnails = true): Promise<Detection[]> {
  const colorFeatures = crops.map((c) => featureFromCrop(c.color))
  let features = colorFeatures
  if (recognizer.kind === 'fused') {
    const embeddings = await recognizer.embedder.embed(crops.map((c) => c.embed))
    features = colorFeatures.map((color, i) => fuse(color, embeddings[i]))
  }

  const { gallery } = recognizer
  const threshold = gallery.meta.confidenceThreshold
  const detections: Detection[] = []

  crops.forEach((cell, i) => {
    const ranked = classify(features[i], gallery)
    const best = ranked[0]
    if (!best) return

    // A confidently empty cell is just empty. An unsure "empty" still goes to the
    // cashier with the best real flavor as the suggestion — a dark piece against
    // black plastic is exactly where the features are weakest.
    let pick = best
    if (best.label === LABEL_EMPTY) {
      if (best.share >= threshold) return
      const alt = ranked.find((c) => c.label !== LABEL_EMPTY)
      if (!alt) return
      pick = { label: alt.label, share: Math.min(alt.share, threshold - 0.01) }
    }

    detections.push({
      flavorId: KNOWN_FLAVOR_IDS.has(pick.label) ? pick.label : null,
      confidence: pick.share,
      box: cell.box,
      rawClass: pick.label,
      cell: { row: cell.row, col: cell.col },
      ...(thumbnails ? { thumbnail: thumbnailDataUrl(cell.color) } : {}),
    })
  })
  return detections
}

function thumbnailDataUrl(crop: Uint8ClampedArray): string {
  if (typeof document === 'undefined') return ''
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
