import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoxSession } from '../../domain/types.ts'
import type { Detection } from './types.ts'
import { applyDetections, confirmDetection } from './applyDetections.ts'
import { detectorKind, getDetector } from './config.ts'
import { FLAVORS, flavorOrPlaceholder } from '../../data/flavors.ts'
import { cells, gridFor, outlineRect } from './grid.ts'
import type { GridSpec, Rect } from './grid.ts'
import { loadGallery } from './gallery.ts'

interface CameraScreenProps {
  session: BoxSession
  onSessionChange: (session: BoxSession) => void
  onClose: () => void
}

type PreviewState = 'starting' | 'live' | 'unavailable'

/** Live rear-camera preview with the grid outline drawn over it. Falls back to the
 * OS camera (a file input) where getUserMedia isn't available — an http:// dev
 * server on a phone, an old browser, or a denied permission. */
function useCameraPreview(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
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
    media
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        video.onloadedmetadata = () => {
          setFrame({ width: video.videoWidth, height: video.videoHeight })
          setState('live')
          void video.play().catch(() => setState('unavailable'))
        }
      })
      .catch(() => setState('unavailable'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [enabled])

  return { videoRef, state, frame }
}

export function CameraScreen({ session, onSessionChange, onClose }: CameraScreenProps) {
  const grid = gridFor(session.size)
  const [status, setStatus] = useState<'idle' | 'detecting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Detection[]>([])
  const [overflowed, setOverflowed] = useState<Detection[]>([])
  const [addedCount, setAddedCount] = useState(0)
  const [galleryReady, setGalleryReady] = useState(detectorKind !== 'local')
  const { videoRef, state: preview, frame } = useCameraPreview(grid !== null)

  // Warm the gallery while the cashier is still lining the box up, so the first
  // capture doesn't pay for the fetch. ~0.7 MB, precached after the first visit.
  useEffect(() => {
    if (detectorKind !== 'local') return
    let live = true
    loadGallery()
      .then(() => live && setGalleryReady(true))
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
        setStatus('idle')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that photo.')
        setStatus('error')
      }
    },
    [grid, session, onSessionChange],
  )

  function capture() {
    const video = videoRef.current
    if (!video || !frame) return
    const canvas = document.createElement('canvas')
    canvas.width = frame.width
    canvas.height = frame.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, frame.width, frame.height)
    // Through a Blob so the live path and the file-input path are one code path.
    canvas.toBlob((blob) => {
      if (blob) void handlePhoto(blob)
    }, 'image/jpeg', 0.92)
  }

  function resolvePending(detection: Detection, chosenFlavorId: string | null) {
    if (chosenFlavorId) {
      onSessionChange(confirmDetection(session, detection, chosenFlavorId))
      setAddedCount((n) => n + 1)
    }
    setPending((list) => list.filter((d) => d !== detection))
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
          <button type="button" className="button button-dark" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    )
  }

  const busy = status === 'detecting'
  const canCapture = preview === 'live' && galleryReady && !busy

  return (
    <section aria-labelledby="camera-heading" className="camera-screen panel">
      <div className="box-toolbar">
        <div>
          <p className="eyebrow">Camera assist · {grid.rows}×{grid.cols} insert</p>
          <h2 id="camera-heading">Scan the box</h2>
          <p className="helper-text">
            Line the insert up with the outline, then capture. Anything the camera isn't sure about comes back for one
            tap.
          </p>
        </div>
        <button type="button" className="button button-dark" onClick={onClose}>
          Done
        </button>
      </div>

      {preview !== 'unavailable' && (
        <div className="camera-live">
          <div
            className="camera-frame"
            style={frame ? { aspectRatio: `${frame.width} / ${frame.height}` } : { aspectRatio: '4 / 3' }}
          >
            <video ref={videoRef} className="camera-video" playsInline muted autoPlay aria-label="Live camera preview" />
            {frame && <GridOutline grid={grid} outline={outlineRect(grid, frame.width, frame.height)} />}
            {preview === 'starting' && <div className="camera-veil">Starting the camera…</div>}
            {preview === 'live' && !galleryReady && status !== 'error' && (
              <div className="camera-veil">Getting the flavor gallery ready — first time only</div>
            )}
          </div>
          <div className="camera-actions">
            <button type="button" className="button button-accent" onClick={capture} disabled={!canCapture}>
              {busy ? 'Reading…' : 'Capture'}
            </button>
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
            Hold the phone straight above the open box and fill the frame with the insert — the camera reads it as a{' '}
            {grid.rows}×{grid.cols} grid.
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
    </section>
  )
}

function GridOutline({ grid, outline }: { grid: GridSpec; outline: Rect }) {
  const pct = (v: number) => `${v * 100}%`
  return (
    <div
      className="camera-outline"
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
