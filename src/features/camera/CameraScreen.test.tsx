import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { badgeFor, CameraScreen } from './CameraScreen.tsx'
import { startSession } from '../box/boxSession.ts'
import { FLAVORS } from '../../data/flavors.ts'
import { outlineHomography } from './gridFinder.ts'
import { outlineRect } from './grid.ts'

const [a, b] = FLAVORS
const detectMock = vi.fn()
const grabFrameMock = vi.fn()
const findGridMock = vi.fn()

vi.mock('./config.ts', () => ({
  isCameraModelConfigured: true,
  // 'roboflow' here means "a detector that takes whole photos" — it keeps the
  // screen from trying to preload the on-device gallery, which jsdom can't fetch.
  detectorKind: 'roboflow',
  getDetector: () => ({ detect: detectMock }),
  preloadRecognizer: () => new Promise(() => {}),
}))

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

  // Two overlapping requests for the same lens is how the preview ends up dead
  // and the cashier opens the screen twice to get a picture. StrictMode mounts
  // every effect twice in dev, so without the shared stream this asks the camera
  // for a second lens while the first is still being handed over.
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

    it('takes the photo itself once the box is lined up and held still — and only once', async () => {
      vi.useFakeTimers()
      try {
        const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
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
        render(<CameraScreen session={startSession(16, 1000)} onSessionChange={onSessionChange} onManual={vi.fn()} />)

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

        // Until the cashier asks for another box.
        fireEvent.click(screen.getByRole('button', { name: /scan again/i }))
        await act(async () => {
          vi.advanceTimersByTime(250 * 3)
          await Promise.resolve()
          await Promise.resolve()
          await Promise.resolve()
        })
        expect(detectMock).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('the badge over the preview', () => {
    const base = { armed: true, phase: 'searching' as const, stableTicks: 0, stableTicksNeeded: 3 }

    it('says what the loop is waiting for', () => {
      expect(badgeFor(base, false, false).text).toMatch(/looking for the box/i)
      expect(badgeFor({ ...base, phase: 'aligning' }, false, false).text).toMatch(/line the box up/i)
      expect(badgeFor({ ...base, phase: 'aligning', stableTicks: 2 }, false, false).text).toBe('Hold still… ●●○')
      expect(badgeFor({ ...base, phase: 'locked' }, false, false)).toEqual({ tone: 'locked', text: '✓ Got it' })
    })

    it('reads as done once a photo has been taken, and says where the review is', () => {
      expect(badgeFor({ ...base, armed: false }, true, false).text).toMatch(/reading/i)
      expect(badgeFor({ ...base, armed: false }, false, true).text).toMatch(/confirm below/i)
      expect(badgeFor({ ...base, armed: false }, false, false).text).toMatch(/scan again/i)
    })
  })
})
