import { createRoboflowDetector } from './roboflowDetector.ts'
import { createStubDetector } from './stubDetector.ts'
import type { FlavorDetector } from './types.ts'

const apiKey = import.meta.env.VITE_ROBOFLOW_API_KEY
const modelId = import.meta.env.VITE_ROBOFLOW_MODEL_ID

/** False until a real Roboflow model is configured (see .env.example) — the camera
 * flow still works either way, it just won't detect anything real until then. */
export const isCameraModelConfigured = Boolean(apiKey && modelId)

export function getDetector(): FlavorDetector {
  return apiKey && modelId ? createRoboflowDetector({ apiKey, modelId }) : createStubDetector()
}
