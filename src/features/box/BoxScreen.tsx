import { useEffect, useState } from 'react'
import type { BoxSession, BoxSize } from '../../domain/types.ts'
import { BOX_SIZES } from '../../domain/types.ts'
import { addPiece, isComplete, removeOne, startSession, tally, toRecord, undoLast } from './boxSession.ts'
import { FlavorGrid } from '../layout/FlavorGrid.tsx'
import { defaultLayout, loadLayout, saveLayout, swapCells } from '../layout/caseLayout.ts'
import { saveRecord } from '../records/records.ts'
import { getFlavor } from '../../data/flavors.ts'
import { CameraScreen } from '../camera/CameraScreen.tsx'

interface BoxScreenProps { onSaved?: () => void }

export function BoxScreen({ onSaved }: BoxScreenProps) {
  const [layout, setLayout] = useState(() => loadLayout())
  const [session, setSession] = useState<BoxSession | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [rearranging, setRearranging] = useState(false)
  const [swapFrom, setSwapFrom] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [showCamera, setShowCamera] = useState(false)

  useEffect(() => {
    if (!session || isComplete(session)) return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [session])

  function pickSize(size: BoxSize) { setSession(startSession(size)); setSavedFlash(null); setQuery(''); setShowCamera(false) }
  function tapCell(index: number) { const flavorId = layout.cells[index]; if (!flavorId || !session || isComplete(session)) return; setSession(addPiece(session, flavorId)) }
  function tapRearrangeCell(index: number) { if (swapFrom === null) { setSwapFrom(index); return }; const next = swapCells(layout, swapFrom, index); setLayout(next); saveLayout(next); setSwapFrom(null) }
  function toggleRearrange() { setRearranging((on) => !on); setSwapFrom(null) }
  function resetLayout() { if (!window.confirm('Reset the case layout to the default order? Your rearranged positions will be lost.')) return; const next = defaultLayout(); setLayout(next); saveLayout(next); setSwapFrom(null) }
  function cancel() { if (session && session.pieces.length > 0) { const ok = window.confirm(`Discard this ${session.size}-piece box? ${session.pieces.length} piece(s) already tapped will be lost.`); if (!ok) return }; setSession(null) }
  function save() { if (!session || !isComplete(session)) return; const record = toRecord(session, now); saveRecord(record); setSavedFlash(`Saved ${record.size}-piece box in ${(record.durationMs / 1000).toFixed(1)}s`); setSession(null); onSaved?.() }

  if (rearranging) return <section aria-labelledby="rearrange-heading" className="panel"><div className="box-toolbar"><div><p className="eyebrow">Case setup</p><h2 id="rearrange-heading">{swapFrom === null ? 'Arrange your case' : 'Choose the swap tile'}</h2><p className="helper-text">{swapFrom === null ? 'Tap a tile, then tap where it should go.' : 'Tap another tile to exchange their places.'}</p></div><div className="box-toolbar-actions"><button type="button" className="button button-quiet" onClick={resetLayout}>Reset to default</button><button type="button" className="button button-dark" onClick={toggleRearrange}>Done</button></div></div><FlavorGrid layout={layout} onTapCell={tapRearrangeCell} selectedIndex={swapFrom} /></section>

  if (!session) return <section aria-labelledby="pick-size" className="welcome-panel"><div className="welcome-copy"><p className="eyebrow">New order</p><h2 id="pick-size" aria-label="Pick a box size">Build a beautiful box.</h2><p>Choose a size to start recording the flavors your customer picked.</p></div><div className="size-picker">{BOX_SIZES.map((size) => <button key={size} type="button" aria-label={String(size)} onClick={() => pickSize(size)}><strong>{size}</strong><span>pieces</span></button>)}</div><div className="entry-footer"><button type="button" aria-label="Rearrange case" className="button button-quiet" onClick={toggleRearrange}>⚙ Rearrange case</button>{savedFlash && <p role="status" className="success-note">✓ {savedFlash}</p>}</div></section>

  if (showCamera) return <CameraScreen session={session} onSessionChange={setSession} onClose={() => setShowCamera(false)} />

  const elapsedSeconds = ((now - session.startedAt) / 1000).toFixed(1)
  const complete = isComplete(session)
  const currentTally = tally(session)
  const remaining = session.size - session.pieces.length

  return <section aria-labelledby="assemble-heading" className="assembly-layout">
    <div className="assembly-main">
      <div className="box-toolbar"><div><p className="eyebrow">Live box</p><h2 id="assemble-heading" aria-label={`${session.pieces.length} / ${session.size}`}>Pick the flavors</h2></div><div className="timer-pill"><span className="pulse-dot" /> {elapsedSeconds}s</div></div>
      <div className={`progress-card ${complete ? 'is-complete' : ''}`}><div><span className="progress-label">{complete ? 'Box ready to save' : 'Pieces selected'}</span><strong>{session.pieces.length}<small> / {session.size}</small></strong></div><div className="progress-track"><span style={{ width: `${(session.pieces.length / session.size) * 100}%` }} /></div><span className="remaining-label">{complete ? 'All set!' : `${remaining} left`}</span></div>
      <div className="grid-toolbar"><label className="search-wrap"><span aria-hidden="true">⌕</span><input type="search" className="flavor-search" placeholder="Find a flavor…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a flavor" /></label><span className="tap-hint">Tap a chocolate to add it</span></div>
      <FlavorGrid layout={layout} onTapCell={tapCell} disabled={complete} query={query} />
    </div>
    <aside className="tally-panel"><div className="tally-header"><div><p className="eyebrow">Your box</p><h3>{currentTally.length === 0 ? 'Nothing picked yet' : `${currentTally.length} flavor${currentTally.length === 1 ? '' : 's'}`}</h3></div><span className="tally-count">{session.pieces.length}/{session.size}</span></div>{currentTally.length === 0 ? <div className="empty-tally"><span aria-hidden="true">✦</span><p>Start with a favorite<br />from the case.</p></div> : <ul className="box-tally">{currentTally.map(({ flavorId, count }) => <li key={flavorId}><span className="tally-swatch" style={{ backgroundImage: `url(${getFlavor(flavorId).imageUrl})` }} /><span className="box-tally-name">{getFlavor(flavorId).name}</span><button type="button" className="box-tally-step" aria-label={`Remove one ${getFlavor(flavorId).name}`} onClick={() => setSession(removeOne(session, flavorId))}>−</button><span className="box-tally-count">×{count}</span><button type="button" className="box-tally-step" aria-label={`Add one more ${getFlavor(flavorId).name}`} disabled={complete} onClick={() => setSession(addPiece(session, flavorId))}>+</button></li>)}</ul>}
      <div className="box-actions"><button type="button" className="button button-light" onClick={() => setShowCamera(true)} disabled={complete}>◎ Use camera</button><button type="button" aria-label="Undo" className="button button-light" onClick={() => setSession(undoLast(session))} disabled={session.pieces.length === 0}>↶ Undo</button><button type="button" className="button button-quiet" onClick={cancel}>Cancel</button><button type="button" className="button button-accent" onClick={save} disabled={!complete}>Save box <span aria-hidden="true">→</span></button></div>
    </aside>
  </section>
}
