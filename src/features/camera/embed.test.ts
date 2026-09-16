import { describe, expect, it } from 'vitest'
import { createEmbedder, EMBED_DIM, EMBED_SIZE, l2normalize, toEmbedCrop, toModelInput } from './embed.ts'
import { COLOR_WEIGHT, fuse, FUSED_DIM } from './fused.ts'
import { FEATURE_DIM } from './features.ts'

function solid(r: number, g: number, b: number, size = EMBED_SIZE): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) px.set([r, g, b, 255], i * 4)
  return px
}

describe('toModelInput', () => {
  it('lays crops out as NCHW with ImageNet normalisation', () => {
    // 124,116,104 is the ImageNet mean in 8-bit: it must map to ~0 on every channel
    const { data, dims } = toModelInput([solid(124, 116, 104), solid(255, 0, 0)])
    expect(dims).toEqual([2, 3, EMBED_SIZE, EMBED_SIZE])
    const plane = EMBED_SIZE * EMBED_SIZE
    expect(Math.abs(data[0])).toBeLessThan(0.02)
    expect(Math.abs(data[plane])).toBeLessThan(0.02)
    expect(Math.abs(data[2 * plane])).toBeLessThan(0.02)
    // second crop: red channel high, green and blue at their minimum
    const base = 3 * plane
    expect(data[base]).toBeCloseTo((1 - 0.485) / 0.229, 3)
    expect(data[base + plane]).toBeCloseTo(-0.456 / 0.224, 3)
    expect(data[base + 2 * plane]).toBeCloseTo(-0.406 / 0.225, 3)
  })

  it('refuses a crop of the wrong size', () => {
    expect(() => toModelInput([solid(0, 0, 0, 10)])).toThrow(/RGBA crop/)
  })
})

describe('toEmbedCrop', () => {
  it('resizes any region to the network size', () => {
    const out = toEmbedCrop(solid(10, 20, 30, 40), 40, 40)
    expect(out.length).toBe(EMBED_SIZE * EMBED_SIZE * 4)
    expect(out[0]).toBe(10)
    expect(out[1]).toBe(20)
    expect(out[2]).toBe(30)
  })
})

describe('createEmbedder', () => {
  it('batches crops through the session and returns one unit vector per crop', async () => {
    const calls: number[] = []
    const session = {
      async run(_data: Float32Array, dims: number[]) {
        calls.push(dims[0])
        const out = new Float32Array(dims[0] * EMBED_DIM)
        for (let n = 0; n < dims[0]; n++) out[n * EMBED_DIM + n] = 3 // distinct direction per crop
        return out
      },
    }
    const embedder = createEmbedder(session, 2)
    const vectors = await embedder.embed([solid(0, 0, 0), solid(0, 0, 0), solid(0, 0, 0)])
    expect(calls).toEqual([2, 1])
    expect(vectors).toHaveLength(3)
    expect(vectors[0][0]).toBeCloseTo(1, 5)
    expect(vectors[1][1]).toBeCloseTo(1, 5)
    expect(vectors[2][0]).toBeCloseTo(1, 5) // second batch starts its index over
  })

  it('refuses an output of the wrong shape', async () => {
    const embedder = createEmbedder({ run: async () => new Float32Array(7) })
    await expect(embedder.embed([solid(0, 0, 0)])).rejects.toThrow(/expected/)
  })
})

describe('l2normalize', () => {
  it('returns a unit vector', () => {
    const v = l2normalize(new Float32Array([3, 4]))
    expect(v[0]).toBeCloseTo(0.6, 5)
    expect(v[1]).toBeCloseTo(0.8, 5)
  })
})

describe('fuse', () => {
  const unit = (dim: number, at: number) => {
    const v = new Float32Array(dim)
    v[at] = 1
    return v
  }

  it('produces a unit vector whose cosine is the weighted average of the two cosines', () => {
    const a = fuse(unit(FEATURE_DIM, 0), unit(EMBED_DIM, 0))
    expect(a.length).toBe(FUSED_DIM)
    let norm = 0
    for (const x of a) norm += x * x
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5)

    // same colour, different embedding: cosine = COLOR_WEIGHT
    const b = fuse(unit(FEATURE_DIM, 0), unit(EMBED_DIM, 1))
    let dot = 0
    for (let i = 0; i < FUSED_DIM; i++) dot += a[i] * b[i]
    expect(dot).toBeCloseTo(COLOR_WEIGHT, 5)

    // different colour, same embedding: cosine = 1 - COLOR_WEIGHT
    const c = fuse(unit(FEATURE_DIM, 1), unit(EMBED_DIM, 0))
    dot = 0
    for (let i = 0; i < FUSED_DIM; i++) dot += a[i] * c[i]
    expect(dot).toBeCloseTo(1 - COLOR_WEIGHT, 5)
  })

  it('refuses vectors of the wrong length', () => {
    expect(() => fuse(new Float32Array(3), unit(EMBED_DIM, 0))).toThrow(/expected/)
  })
})
