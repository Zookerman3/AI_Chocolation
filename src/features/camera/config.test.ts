import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_DIM, FEATURE_VERSION } from './features.ts'
import type { GalleryMeta } from './gallery.ts'

// The recognizer chunk is the one part of camera assist that can fail on a
// device we've never held: this is that failure.
vi.mock('./recognizer.ts', () => {
  throw new Error('Importing a module script failed.')
})

const meta: GalleryMeta = {
  featureVersion: FEATURE_VERSION,
  dim: FEATURE_DIM,
  count: 1,
  labels: ['lemon'],
  lo: new Array(FEATURE_DIM).fill(0),
  hi: new Array(FEATURE_DIM).fill(1),
  k: 5,
  confidenceThreshold: 0.8,
  builtAt: 'test',
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('.json')) return new Response(JSON.stringify(meta), { status: 200 })
      return new Response(new Uint8Array(FEATURE_DIM), { status: 200 })
    }),
  )
})

describe('preloadRecognizer when the recognizer chunk will not load', () => {
  it('falls back to the colour gallery instead of failing, and says why', async () => {
    const { preloadRecognizer } = await import('./config.ts')
    const phases: string[] = []
    const r = await preloadRecognizer((p) => phases.push(p.phase))
    if (r.kind !== 'color') throw new Error(`expected the colour fallback, got ${r.kind}`)
    expect(r.embedder).toBeNull()
    expect(r.reason).toBeTruthy() // whatever the browser called it, shown in the banner
    expect(r.gallery.meta.labels).toEqual(['lemon'])
    // the veil is told to stop waiting, so Capture is enabled
    expect(phases).toContain('ready')
  })

  it('does not fall back silently when the colour gallery is missing too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const { preloadRecognizer } = await import('./config.ts')
    await expect(preloadRecognizer()).rejects.toThrow(/Could not load the flavor gallery/)
  })
})
