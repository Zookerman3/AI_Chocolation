// A detector that sees nothing. It was the placeholder before the on-device
// recogniser existed, and is kept so the camera flow (capture -> review -> merge
// into the box) can be exercised in tests and demos with no model at all: it
// always returns zero detections and the UI says plainly that it's not looking
// at the photo for real. Never silently pretend to be the real model.

import type { Detection, FlavorDetector } from './types.ts'

export function createStubDetector(): FlavorDetector {
  return {
    async detect(): Promise<Detection[]> {
      return []
    },
  }
}
