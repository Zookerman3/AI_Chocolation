import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { BoxScreen } from './BoxScreen.tsx'
import { listRecords } from '../records/records.ts'
import { loadLayout } from '../layout/caseLayout.ts'
import { FLAVORS } from '../../data/flavors.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('BoxScreen', () => {
  it('assembles a full 6-piece box by tapping tiles, saves it, and records it', () => {
    render(<BoxScreen />)

    fireEvent.click(screen.getByRole('button', { name: '6' }))
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

  it('undo removes the last tapped piece', () => {
    render(<BoxScreen />)
    fireEvent.click(screen.getByRole('button', { name: '6' }))

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
})
