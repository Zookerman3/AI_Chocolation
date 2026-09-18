import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { outlineHomography } from './gridFinder.ts'
import type { GridFit } from './gridFinder.ts'
import { outlineRect } from './grid.ts'
import { useAutoCapture } from './useAutoCapture.ts'

const grabMock = vi.fn()
const findGridMock = vi.fn()

vi.mock('./frameGrab.ts', () => ({
  grabAnalysisFrame: (...args: unknown[]) => grabMock(...args),
  grabPhotoBlob: () => Promise.resolve(null),
}))
vi.mock('./gridFinder.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gridFinder.ts')>()
  return { ...actual, findGrid: (...args: unknown[]) => findGridMock(...args) }
})

const grid = { rows: 4, cols: 4 }
const W = 480
const H = 360
const frame = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H }
const outline = outlineRect(grid, W, H)
const cellW = outline.width / grid.cols

function fitAt(dx = 0, dy = 0): GridFit {
  const h = outlineHomography(grid, outline)
  h[2] += dx
  h[5] += dy
  return { homography: h, landmarks: 12, inliers: 10, pitch: cellW }
}

function setup(enabled = true) {
  const videoRef = { current: document.createElement('video') }
  const onLocked = vi.fn()
  const hook = renderHook(
    ({ on }: { on: boolean }) => useAutoCapture({ videoRef, grid, enabled: on, onLocked, intervalMs: 250 }),
    { initialProps: { on: enabled } },
  )
  return { hook, onLocked }
}

const tick = (n = 1) => act(() => { vi.advanceTimersByTime(250 * n) })

beforeEach(() => {
  vi.useFakeTimers()
  grabMock.mockReset().mockReturnValue(frame)
  findGridMock.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('useAutoCapture', () => {
  it('locks after three steady readings, fires once, and stays latched', () => {
    findGridMock.mockReturnValue(fitAt())
    const { hook, onLocked } = setup()

    tick(2)
    expect(hook.result.current.phase).toBe('aligning')
    expect(hook.result.current.stableTicks).toBe(2)
    expect(onLocked).not.toHaveBeenCalled()

    tick()
    expect(hook.result.current.phase).toBe('locked')
    expect(hook.result.current.armed).toBe(false)
    expect(onLocked).toHaveBeenCalledTimes(1)

    // A latched loop stops looking: no more frames, no second photo.
    const grabs = grabMock.mock.calls.length
    tick(10)
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(grabMock.mock.calls.length).toBe(grabs)
  })

  it('rearm() forgets the run-up and lets it fire again', () => {
    findGridMock.mockReturnValue(fitAt())
    const { hook, onLocked } = setup()
    tick(3)
    expect(onLocked).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.rearm())
    expect(hook.result.current.armed).toBe(true)
    expect(hook.result.current.phase).toBe('searching')
    tick(2)
    expect(onLocked).toHaveBeenCalledTimes(1)
    tick()
    expect(onLocked).toHaveBeenCalledTimes(2)
  })

  it('keeps searching with no grid, and never locks on a box that keeps moving', () => {
    findGridMock.mockReturnValue(null)
    const { hook, onLocked } = setup()
    tick(4)
    expect(hook.result.current.phase).toBe('searching')
    expect(hook.result.current.corners).toBeNull()

    let i = 0
    findGridMock.mockImplementation(() => fitAt(i++ % 2 ? cellW / 3 : 0, 0))
    tick(8)
    expect(hook.result.current.phase).toBe('aligning')
    expect(hook.result.current.corners).toHaveLength(4)
    expect(onLocked).not.toHaveBeenCalled()
  })

  it('does nothing while disabled, and starts when enabled', () => {
    findGridMock.mockReturnValue(fitAt())
    const { hook, onLocked } = setup(false)
    tick(5)
    expect(grabMock).not.toHaveBeenCalled()

    hook.rerender({ on: true })
    tick(3)
    expect(onLocked).toHaveBeenCalledTimes(1)
  })

  it('skips a tick the video has no frame for', () => {
    grabMock.mockReturnValue(null)
    findGridMock.mockReturnValue(fitAt())
    const { hook } = setup()
    tick(3)
    expect(findGridMock).not.toHaveBeenCalled()
    expect(hook.result.current.phase).toBe('searching')
  })
})
