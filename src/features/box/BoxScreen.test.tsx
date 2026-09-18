import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BoxScreen } from './BoxScreen.tsx'
import { listRecords } from '../records/records.ts'
import { defaultLayout, loadLayout } from '../layout/caseLayout.ts'
import { FLAVORS } from '../../data/flavors.ts'

// Sizes with a measured insert (6, 10, 16, 30) go straight to the camera when
// picked, same as the live app. These tests are about the tile grid, so pick a
// size and immediately switch back with the camera's own "Pick manually"
// button — exactly the escape hatch a cashier would use.
vi.mock('../camera/config.ts', () => ({
  isCameraModelConfigured: true,
  detectorKind: 'roboflow',
  getDetector: () => ({ detect: vi.fn().mockResolvedValue([]) }),
  preloadRecognizer: () => new Promise(() => {}),
}))

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Picks a box size and lands on the tile grid: every offered size has a
 * measured insert and opens the camera first, so this taps its "Pick manually"
 * button (kept tolerant of a size that goes straight to the tiles). */
function pickSizeManually(size: string) {
  fireEvent.click(screen.getByRole('button', { name: size }))
  const manual = screen.queryByRole('button', { name: /Pick manually/ })
  if (manual) fireEvent.click(manual)
}

describe('BoxScreen', () => {
  it('assembles a full 6-piece box by tapping tiles, saves it, and records it', () => {
    render(<BoxScreen />)

    pickSizeManually('6')
    expect(screen.getByRole('heading', { name: '0 / 6' })).toBeInTheDocument()

    const firstFlavor = FLAVORS[0]
    const tile = screen.getByRole('button', { name: new RegExp(firstFlavor.name) })

    for (let i = 0; i < 6; i++) fireEvent.click(tile)
    expect(screen.getByRole('heading', { name: '6 / 6' })).toBeInTheDocument()

    const saveButton = screen.getByRole('button', { name: 'Save box' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    const records = listRecords()
    expect(records).toHaveLength(1)
    expect(records[0].size).toBe(6)
    expect(records[0].pieces).toEqual([{ flavorId: firstFlavor.id, count: 6 }])
    expect(records[0].demo).toBe(false)

    // back at the size picker, with a confirmation of what just saved
    expect(screen.getByRole('heading', { name: 'Pick a box size' })).toBeInTheDocument()
    expect(screen.getByText(/Saved 6-piece box in/)).toBeInTheDocument()
  })

  it('once the box is full, the tile grid gives way to the list of what was picked', () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    const [a, b] = FLAVORS
    const tile = screen.getByRole('button', { name: new RegExp(a.name) })
    for (let i = 0; i < 6; i++) fireEvent.click(tile)

    // no grid, no tap hint — just the tally and Save
    expect(screen.queryByText('Tap a chocolate to add it')).not.toBeInTheDocument()
    expect(screen.queryByText(b.name, { selector: '.flavor-name' })).not.toBeInTheDocument()
    expect(screen.getByText('×6')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save box' })).not.toBeDisabled()

    // taking one out brings the grid back
    fireEvent.click(screen.getByRole('button', { name: `Remove one ${a.name}` }))
    expect(screen.getByText('Tap a chocolate to add it')).toBeInTheDocument()
    expect(screen.getByText(b.name, { selector: '.flavor-name' })).toBeInTheDocument()
  })

  it('picking a size with a measured insert opens the camera first', () => {
    render(<BoxScreen />)
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    expect(screen.getByRole('heading', { name: 'Scan the box' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Pick manually/ }))
    expect(screen.getByRole('heading', { name: '0 / 6' })).toBeInTheDocument()
  })

  it('offers 6, 10, 16 and 30 — the 50-piece box is not on the picker', () => {
    render(<BoxScreen />)
    expect(screen.queryByRole('button', { name: '50' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^(6|10|16|30)$/ })).toHaveLength(4)
  })

  it('has no flavor search bar', () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    expect(screen.queryByPlaceholderText('Find a flavor…')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Find a flavor')).not.toBeInTheDocument()
  })

  it('undo removes the last tapped piece', () => {
    render(<BoxScreen />)
    pickSizeManually('6')

    const [a, b] = FLAVORS
    fireEvent.click(screen.getByRole('button', { name: new RegExp(a.name) }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.name) }))
    expect(screen.getByRole('heading', { name: '2 / 6' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('heading', { name: '1 / 6' })).toBeInTheDocument()
  })

  it('rearrange mode swaps two grid positions instead of adding pieces to a box', () => {
    render(<BoxScreen />)
    const before = loadLayout()
    const [a, b] = FLAVORS // default layout places these at cells 0 and 1

    fireEvent.click(screen.getByRole('button', { name: 'Rearrange case' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(a.name) }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.name) }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    const after = loadLayout()
    expect(before.cells[0]).toBe(a.id)
    expect(before.cells[1]).toBe(b.id)
    expect(after.cells[0]).toBe(b.id)
    expect(after.cells[1]).toBe(a.id)
  })

  it('handles the largest offered box (30 pieces, tapped one at a time)', () => {
    render(<BoxScreen />)
    pickSizeManually('30')

    const tile = screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) })
    for (let i = 0; i < 30; i++) fireEvent.click(tile)
    expect(screen.getByRole('heading', { name: '30 / 30' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save box' }))
    expect(listRecords()[0].pieces).toEqual([{ flavorId: FLAVORS[0].id, count: 30 }])
  })

  it('asks for confirmation before discarding a box with pieces already tapped', () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) }))

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirmSpy).toHaveBeenCalledOnce()
    // declined the confirm, so the box is still in progress
    expect(screen.getByRole('heading', { name: '1 / 6' })).toBeInTheDocument()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Pick a box size' })).toBeInTheDocument()
  })

  it('cancels an empty box without asking for confirmation', () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    const confirmSpy = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Pick a box size' })).toBeInTheDocument()
  })

  it('the running tally shows per-flavor counts, and its + button adds without re-tapping the tile', () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    const [a] = FLAVORS
    fireEvent.click(screen.getByRole('button', { name: new RegExp(a.name) }))

    expect(screen.getByText(a.name, { selector: '.box-tally-name' })).toBeInTheDocument()
    expect(screen.getByText('×1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: `Add one more ${a.name}` }))
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2 / 6' })).toBeInTheDocument()
  })

  it("the tally's − button removes one of that flavor specifically, leaving others alone", () => {
    render(<BoxScreen />)
    pickSizeManually('6')
    const [a, b] = FLAVORS
    // grab both tile buttons once, before any tally chips exist to make the name ambiguous
    const tileA = screen.getByRole('button', { name: new RegExp(a.name) })
    const tileB = screen.getByRole('button', { name: new RegExp(b.name) })
    fireEvent.click(tileA)
    fireEvent.click(tileB)
    fireEvent.click(tileA)
    expect(screen.getByRole('heading', { name: '3 / 6' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: `Remove one ${a.name}` }))
    expect(screen.getByRole('heading', { name: '2 / 6' })).toBeInTheDocument()
    // a went from x2 to x1, b is untouched at x1 — both tally chips now read "×1"
    const counts = screen.getAllByText(/×\d/)
    expect(counts).toHaveLength(2)
    expect(counts.map((el) => el.textContent)).toEqual(['×1', '×1'])
  })

  it('resets a rearranged case layout back to default', () => {
    render(<BoxScreen />)
    const [a, b] = FLAVORS

    fireEvent.click(screen.getByRole('button', { name: 'Rearrange case' }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(a.name) }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(b.name) }))
    expect(loadLayout().cells[0]).toBe(b.id)

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(loadLayout()).toEqual(defaultLayout())
  })
})
