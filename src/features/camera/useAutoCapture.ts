// Auto-capture: while the preview is live, look at a small copy of the frame a
// few times a second, and when the insert's grid has been found near the
// outline and held still for a moment, take the photo without a tap.
//
// One lock takes one photo. The latch (`armed`) is cleared by a lock or by a
// manual capture and only set again by rearm(), so a box on the counter is
// never read twice by itself — applyDetections has no dedup, and a second read
// would add every piece again.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { AlignmentTracker } from './alignment.ts'
import type { AlignmentReading } from './alignment.ts'
import { grabAnalysisFrame } from './frameGrab.ts'
import { findGrid } from './gridFinder.ts'
import { outlineRect } from './grid.ts'
import type { GridSpec } from './grid.ts'

export interface AutoCaptureOptions {
  videoRef: RefObject<HTMLVideoElement | null>
  grid: GridSpec
  /** Look at frames at all. False while the preview isn't live, the gallery is
   * still loading, a photo is being read, or a review is open. */
  enabled: boolean
  /** Fired once per arming, on the reading that counts as locked. */
  onLocked: () => void
  intervalMs?: number
}

export interface AutoCaptureState extends AlignmentReading {
  /** True while a lock will take a photo. */
  armed: boolean
  /** Stop a lock from firing until rearm() — a manual capture calls this. */
  disarm: () => void
  /** Forget the run-up and arm again: "Scan again". */
  rearm: () => void
}

/** 4 Hz: findGrid on a 480 px frame takes tens of milliseconds, so this leaves
 * the main thread mostly free for the preview and the taps. */
const DEFAULT_INTERVAL_MS = 250

const IDLE: AlignmentReading = { phase: 'searching', corners: null, stableTicks: 0, stableTicksNeeded: 3 }

export function useAutoCapture({
  videoRef, grid, enabled, onLocked, intervalMs = DEFAULT_INTERVAL_MS,
}: AutoCaptureOptions): AutoCaptureState {
  const [reading, setReading] = useState<AlignmentReading>(IDLE)
  const [armed, setArmed] = useState(true)
  const tracker = useRef<AlignmentTracker | null>(null)
  const onLockedRef = useRef(onLocked)
  onLockedRef.current = onLocked

  // A new box size is a new lattice; the old run-up means nothing.
  useEffect(() => {
    tracker.current = null
  }, [grid])

  const running = enabled && armed

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const frame = grabAnalysisFrame(video)
      if (!frame) return
      const outline = outlineRect(grid, frame.width, frame.height)
      tracker.current ??= new AlignmentTracker(grid, outline)
      const fit = findGrid(frame.data, frame.width, frame.height, grid, outline)
      const next = tracker.current.push(fit)
      setReading(next)
      if (next.phase === 'locked') {
        setArmed(false)
        onLockedRef.current()
      }
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [running, grid, intervalMs, videoRef])

  const disarm = useCallback(() => setArmed(false), [])
  const rearm = useCallback(() => {
    tracker.current?.reset()
    setReading(IDLE)
    setArmed(true)
  }, [])

  return { ...reading, armed, disarm, rearm }
}
