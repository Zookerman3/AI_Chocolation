import { useState } from 'react'
import type { BoxSession } from '../../domain/types.ts'
import type { Detection } from './types.ts'
import { applyDetections, confirmDetection } from './applyDetections.ts'
import { getDetector, isCameraModelConfigured } from './config.ts'
import { FLAVORS, getFlavor } from '../../data/flavors.ts'

interface CameraScreenProps {
  session: BoxSession
  onSessionChange: (session: BoxSession) => void
  onClose: () => void
}

export function CameraScreen({ session, onSessionChange, onClose }: CameraScreenProps) {
  const [status, setStatus] = useState<'idle' | 'detecting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Detection[]>([])
  const [overflowed, setOverflowed] = useState<Detection[]>([])
  const [addedCount, setAddedCount] = useState(0)

  async function handlePhoto(file: File) {
    setStatus('detecting')
    setError(null)
    try {
      const detections = await getDetector().detect(file)
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
  }

  function resolvePending(detection: Detection, chosenFlavorId: string | null) {
    if (chosenFlavorId) {
      onSessionChange(confirmDetection(session, detection, chosenFlavorId))
      setAddedCount((n) => n + 1)
    }
    setPending((list) => list.filter((d) => d !== detection))
  }

  return (
    <section aria-labelledby="camera-heading" className="camera-screen">
      <div className="box-toolbar">
        <h2 id="camera-heading">Photo the box</h2>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>

      {!isCameraModelConfigured && (
        <p className="camera-banner">
          No camera model is set up yet (see <code>.env.example</code>) — this won't detect anything real until
          one is. The flow below is fully wired and ready for when it is.
        </p>
      )}

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

      {status === 'detecting' && <p role="status">Reading the photo…</p>}
      {status === 'error' && (
        <p role="alert" className="camera-error">
          {error}
        </p>
      )}

      {status === 'idle' && addedCount > 0 && (
        <p role="status">
          Added {addedCount} piece{addedCount === 1 ? '' : 's'} from the photo.
        </p>
      )}

      {overflowed.length > 0 && (
        <p className="camera-banner">
          {overflowed.length} more detected piece{overflowed.length === 1 ? '' : 's'} didn't fit — the box is
          already full.
        </p>
      )}

      {pending.length > 0 && (
        <div>
          <h3>Please confirm</h3>
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

function PendingRow({ detection, onResolve }: { detection: Detection; onResolve: (flavorId: string | null) => void }) {
  const [choice, setChoice] = useState(detection.flavorId ?? '')
  const suggested = detection.flavorId ? getFlavor(detection.flavorId) : null

  return (
    <li>
      <span>
        {suggested ? suggested.name : `Unrecognized (“${detection.rawClass}”)`} ·{' '}
        {Math.round(detection.confidence * 100)}%
      </span>
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Flavor">
        <option value="">Choose a flavor…</option>
        {FLAVORS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => onResolve(choice || null)} disabled={!choice}>
        Add
      </button>
      <button type="button" onClick={() => onResolve(null)}>
        Skip
      </button>
    </li>
  )
}
