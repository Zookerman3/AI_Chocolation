import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraScreen } from './CameraScreen.tsx'
import { addPiece, startSession } from '../box/boxSession.ts'
import { FLAVORS } from '../../data/flavors.ts'
import { outlineHomography } from './gridFinder.ts'
import { outlineRect } from './grid.ts'

const [a, b] = FLAVORS
const detectMock = vi.fn()
const grabFrameMock = vi.fn()
const findGridMock = vi.fn()

// jsdom has no canvas: the pixels come from these instead. By default the
// analysis loop sees no frame and the tests below drive the file input.
vi.mock('./frameGrab.ts', () => ({
  grabAnalysisFrame: (...args: unknown[]) => grabFrameMock(...args),
  grabPhotoBlob: () => Promise.resolve(new Blob(['fake jpeg'], { type: 'image/jpeg' })),
}))
vi.mock('./gridFinder.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gridFinder.ts')>()
  return { ...actual, findGrid: (...args: unknown[]) => findGridMock(...args) }
})

vi.mock('./config.ts', () => ({
  isCameraModelConfigured: true,
  // 'roboflow' here means "a detector that takes whole photos" — it keeps the
  // screen from trying to preload the on-device gallery, which jsdom can't fetch.
  detectorKind: 'roboflow',
  getDetector: () => ({ detect: detectMock }),
  preloadRecognizer: () => new Promise(() => {}),
}))

beforeEach(() => {
  detectMock.mockReset()
  grabFrameMock.mockReset().mockReturnValue(null)
  findGridMock.mockReset().mockReturnValue(null)
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
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onManual={vi.fn()} />)

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
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onManual={vi.fn()} />)

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
    render(<CameraScreen session={session} onSessionChange={onSessionChange} onManual={vi.fn()} />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByText('Please confirm')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onSessionChange).not.toHaveBeenCalled()
    expect(screen.queryByText('Please confirm')).not.toBeInTheDocument()
  })

  it('a second photo of the same box does not add its pieces again, and says so', async () => {
    // The screen gets its session from the parent, so give it a real one that updates.
    function Harness() {
      const [session, setSession] = useState(() => startSession(6, 1000))
      return (
        <>
          <span data-testid="count">{session.pieces.length}</span>
          <CameraScreen session={session} onSessionChange={setSession} onManual={vi.fn()} />
        </>
      )
    }
    detectMock.mockResolvedValue([
      { flavorId: a.id, confidence: 0.95, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id, cell: { row: 1, col: 1 } },
      { flavorId: a.id, confidence: 0.95, box: { x: 0.2, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id, cell: { row: 1, col: 2 } },
    ])
    render(<Harness />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))

    uploadPhoto()
    await waitFor(() => expect(screen.getByText(/already counted from an earlier photo/)).toBeInTheDocument())
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(screen.getByText(/2 pieces were already counted/)).toBeInTheDocument()
  })

  it('shows a clear error if detection fails, instead of silently doing nothing', async () => {
    detectMock.mockRejectedValue(new Error('Roboflow inference failed: 500 Internal Server Error'))
    render(<CameraScreen session={startSession(6, 1000)} onSessionChange={vi.fn()} onManual={vi.fn()} />)

    uploadPhoto()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/500/))
  })

  it('the "Pick manually" button at the top hands control back to the tile grid', () => {
    const onManual = vi.fn()
    render(<CameraScreen session={startSession(6, 1000)} onSessionChange={vi.fn()} onManual={onManual} />)

    fireEvent.click(screen.getByRole('button', { name: /Pick manually/ }))
    expect(onManual).toHaveBeenCalledOnce()
  })

  it('hands over to the tally by itself once a photo has filled the box', async () => {
    const piece = { flavorId: a.id, confidence: 0.95, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id }
    detectMock.mockResolvedValue(Array.from({ length: 6 }, () => ({ ...piece })))
    const onComplete = vi.fn()
    let current = startSession(6, 1000)
    render(
      <CameraScreen
        session={current}
        onSessionChange={(s) => {
          current = s
        }}
        onManual={vi.fn()}
        onComplete={onComplete}
      />,
    )

    uploadPhoto()
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(current.pieces).toHaveLength(6)
  })

  it('hands over when confirming a review row is what fills the box', async () => {
    let current = startSession(6, 1000)
    for (let i = 0; i < 5; i++) current = addPiece(current, a.id)
    detectMock.mockResolvedValue([
      { flavorId: b.id, confidence: 0.4, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: b.id, cell: { row: 1, col: 6 } },
    ])
    const onComplete = vi.fn()
    render(
      <CameraScreen
        session={current}
        onSessionChange={(s) => {
          current = s
        }}
        onManual={vi.fn()}
        onComplete={onComplete}
      />,
    )

    uploadPhoto()
    await waitFor(() => expect(screen.getByText('Please confirm')).toBeInTheDocument())
    expect(onComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(current.pieces).toHaveLength(6)
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('stays on the camera while the box is still short, with the result above the capture card', async () => {
    detectMock.mockResolvedValue([
      { flavorId: a.id, confidence: 0.95, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id },
    ])
    const onComplete = vi.fn()
    render(<CameraScreen session={startSession(6, 1000)} onSessionChange={vi.fn()} onManual={vi.fn()} onComplete={onComplete} />)

    uploadPhoto()
    const note = await screen.findByText('Added 1 piece from the photo.')
    expect(onComplete).not.toHaveBeenCalled()
    // The note comes first in the document, so it is never below the fold.
    const card = screen.getByText('Ready when you are')
    expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Two overlapping requests for the same lens is how the preview ends up dead
  // and the cashier opens the screen twice to get a picture. StrictMode mounts
  // every effect twice in dev, so without the shared stream this asks the camera
  // for a second lens while the first is still being handed over.
  it('takes the photo itself once the box is lined up and held still — and only once', async () => {
    // The screen shares one camera stream at module scope, so this test has to
    // hand it back before the next one asks for it — hence the unmount and the
    // wait past RELEASE_DELAY_MS in `finally`.
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    let unmount: (() => void) | undefined
    vi.useFakeTimers()
    try {
      const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
      detectMock.mockResolvedValue([
        { flavorId: a.id, confidence: 0.95, box: { x: 0, y: 0, width: 0.1, height: 0.1 }, rawClass: a.id },
      ])
      // The loop sees a 480x360 frame with the 4x4 lattice sitting exactly on the outline.
      const grid = { rows: 4, cols: 4 }
      const outline = outlineRect(grid, 480, 360)
      grabFrameMock.mockReturnValue({ data: new Uint8ClampedArray(480 * 360 * 4), width: 480, height: 360 })
      findGridMock.mockReturnValue({
        homography: outlineHomography(grid, outline), landmarks: 12, inliers: 10, pitch: outline.width / 4,
      })

      const onSessionChange = vi.fn()
      unmount = render(
        <CameraScreen session={startSession(16, 1000)} onSessionChange={onSessionChange} onManual={vi.fn()} />,
      ).unmount

      // Let the camera promise settle, then tell the <video> it has a frame.
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      const video = document.querySelector('video')!
      Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true })
      Object.defineProperty(video, 'videoHeight', { value: 1440, configurable: true })
      act(() => {
        video.dispatchEvent(new Event('loadedmetadata'))
      })
      expect(screen.getByText(/looking for the box/i)).toBeInTheDocument()

      // Three steady readings, then the photo is taken without a tap.
      await act(async () => {
        vi.advanceTimersByTime(250 * 3)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(detectMock).toHaveBeenCalledTimes(1)

      // Latched: more steady frames do not read the box again.
      await act(async () => {
        vi.advanceTimersByTime(250 * 10)
        await Promise.resolve()
      })
      expect(detectMock).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: /scan again/i })).toBeInTheDocument()
    } finally {
      // Give the stream back: unmount schedules the release, the timers run it.
      await act(async () => {
        unmount?.()
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
      })
      vi.useRealTimers()
      playSpy.mockRestore()
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'mediaDevices')
    }
  })

  describe('opening the screen', () => {
    const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

    afterEach(() => {
      if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
      else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'mediaDevices')
    })

    it('asks for the camera once, even though StrictMode mounts the screen twice', async () => {
      const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })

      render(
        <StrictMode>
          <CameraScreen session={startSession(16, 1000)} onSessionChange={vi.fn()} onManual={vi.fn()} />
        </StrictMode>,
      )

      await waitFor(() => expect(getUserMedia).toHaveBeenCalled())
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    })
  })
})
