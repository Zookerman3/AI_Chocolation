import { createRoboflowDetector } from './roboflowDetector.ts'
import { createLocalDetector } from './localDetector.ts'
import { createStubDetector } from './stubDetector.ts'
import type { FlavorDetector } from './types.ts'
import type { GridSpec } from './grid.ts'
import type { LoadProgress, Recognizer } from './recognizer.ts'

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

/** Starts loading the on-device recognizer (network + gallery, ~6 MB the first
 * time, cached after). Imported lazily so the WebAssembly runtime stays out of
 * the main bundle until the camera is actually opened. */
export function preloadRecognizer(onProgress?: (p: LoadProgress) => void): Promise<Recognizer> {
  return import('./recognizer.ts').then((m) => m.loadRecognizer(onProgress))
}
