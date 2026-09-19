import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { listRecords } from './features/records/records.ts'
import { FLAVORS } from './data/flavors.ts'

// Sizes with a measured insert open the camera first; these tests exercise the
// tile grid, not the camera, so keep the on-device recognizer out of it.
vi.mock('./features/camera/config.ts', () => ({
  isCameraModelConfigured: true,
  detectorKind: 'roboflow',
  getDetector: () => ({ detect: vi.fn().mockResolvedValue([]) }),
  preloadRecognizer: () => new Promise(() => {}),
}))

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

  it('has no demo switch: what Records shows is what was saved', () => {
    render(<App />)
    expect(screen.queryByRole('checkbox', { name: 'Demo mode' })).not.toBeInTheDocument()

    // save one real box
    fireEvent.click(screen.getByRole('button', { name: '6' }))
    fireEvent.click(screen.getByRole('button', { name: /Pick manually/ }))
    const tile = screen.getByRole('button', { name: new RegExp(FLAVORS[0].name) })
    for (let i = 0; i < 6; i++) fireEvent.click(tile)
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }))
    expect(listRecords()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Records' }))
    expect(screen.getByText(/Saved boxes \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument()
  })
})
