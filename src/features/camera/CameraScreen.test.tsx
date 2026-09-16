import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraScreen } from './CameraScreen.tsx'
import { startSession } from '../box/boxSession.ts'
import { FLAVORS } from '../../data/flavors.ts'

const [a, b] = FLAVORS
const detectMock = vi.fn()

vi.mock('./config.ts', () => ({
  isCameraModelConfigured: true,
  // 'roboflow' here means "a detector that takes whole photos" — it keeps the
  // screen from trying to preload the on-device gallery, which jsdom can't fetch.
  detectorKind: 'roboflow',
  getDetector: () => ({ detect: detectMock }),
}))

beforeEach(() => {
  detectMock.mockReset()
})

function uploadPhoto() {
  const file = new File(['fake bytes'], 'box.png', { type: 'image/png' })
  const input = screen.getByLabelText('Take a photo of the box')
  fireEvent.change(input, { target: { files: [file] } })
}

describe('CameraScreen', () => {
  it('auto-adds a high-confidence detection and reports how many were added', async () => {
    detectMock.mockResolvedValue([
      { flavorId: a.id, confidence: 0.95, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id },
    ])
    const session = startSession(6, 1000)
    const onSessionChange = vi.fn()
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onClose={vi.fn()} />)

    uploadPhoto()

    await waitFor(() => expect(screen.getByText('Added 1 piece from the photo.')).toBeInTheDocument())
    expect(onSessionChange).toHaveBeenCalled()
    const updated = onSessionChange.mock.calls[0][0]
    expect(updated.pieces).toEqual([expect.objectContaining({ flavorId: a.id, source: 'camera' })])
  })

  it('sends a low-confidence detection to review, and confirming it adds the chosen flavor', async () => {
    detectMock.mockResolvedValue([
      { flavorId: a.id, confidence: 0.4, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id },
    ])
    const session = startSession(6, 1000)
    let current = session
    const onSessionChange = vi.fn((s) => {
      current = s
    })
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onClose={vi.fn()} />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByText('Please confirm')).toBeInTheDocument())
    expect(screen.getByText(new RegExp(a.name), { selector: 'span' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(current.pieces).toEqual([expect.objectContaining({ flavorId: a.id, source: 'camera' })])
    expect(screen.queryByText('Please confirm')).not.toBeInTheDocument()
  })

  it('skipping a pending detection does not add anything', async () => {
    detectMock.mockResolvedValue([
      { flavorId: b.id, confidence: 0.4, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: b.id },
    ])
    const session = startSession(6, 1000)
    const onSessionChange = vi.fn()
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onClose={vi.fn()} />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByText('Please confirm')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSessionChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Please confirm')).not.toBeInTheDocument()
  })

  it('shows a clear error if detection fails, instead of silently doing nothing', async () => {
    detectMock.mockRejectedValue(new Error('Roboflow inference failed: 500 Internal Server Error'))
    render(<CameraScreen session={startSession(6, 1000)} onSessionChange={vi.fn()} onClose={vi.fn()} />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/500/))
  })
})
