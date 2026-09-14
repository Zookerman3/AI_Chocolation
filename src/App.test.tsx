import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App.tsx'
import { listRecords } from './features/records/records.ts'
import { FLAVORS } from './data/flavors.ts'

beforeEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('renders the app heading and starts on the box screen', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'AI Chocolation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pick a box size' })).toBeInTheDocument()
  })

  it('switches to the records screen', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText('No boxes saved yet.')).toBeInTheDocument()
  })

  it('demo mode fills in records and stats, then clears them back out', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText(/Saved boxes \(24\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    expect(screen.getByText(/Saved boxes \(0\)/)).toBeInTheDocument()
  })

  it('never loses a real saved box across a demo mode toggle', () => {
    render(<App />)

    // save one real box
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    const tile = screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) })
    for (let i = 0; i < 6; i++) fireEvent.click(tile)
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }))
    expect(listRecords()).toHaveLength(1)

    // demo mode shows only the 24 demo boxes, not 25
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText(/Saved boxes \(24\) · demo/)).toBeInTheDocument()

    // the real box was never touched by entering/exiting demo mode
    expect(listRecords()).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Demo mode' }))
    expect(screen.getByText(/Saved boxes \(1\)/)).toBeInTheDocument()
    expect(listRecords()).toHaveLength(1)
  })
})
