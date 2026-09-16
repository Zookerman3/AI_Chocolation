import { describe, expect, it } from 'vitest'
import { assertSharp, BLURRY_MESSAGE, classifyCells } from './localDetector.ts'
import type { CellCrop } from './localDetector.ts'
import { CROP, featureFromCrop } from './features.ts'
import { EMBED_DIM, EMBED_SIZE } from './embed.ts'
import type { Embedder } from './embed.ts'
import { COLOR_GALLERY, fuse, FUSED_GALLERY } from './fused.ts'
import { inflateGallery, LABEL_EMPTY } from './gallery.ts'
import type { GalleryKind, GalleryMeta } from './gallery.ts'
import { FLAVORS } from '../../data/flavors.ts'

const [lemon, lime] = FLAVORS

function solid(r: number, g: number, b: number, size: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) px.set([r, g, b, 255], i * 4)
  return px
}

/** A crop whose embedding "direction" is encoded in the red channel of the
 * embed-size image, so the fake embedder below can be deterministic. */
function crop(row: number, col: number, colorRgb: [number, number, number], embedIndex: number): CellCrop {
  return {
    row,
    col,
    box: { x: 0, y: 0, width: 0.1, height: 0.1 },
    color: solid(...colorRgb, CROP),
    embed: solid(embedIndex, 0, 0, EMBED_SIZE),
  }
}

const fakeEmbedder: Embedder = {
  async embed(crops) {
    return crops.map((c) => {
      const v = new Float32Array(EMBED_DIM)
      v[c[0]] = 1 // red channel of the first pixel picks the direction
      return v
    })
  },
}

function unit(dim: number, at: number): Float32Array {
  const v = new Float32Array(dim)
  v[at] = 1
  return v
}

/** Quantises rows the way scripts/build-gallery.ts does, with a fixed -1..1 range. */
function gallery(kind: GalleryKind, rows: { label: string; vector: Float32Array }[]) {
  const bytes = new Uint8Array(rows.length * kind.dim)
  rows.forEach((r, i) => r.vector.forEach((x, d) => (bytes[i * kind.dim + d] = Math.round(((x + 1) / 2) * 255))))
  const meta: GalleryMeta = {
    featureVersion: kind.featureVersion,
    dim: kind.dim,
    count: rows.length,
    labels: rows.map((r) => r.label),
    lo: new Array(kind.dim).fill(-1),
    hi: new Array(kind.dim).fill(1),
    k: 5,
    confidenceThreshold: 0.8,
    builtAt: 'test',
  }
  return inflateGallery(meta, bytes, kind)
}

const grayColor = featureFromCrop(solid(128, 128, 128, CROP))
const redColor = featureFromCrop(solid(200, 40, 40, CROP))
const five = <T>(x: T) => [x, x, x, x, x]

describe('classifyCells with the network (fused)', () => {
  // Same colour everywhere: only the embedding can tell lemon from lime.
  const fused = gallery(FUSED_GALLERY, [
    ...five({ label: lemon.id, vector: fuse(grayColor, unit(EMBED_DIM, 5)) }),
    ...five({ label: lime.id, vector: fuse(grayColor, unit(EMBED_DIM, 9)) }),
  ])

  it('tells cells apart by embedding when colour cannot', async () => {
    const out = await classifyCells(
      [crop(1, 1, [128, 128, 128], 5), crop(1, 2, [128, 128, 128], 9)],
      { kind: 'fused', gallery: fused, embedder: fakeEmbedder },
      false,
    )
    expect(out.map((d) => [d.flavorId, d.cell, Math.round(d.confidence * 100)])).toEqual([
      [lemon.id, { row: 1, col: 1 }, 100],
      [lime.id, { row: 1, col: 2 }, 100],
    ])
    expect(out[0].thumbnail).toBeUndefined()
  })
})

describe('classifyCells without the network (colour only)', () => {
  const color = gallery(COLOR_GALLERY, [
    ...five({ label: lemon.id, vector: grayColor }),
    ...five({ label: lime.id, vector: redColor }),
    ...five({ label: LABEL_EMPTY, vector: featureFromCrop(solid(10, 10, 10, CROP)) }),
  ])
  const recognizer = { kind: 'color' as const, gallery: color, embedder: null, reason: 'test' }

  it('matches on colour alone and never touches the embedder', async () => {
    const out = await classifyCells([crop(2, 3, [200, 40, 40], 0), crop(2, 4, [128, 128, 128], 0)], recognizer, false)
    expect(out.map((d) => d.flavorId)).toEqual([lime.id, lemon.id])
    expect(out[0].rawClass).toBe(lime.id)
  })

  it('drops a confidently empty cell', async () => {
    const out = await classifyCells([crop(3, 1, [10, 10, 10], 0)], recognizer, false)
    expect(out).toEqual([])
  })

  it('sends an unsure empty to review with the best real flavor, below the auto-fill line', async () => {
    // Five identical neighbours, three labelled empty and two lemon: "empty" wins
    // with 0.6, under the 0.8 line, so the cashier is asked, with lemon suggested.
    const dark = featureFromCrop(solid(69, 69, 69, CROP))
    const split = gallery(COLOR_GALLERY, [
      { label: LABEL_EMPTY, vector: dark },
      { label: LABEL_EMPTY, vector: dark },
      { label: LABEL_EMPTY, vector: dark },
      { label: lemon.id, vector: dark },
      { label: lemon.id, vector: dark },
    ])
    const out = await classifyCells([crop(3, 2, [69, 69, 69], 0)], { ...recognizer, gallery: split }, false)
    expect(out).toHaveLength(1)
    expect(out[0].flavorId).toBe(lemon.id)
    expect(out[0].rawClass).toBe(lemon.id)
    expect(out[0].confidence).toBeCloseTo(0.4, 5)
  })
})

describe('assertSharp', () => {
  const noisy = (): Uint8ClampedArray => {
    // a checkerboard is as sharp as a crop gets
    const px = new Uint8ClampedArray(CROP * CROP * 4)
    for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) px.set([(x + y) % 2 ? 220 : 30, 30, 30, 255], (y * CROP + x) * 4)
    return px
  }
  const cellWith = (color: Uint8ClampedArray): CellCrop => ({ row: 1, col: 1, box: { x: 0, y: 0, width: 1, height: 1 }, color, embed: solid(0, 0, 0, EMBED_SIZE) })

  it('refuses a frame where every cell is smooth', () => {
    expect(() => assertSharp([cellWith(solid(90, 90, 90, CROP)), cellWith(solid(60, 60, 60, CROP))])).toThrow(BLURRY_MESSAGE)
  })

  it('passes a mostly empty box on the strength of its few sharp cells', () => {
    const cells = [...Array.from({ length: 9 }, () => cellWith(solid(20, 20, 20, CROP))), cellWith(noisy())]
    expect(() => assertSharp(cells)).not.toThrow()
  })

  it('ignores an empty frame', () => {
    expect(() => assertSharp([])).not.toThrow()
  })
})
