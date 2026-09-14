import { useEffect, useState } from 'react'
import type { BoxSession, BoxSize } from '../../domain/types.ts'
import { BOX_SIZES } from '../../domain/types.ts'
import { addPiece, isComplete, startSession, toRecord, undoLast } from './boxSession.ts'
import { FlavorGrid } from '../layout/FlavorGrid.tsx'
import { loadLayout, saveLayout, swapCells } from '../layout/caseLayout.ts'
import { saveRecord } from '../records/records.ts'

interface BoxScreenProps {
  onSaved?: () => void
}

export function BoxScreen({ onSaved }: BoxScreenProps) {
  const [layout, setLayout] = useState(() => loadLayout())
  const [session, setSession] = useState<BoxSession | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [rearranging, setRearranging] = useState(false)
  const [swapFrom, setSwapFrom] = useState<number | null>(null)

  useEffect(() => {
    if (!session || isComplete(session)) return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [session])

  function pickSize(size: BoxSize) {
    setSession(startSession(size))
    setSavedFlash(null)
  }

  function tapCell(index: number) {
    const flavorId = layout.cells[index]
    if (!flavorId || !session || isComplete(session)) return
    setSession(addPiece(session, flavorId))
  }

  function tapRearrangeCell(index: number) {
    if (swapFrom === null) {
      setSwapFrom(index)
      return
    }
    const next = swapCells(layout, swapFrom, index)
    setLayout(next)
    saveLayout(next)
    setSwapFrom(null)
  }

  function toggleRearrange() {
    setRearranging((on) => !on)
    setSwapFrom(null)
  }

  function cancel() {
    if (session && session.pieces.length > 0) {
      const ok = window.confirm(`Discard this ${session.size}-piece box? ${session.pieces.length} piece(s) already tapped will be lost.`)
      if (!ok) return
    }
    setSession(null)
  }

  function save() {
    if (!session || !isComplete(session)) return
    const record = toRecord(session, now)
    saveRecord(record)
    setSavedFlash(`Saved ${record.size}-piece box in ${(record.durationMs / 1000).toFixed(1)}s`)
    setSession(null)
    onSaved?.()
  }

  if (rearranging) {
    return (
      <section aria-labelledby="rearrange-heading">
        <div className="box-toolbar">
          <h2 id="rearrange-heading">
            {swapFrom === null ? 'Tap a tile, then tap where it should go' : 'Now tap the tile to swap with'}
          </h2>
          <button type="button" onClick={toggleRearrange}>
            Done
          </button>
        </div>
        <FlavorGrid layout={layout} onTapCell={tapRearrangeCell} selectedIndex={swapFrom} />
      </section>
    )
  }

  if (!session) {
    return (
      <section aria-labelledby="pick-size">
        <div className="box-toolbar">
          <h2 id="pick-size">Pick a box size</h2>
          <button type="button" onClick={toggleRearrange}>
            Rearrange case
          </button>
        </div>
        <div className="size-picker">
          {BOX_SIZES.map((size) => (
            <button key={size} type="button" onClick={() => pickSize(size)}>
              {size}
            </button>
          ))}
        </div>
        {savedFlash && <p role="status">{savedFlash}</p>}
      </section>
    )
  }

  const elapsedSeconds = ((now - session.startedAt) / 1000).toFixed(1)
  const complete = isComplete(session)

  return (
    <section aria-labelledby="assemble-heading">
      <div className="box-toolbar">
        <h2 id="assemble-heading">
          {session.pieces.length} / {session.size}
        </h2>
        <p aria-live="polite" className="box-timer">
          {elapsedSeconds}s
        </p>
      </div>
      <FlavorGrid layout={layout} onTapCell={tapCell} disabled={complete} />
      <div className="box-actions">
        <button type="button" onClick={() => setSession(undoLast(session))} disabled={session.pieces.length === 0}>
          Undo
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={!complete}>
          Save box
        </button>
      </div>
    </section>
  )
}
