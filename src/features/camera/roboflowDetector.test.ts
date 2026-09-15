import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoboflowDetector, mapClassToFlavorId } from './roboflowDetector.ts'
import { FLAVORS } from '../../data/flavors.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mapClassToFlavorId', () => {
  it('maps a class name that matches a known flavor id, trimming and lowercasing', () => {
    const id = FLAVORS[0].id
    expect(mapClassToFlavorId(id)).toBe(id)
    expect(mapClassToFlavorId(`  ${id.toUpperCase()}  `)).toBe(id)
  })

  it('returns null for a class name that is not a known flavor id, instead of guessing', () => {
    expect(mapClassToFlavorId('some-unlabeled-thing')).toBeNull()
    expect(mapClassToFlavorId('Crème Brulée')).toBeNull() // display name, not the id — must not silently match
  })
})

describe('createRoboflowDetector', () => {
  it('converts pixel-center boxes to normalized top-left boxes and maps classes', async () => {
    const flavorId = FLAVORS[0].id
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        image: { width: 1000, height: 500 },
        predictions: [
          { class: flavorId, confidence: 0.91, x: 500, y: 250, width: 200, height: 100 },
          { class: 'mystery-item', confidence: 0.4, x: 100, y: 100, width: 50, height: 50 },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const detector = createRoboflowDetector({ apiKey: 'test-key', modelId: 'test-model/1' })
    const detections = await detector.detect(new Blob(['fake image bytes'], { type: 'image/png' }))

    expect(detections).toHaveLength(2)
    expect(detections[0]).toEqual({
      flavorId,
      confidence: 0.91,
      box: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      rawClass: flavorId,
    })
    expect(detections[1].flavorId).toBeNull()
    expect(detections[1].rawClass).toBe('mystery-item')

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('https://detect.roboflow.com/test-model/1?')
    expect(url).toContain('api_key=test-key')
    expect(options.method).toBe('POST')
  })

  it('throws with a clear message when the inference request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }))
    const detector = createRoboflowDetector({ apiKey: 'bad-key', modelId: 'test-model/1' })
    await expect(detector.detect(new Blob(['x']))).rejects.toThrow(/401/)
  })
})
