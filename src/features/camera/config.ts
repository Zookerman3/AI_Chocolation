import { createRoboflowDetector } from './roboflowDetector.ts'
import { createLocalDetector } from './localDetector.ts'
import { createStubDetector } from './stubDetector.ts'
import type { FlavorDetector } from './types.ts'
import type { GridSpec } from './grid.ts'
import type { LoadProgress, Recognizer } from './recognizer.ts'
import { COLOR_GALLERY } from './fused.ts'
import { loadGallery } from './gallery.ts'

const apiKey = import.meta.env.VITE_ROBOFLOW_API_KEY
const modelId = import.meta.env.VITE_ROBOFLOW_MODEL_ID

/** Which detector the app uses. The on-device recognizer is the default and
 * needs nothing configured; Roboflow is an opt-in override for a hosted
 * object-detection model, if one ever beats it. */
export type DetectorKind = 'local' | 'roboflow' | 'stub'

export const detectorKind = (apiKey && modelId ? 'roboflow' : 'local') as DetectorKind

/** Kept for the review UI's demo banner: false only when nothing real is wired. */
export const isCameraModelConfigured = detectorKind !== 'stub'

/** The local detector reads fixed cells, so it needs to know the grid; Roboflow
 * finds pieces itself and ignores it. */
export function getDetector(grid: GridSpec): FlavorDetector {
  switch (detectorKind) {
    case 'roboflow':
      return createRoboflowDetector({ apiKey: apiKey as string, modelId: modelId as string })
    case 'local':
      return createLocalDetector({ grid, recognizer: preloadRecognizer() })
    default:
      return createStubDetector()
  }
}

let pending: Promise<Recognizer> | null = null

/** Starts loading the on-device recognizer. The network and the WebAssembly
 * runtime that runs it live in a chunk of their own, imported only when the
 * camera opens, so the rest of the app never pays for them.
 *
 * That chunk is also the one thing here that can fail in a way we can't see
 * from a laptop: an old browser, a device that won't keep 14 MB of WebAssembly,
 * a service worker holding a stale build. So its failure is not the camera's
 * failure — colour matching (features.ts + the 735 KB colour gallery) is in the
 * main bundle, needs no WebAssembly at all, and gets 92% on its own. We fall
 * back to it and the screen says so, rather than leaving the cashier with a
 * dead Capture button. */
export function preloadRecognizer(onProgress?: (p: LoadProgress) => void): Promise<Recognizer> {
  if (!pending) {
    pending = import('./recognizer.ts')
      .then((m) => m.loadRecognizer(onProgress))
      .catch(async (err: unknown) => {
        console.warn('Camera: the recognizer module did not load; colour matching only.', err)
        onProgress?.({ phase: 'gallery', loaded: 0, total: null })
        const gallery = await loadGallery(COLOR_GALLERY)
        onProgress?.({ phase: 'ready', loaded: 0, total: null })
        return { kind: 'color', gallery, embedder: null, reason: reasonOf(err) } satisfies Recognizer
      })
      .catch((err: unknown) => {
        pending = null // both paths failed: let the next attempt try again
        throw err
      })
  }
  return pending
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
