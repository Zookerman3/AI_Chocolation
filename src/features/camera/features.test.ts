import { describe, expect, it } from 'vitest'
import { CROP, FEATURE_DIM, featureFromCrop, resizeToCrop } from './features.ts'

function solid(r: number, g: number, b: number, w = CROP, h = CROP): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    px[i * 4] = r
    px[i * 4 + 1] = g
    px[i * 4 + 2] = b
    px[i * 4 + 3] = 255
  }
  return px
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

describe('featureFromCrop', () => {
  it('has the documented shape and is unit length', () => {
    const f = featureFromCrop(solid(200, 40, 40))
    expect(f).toHaveLength(FEATURE_DIM)
    expect(Math.sqrt(dot(f, f))).toBeCloseTo(1, 5)
  })

  it('is deterministic', () => {
    const a = featureFromCrop(solid(20, 120, 220))
    const b = featureFromCrop(solid(20, 120, 220))
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('puts different colours far apart and the same colour close together', () => {
    const red = featureFromCrop(solid(200, 40, 40))
    const redAgain = featureFromCrop(solid(205, 45, 42))
    const blue = featureFromCrop(solid(40, 60, 200))
    expect(dot(red, redAgain)).toBeGreaterThan(0.98)
    expect(dot(red, blue)).toBeLessThan(dot(red, redAgain) - 0.2)
  })

  it('ignores overall brightness more than it ignores hue', () => {
    // A dim session and a bright one should agree on the piece; that is what the
    // lightness-normalised thumbnail buys, and it was worth +5 points on the
    // dimmest training set.
    const yellow = featureFromCrop(solid(220, 200, 40))
    const dimYellow = featureFromCrop(solid(150, 135, 25))
    const green = featureFromCrop(solid(80, 200, 60))
    expect(dot(yellow, dimYellow)).toBeGreaterThan(dot(yellow, green))
  })
})

describe('resizeToCrop', () => {
  it('area-averages down to 96x96', () => {
    const w = 192
    const h = 192
    const px = new Uint8ClampedArray(w * h * 4)
    // left half white, right half black
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < w / 2 ? 255 : 0
        const i = (y * w + x) * 4
        px[i] = px[i + 1] = px[i + 2] = v
        px[i + 3] = 255
      }
    }
    const out = resizeToCrop(px, w, h)
    expect(out).toHaveLength(CROP * CROP * 4)
    expect(out[(10 * CROP + 10) * 4]).toBe(255)
    expect(out[(10 * CROP + 85) * 4]).toBe(0)
  })

  it('handles a source smaller than the crop without reading off the end', () => {
    const out = resizeToCrop(solid(10, 20, 30, 30, 30), 30, 30)
    expect(out[(CROP * CROP - 1) * 4 + 2]).toBe(30)
  })
})
