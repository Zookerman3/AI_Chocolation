// No trained model exists yet — that needs real photos of real Cocoa Dolce
// chocolates, which nobody has taken. This stub exists so the camera flow (capture
// -> review -> merge into the box) is honestly demoable and testable before that
// happens: it always returns zero detections and the UI must say plainly that it's
// not looking at the photo for real. Never silently pretend to be the real model.

import type { Detection, FlavorDetector } from './types.ts'

export function createStubDetector(): FlavorDetector {
  return {
    async detect(): Promise<Detection[]> {
      return []
    },
  }
}
