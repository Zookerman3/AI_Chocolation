// The DOM edge of the live camera: pulling pixels out of the <video>. Kept
// apart from the analysis so the alignment loop and the screen can be tested
// with this file mocked (jsdom has no canvas), and so the Capture button and
// auto-capture take one and the same photo.

export interface AnalysisFrame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** HTMLMediaElement.HAVE_CURRENT_DATA — a frame exists to draw. */
const HAVE_CURRENT_DATA = 2

let scratch: HTMLCanvasElement | null = null

/** A small copy of the current frame for the grid finder — 480 px wide is what
 * findGrid analyses anyway. Null when the video has no frame yet or the
 * browser gives us no 2D context. */
export function grabAnalysisFrame(video: HTMLVideoElement, width = 480): AnalysisFrame | null {
  if (video.readyState < HAVE_CURRENT_DATA || video.videoWidth === 0) return null
  const height = Math.max(1, Math.round((video.videoHeight * width) / video.videoWidth))
  scratch ??= document.createElement('canvas')
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width
    scratch.height = height
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

/** The full-resolution photo, as a JPEG blob — the same thing the file input
 * hands over, so both paths into the detector are one code path. */
export function grabPhotoBlob(video: HTMLVideoElement, frame: { width: number; height: number }): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(video, 0, 0, frame.width, frame.height)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92))
}
