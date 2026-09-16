import { describe, expect, it } from 'vitest'
import { classify, inflateGallery } from './gallery.ts'
import type { GalleryMeta } from './gallery.ts'
import { FEATURE_DIM, FEATURE_VERSION } from './features.ts'

/** A tiny gallery of one-hot-ish vectors, quantised the way the builder does it. */
function toyGallery(labels: string[], seeds: number[]) {
  const dim = FEATURE_DIM
  const rows = seeds.map((seed) => {
    const v = new Float32Array(dim)
    v[seed] = 1
    v[(seed + 1) % dim] = 0.3
    return v
  })
  const lo = new Array(dim).fill(0)
  const hi = new Array(dim).fill(1)
  const bytes = new Uint8Array(rows.length * dim)
  rows.forEach((v, r) => v.forEach((x, d) => (bytes[r * dim + d] = Math.round(x * 255))))
  const meta: GalleryMeta = {
    featureVersion: FEATURE_VERSION,
    dim,
    count: rows.length,
    labels,
    lo,
    hi,
    k: 5,
    confidenceThreshold: 0.8,
    builtAt: 'test',
  }
  return { meta, bytes }
}

function probe(seed: number): Float32Array {
  const v = new Float32Array(FEATURE_DIM)
  v[seed] = 1
  return v
}

describe('inflateGallery', () => {
  it('refuses a gallery built for a different feature version', () => {
    const { meta, bytes } = toyGallery(['a'], [0])
    expect(() => inflateGallery({ ...meta, featureVersion: 'v0-old' }, bytes)).toThrow(/built for feature/)
  })

  it('refuses a gallery whose byte count does not match its shape', () => {
    const { meta, bytes } = toyGallery(['a', 'b'], [0, 5])
    expect(() => inflateGallery(meta, bytes.subarray(0, 10))).toThrow(/shape mismatch/)
  })

  it('restores unit vectors from bytes', () => {
    const { meta, bytes } = toyGallery(['a'], [3])
    const g = inflateGallery(meta, bytes)
    let n = 0
    for (let d = 0; d < meta.dim; d++) n += g.vectors[d] * g.vectors[d]
    expect(Math.sqrt(n)).toBeCloseTo(1, 4)
  })
})

describe('classify', () => {
  it('ranks the nearest label first with a share that reflects the vote', () => {
    const { meta, bytes } = toyGallery(['lemon', 'lemon', 'lemon', 'lime', 'lime'], [10, 10, 10, 200, 200])
    const g = inflateGallery(meta, bytes)
    const ranked = classify(probe(10), g)
    expect(ranked[0].label).toBe('lemon')
    expect(ranked[0].share).toBeGreaterThan(0.5)
    expect(ranked.map((c) => c.label)).toContain('lime')
  })

  it('is unanimous when every neighbour agrees', () => {
    const { meta, bytes } = toyGallery(['lemon', 'lemon', 'lemon', 'lemon', 'lemon'], [10, 10, 10, 10, 10])
    const ranked = classify(probe(10), inflateGallery(meta, bytes))
    expect(ranked).toEqual([{ label: 'lemon', share: 1 }])
  })

  it('only counts the k nearest', () => {
    // four far "lime" rows must not outvote the one near "lemon" when k=1
    const { meta, bytes } = toyGallery(['lemon', 'lime', 'lime', 'lime', 'lime'], [10, 300, 301, 302, 303])
    const ranked = classify(probe(10), inflateGallery(meta, bytes), 1)
    expect(ranked).toEqual([{ label: 'lemon', share: 1 }])
  })
})
