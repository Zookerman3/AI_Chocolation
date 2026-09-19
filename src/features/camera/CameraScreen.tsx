import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoxSession } from '../../domain/types.ts'
import type { Detection } from './types.ts'
import { applyDetections, confirmDetection } from './applyDetections.ts'
import { detectorKind, getDetector, preloadRecognizer } from './config.ts'
import type { LoadProgress } from './recognizer.ts'
import { FLAVORS, flavorOrPlaceholder } from '../../data/flavors.ts'
import { cells, gridFor, outlineRect } from './grid.ts'
import type { GridSpec, Rect } from './grid.ts'
import { isComplete } from '../box/boxSession.ts'
import { BLURRY_MESSAGE } from './localDetector.ts'
import { grabPhotoBlob } from './frameGrab.ts'
import { useAutoCapture } from './useAutoCapture.ts'
import type { AutoCaptureState } from './useAutoCapture.ts'
import type { AlignmentPhase, Point } from './alignment.ts'

interface CameraScreenProps {
  session: BoxSession
  onSessionChange: (session: BoxSession) => void
  /** Leaves the camera for the tile grid — same session, same pieces, just a
   * different way to add the rest. */
  onManual: () => void
  /** A photo filled the box: nothing is left to do here, so the screen hands
   * over to the tally, where Save is already enabled. */
  onComplete?: () => void
}

type PreviewState = 'starting' | 'live' | 'unavailable'

const VIDEO_WANTED: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
  audio: false,
}

/** How long the camera is held after the screen lets go of it. A StrictMode
 * remount comes back in the same tick; a cashier leaving the screen does not. */
const RELEASE_DELAY_MS = 250

/** A frame refused as blurry gets another go on its own after this long — the
 * hand usually settles within a second. Other errors wait for the cashier. */
const BLUR_RETRY_MS = 800

/** Hooks run unconditionally; a box size with no insert just never enables the loop. */
const NO_GRID: GridSpec = { rows: 1, cols: 1 }

/** The camera, asked for once and shared, rather than once per mount.
 *
 * Two overlapping getUserMedia calls for the same lens is a real way to end up
 * with a dead preview: the second call can be handed the track the first one is
 * about to stop, and the screen then sits on "Starting the camera…" until you
 * back out and come in again — the "I had to click it twice" bug. React's
 * StrictMode mounts every effect twice in dev, so it does exactly that on every
 * single open. Keeping the stream out here means a remount reuses it instead of
 * racing it, and the camera is released a moment after the last screen is done. */
let shared: Promise<MediaStream> | null = null
let releaseTimer: number | null = null

function acquireCamera(media: MediaDevices): Promise<MediaStream> {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer)
    releaseTimer = null
  }
  if (!shared) {
    shared = media.getUserMedia(VIDEO_WANTED).catch((err: unknown) => {
      shared = null // a refusal is not cached: the next open asks again
      throw err
    })
  }
  return shared
}

function releaseCameraSoon(): void {
  if (releaseTimer !== null) clearTimeout(releaseTimer)
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null
    const held = shared
    shared = null
    void held?.then((stream) => stream.getTracks().forEach((t) => t.stop())).catch(() => {})
  }, RELEASE_DELAY_MS)
}

/** Live rear-camera preview with the grid outline drawn over it. Falls back to the
 * OS camera (a file input) where getUserMedia isn't available — an http:// dev
 * server on a phone, an old browser, or a denied permission. Every way this can
 * fail ends on 'unavailable', which is still a working way to capture a box;
 * none of them leave the cashier watching a veil that never lifts. */
function useCameraPreview(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<PreviewState>('starting')
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!enabled) return
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!media?.getUserMedia) {
      setState('unavailable')
      return
    }
    let cancelled = false
    acquireCamera(media)
      .then((stream) => {
        if (cancelled) return
        const video = videoRef.current
        if (!video) {
          setState('unavailable') // no element to play into: offer the photo card instead of hanging
          return
        }
        video.srcObject = stream
        const ready = () => {
          if (cancelled) return
          setFrame({ width: video.videoWidth, height: video.videoHeight })
          setState('live')
          void video.play().catch(() => setState('unavailable'))
        }
        // A stream that is already running brings its metadata with it, so the
        // event may have been and gone before we could listen for it.
        if (video.readyState >= 1 && video.videoWidth > 0) ready()
        else video.addEventListener('loadedmetadata', ready, { once: true })
      })
      .catch(() => {
        if (!cancelled) setState('unavailable')
      })
    return () => {
      cancelled = true
      releaseCameraSoon()
    }
  }, [enabled])

  return { videoRef, state, frame }
}

export function CameraScreen({ session, onSessionChange, onManual, onComplete }: CameraScreenProps) {
  const grid = gridFor(session.size)
  const [status, setStatus] = useState<'idle' | 'detecting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Detection[]>([])
  const [overflowed, setOverflowed] = useState<Detection[]>([])
  const [alreadyCounted, setAlreadyCounted] = useState(0)
  const [addedCount, setAddedCount] = useState(0)
  const [galleryReady, setGalleryReady] = useState(detectorKind !== 'local')
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [degraded, setDegraded] = useState<string | null>(null)
  const { videoRef, state: preview, frame } = useCameraPreview(grid !== null)

  // Auto-capture: look at the live preview a few times a second and take the
  // photo once the insert's grid has been found near the outline and held
  // still. One lock, one photo; "Scan again" arms it for the next box.
  const auto = useAutoCapture({
    videoRef,
    grid: grid ?? NO_GRID,
    enabled: grid !== null && preview === 'live' && galleryReady && status !== 'detecting' && pending.length === 0,
    onLocked: () => capture(),
  })
  const { rearm: rearmAuto } = auto
  const retryTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
  }, [])

  // Warm the recognizer while the cashier is still lining the box up, so the
  // first capture doesn't pay for the download. ~6 MB the first time, precached
  // by the service worker after that.
  useEffect(() => {
    if (detectorKind !== 'local') return
    let live = true
    preloadRecognizer((p) => {
      if (live) setProgress(p)
    })
      .then((r) => {
        if (!live) return
        setGalleryReady(true)
        if (r.kind === 'color') setDegraded(r.reason)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(err instanceof Error ? err.message : 'Could not load the flavor gallery.')
        setStatus('error')
      })
    return () => {
      live = false
    }
  }, [])

  const handlePhoto = useCallback(
    async (image: Blob) => {
      if (!grid) return
      setStatus('detecting')
      setError(null)
      try {
        const detections = await getDetector(grid).detect(image)
        const before = session.pieces.length
        const result = applyDetections(session, detections)
        if (result.session !== session) onSessionChange(result.session)
        setAddedCount(result.session.pieces.length - before)
        setPending(result.needsReview)
        setOverflowed(result.overflowed)
        setAlreadyCounted(result.alreadyCounted.length)
        setStatus('idle')
        if (isComplete(result.session)) onComplete?.()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not read that photo.'
        setError(message)
        setStatus('error')
        // A soft frame is worth another go by itself once the hand settles;
        // anything else stays on screen until the cashier acts.
        if (message === BLURRY_MESSAGE) {
          if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null
            rearmAuto()
          }, BLUR_RETRY_MS)
        }
      }
    },
    [grid, session, onSessionChange, onComplete, rearmAuto],
  )

  /** Take the photo now — from the Capture button or from the alignment loop.
   * Through a Blob so the live path and the file-input path are one code path. */
  function capture() {
    const video = videoRef.current
    if (!video || !frame) return
    auto.disarm()
    void grabPhotoBlob(video, frame).then((blob) => {
      if (blob) void handlePhoto(blob)
    })
  }

  function scanAgain() {
    setAddedCount(0)
    setOverflowed([])
    setError(null)
    setStatus('idle')
    auto.rearm()
  }

  function resolvePending(detection: Detection, chosenFlavorId: string | null) {
    setPending((list) => list.filter((d) => d !== detection))
    if (!chosenFlavorId) return
    const next = confirmDetection(session, detection, chosenFlavorId)
    if (next !== session) {
      onSessionChange(next)
      setAddedCount((n) => n + 1)
    }
    // The confirm that fills the box is a finished box too — same hand-over as a
    // photo that fills it.
    if (isComplete(next)) onComplete?.()
  }

  if (!grid) {
    return (
      <section aria-labelledby="camera-heading" className="camera-screen panel">
        <div className="box-toolbar">
          <div>
            <p className="eyebrow">Camera assist</p>
            <h2 id="camera-heading">Not for this box size</h2>
            <p className="helper-text">
              The camera reads the fixed slots of an insert, and we haven't measured the {session.size}-piece box's. Tap
              the tiles for this one.
            </p>
          </div>
          <button type="button" className="button button-dark" onClick={onManual}>
            ▦ Pick manually
          </button>
        </div>
      </section>
    )
  }

  const busy = status === 'detecting'
  const canCapture = preview === 'live' && galleryReady && !busy
  const outlinePhase: OutlinePhase = auto.armed ? auto.phase : 'done'
  const badge = badgeFor(auto, busy, pending.length > 0)

  return (
    <section aria-labelledby="camera-heading" className="camera-screen panel">
      <div className="box-toolbar">
        <div>
          <p className="eyebrow">Camera assist · {grid.rows}×{grid.cols} insert</p>
          <h2 id="camera-heading">Scan the box</h2>
          <p className="helper-text">
            Get the open box inside the outline and hold still — it takes the picture itself once it finds the slots
            (or tap Capture). Anything the camera isn't sure about comes back for one tap.
          </p>
        </div>
        <div className="box-toolbar-actions">
          {preview !== 'unavailable' && (
            <button type="button" className="button button-accent" onClick={capture} disabled={!canCapture}>
              {busy ? 'Reading…' : 'Capture'}
            </button>
          )}
          {preview !== 'unavailable' && !auto.armed && !busy && (
            <button type="button" className="button button-light" onClick={scanAgain}>
              Scan again
            </button>
          )}
          <button type="button" className="button button-dark" onClick={onManual}>
            ▦ Pick manually
          </button>
        </div>
      </div>

      {/* What the last photo did, and anything left to confirm, sit above the
          preview so the cashier never scrolls past the camera to find out. */}
      {degraded && (
        <p className="camera-banner">
          <strong>Basic colour matching.</strong> The recognizer model didn't load on this device, so expect more
          "please confirm" taps than usual. Reload once the connection is back.
        </p>
      )}
      {detectorKind === 'stub' && (
        <p className="camera-banner">
          <strong>Demo camera flow.</strong> No model is configured yet, but the review flow is ready for when one is
          connected.
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="camera-error">
          {error}
        </p>
      )}
      {status === 'idle' && addedCount > 0 && (
        <p role="status" className="success-note">
          Added {addedCount} piece{addedCount === 1 ? '' : 's'} from the photo.
        </p>
      )}
      {overflowed.length > 0 && (
        <p className="camera-banner">
          {overflowed.length} more detected piece{overflowed.length === 1 ? '' : 's'} didn't fit — the box is already
          full.
        </p>
      )}
      {alreadyCounted > 0 && (
        <p role="status" className="camera-banner">
          {alreadyCounted} piece{alreadyCounted === 1 ? ' was' : 's were'} already counted from an earlier photo of
          this box — not added again.
        </p>
      )}
      {pending.length > 0 && (
        <div className="camera-review">
          <div>
            <p className="eyebrow">Quick review</p>
            <h3>
              Please confirm <span>{pending.length}</span>
            </h3>
          </div>
          <ul className="camera-pending">
            {pending.map((detection, index) => (
              <PendingRow key={index} detection={detection} onResolve={(id) => resolvePending(detection, id)} />
            ))}
          </ul>
        </div>
      )}

      {preview !== 'unavailable' && (
        <div className="camera-live">
          <div
            className="camera-frame"
            style={frame ? { aspectRatio: `${frame.width} / ${frame.height}` } : { aspectRatio: '4 / 3' }}
          >
            <video ref={videoRef} className="camera-video" playsInline muted autoPlay aria-label="Live camera preview" />
            {frame && (
              <GridOutline
                grid={grid}
                outline={outlineRect(grid, frame.width, frame.height)}
                phase={outlinePhase}
                corners={auto.corners}
              />
            )}
            {preview === 'live' && galleryReady && (
              <div role="status" aria-live="polite" className={`camera-badge camera-badge--${badge.tone}`}>
                {badge.text}
              </div>
            )}
            {preview === 'starting' && <div className="camera-veil">Starting the camera…</div>}
            {preview === 'live' && !galleryReady && status !== 'error' && (
              <div className="camera-veil">{loadingText(progress)}</div>
            )}
          </div>
          <div className="camera-actions">
            <label className="button button-quiet camera-upload">
              <span>Use a photo instead</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Take a photo of the box"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handlePhoto(file)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      )}

      {preview === 'unavailable' && (
        <div className="camera-capture-card">
          <div className="camera-icon" aria-hidden="true">
            ◎
          </div>
          <h3>{busy ? 'Reading your photo…' : 'Ready when you are'}</h3>
          <p>
            Hold the phone over the open box so the insert fills most of the frame — straight above is best, a tilt is
            fine — and it reads it as a {grid.rows}×{grid.cols} grid.
          </p>
          <label className="button button-accent camera-upload">
            <span>Take a photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take a photo of the box"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handlePhoto(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      )}
    </section>
  )
}

/** What the veil says while the recognizer downloads: a number when the server
 * told us the size, a phase otherwise. */
export function loadingText(p: LoadProgress | null): string {
  if (!p || p.phase === 'ready') return 'Getting the recognizer ready — first time only'
  if (p.phase === 'gallery') return 'Loading the flavor gallery — first time only'
  const mb = (n: number) => (n / 1e6).toFixed(1)
  if (p.total) return `Loading the recognizer — ${mb(p.loaded)} of ${mb(p.total)} MB, first time only`
  return `Loading the recognizer — ${mb(p.loaded)} MB so far, first time only`
}

/** The outline's look: the alignment phases while armed, 'done' once a photo
 * has been taken and the loop is waiting for "Scan again". */
type OutlinePhase = AlignmentPhase | 'done'

/** What the badge over the preview says. Written from the loop's state so the
 * cashier always knows what the camera is waiting for. */
export function badgeFor(
  auto: Pick<AutoCaptureState, 'armed' | 'phase' | 'stableTicks' | 'stableTicksNeeded'>,
  busy: boolean,
  reviewing: boolean,
): { tone: OutlinePhase; text: string } {
  if (busy) return { tone: 'locked', text: '✓ Got it — reading…' }
  if (!auto.armed) {
    return {
      tone: 'done',
      text: reviewing ? '✓ Scanned — confirm below, then Scan again' : '✓ Scanned — tap Scan again for another box',
    }
  }
  if (auto.phase === 'locked') return { tone: 'locked', text: '✓ Got it' }
  if (auto.phase === 'aligning') {
    if (auto.stableTicks === 0) return { tone: 'aligning', text: 'Almost — line the box up with the outline' }
    const dots = '●'.repeat(auto.stableTicks) + '○'.repeat(Math.max(0, auto.stableTicksNeeded - auto.stableTicks))
    return { tone: 'aligning', text: `Hold still… ${dots}` }
  }
  return { tone: 'searching', text: 'Looking for the box…' }
}

function GridOutline({
  grid, outline, phase, corners,
}: { grid: GridSpec; outline: Rect; phase: OutlinePhase; corners: Point[] | null }) {
  const pct = (v: number) => `${v * 100}%`
  return (
    <>
      <div
        className={`camera-outline camera-outline--${phase}`}
        aria-hidden="true"
        style={{ left: pct(outline.x), top: pct(outline.y), width: pct(outline.width), height: pct(outline.height) }}
      >
        {cells(grid, outline).map((c) => (
          <span
            key={`${c.row}-${c.col}`}
            className="camera-outline-cell"
            style={{
              left: pct((c.box.x - outline.x) / outline.width),
              top: pct((c.box.y - outline.y) / outline.height),
              width: pct(c.box.width / outline.width),
              height: pct(c.box.height / outline.height),
            }}
          />
        ))}
      </div>
      {/* Where the app thinks the box actually is, so a bad read is visible. */}
      {corners && (
        <svg className={`camera-fit camera-fit--${phase}`} viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} />
        </svg>
      )}
    </>
  )
}

function PendingRow({ detection, onResolve }: { detection: Detection; onResolve: (flavorId: string | null) => void }) {
  const [choice, setChoice] = useState(detection.flavorId ?? '')
  const suggested = detection.flavorId ? flavorOrPlaceholder(detection.flavorId) : null
  const where = detection.cell ? `Row ${detection.cell.row}, slot ${detection.cell.col}` : null
  return (
    <li>
      {detection.thumbnail ? (
        <img className="pending-thumb" src={detection.thumbnail} alt="" />
      ) : (
        <span className="confidence-dot" />
      )}
      <div className="pending-copy">
        <strong>
          <span>{suggested ? suggested.name : `Unrecognized ("${detection.rawClass}")`}</span>
        </strong>
        <small>
          {Math.round(detection.confidence * 100)}% confidence{where ? ` · ${where}` : ''}
        </small>
      </div>
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Flavor">
        <option value="">Choose a flavor…</option>
        {FLAVORS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <button type="button" className="button button-small button-accent" onClick={() => onResolve(choice || null)} disabled={!choice}>
        Add
      </button>
      <button type="button" className="button button-small button-quiet" onClick={() => onResolve(null)}>
        Skip
      </button>
    </li>
  )
}
