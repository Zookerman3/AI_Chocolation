#!/usr/bin/env node
// Builds the two galleries in public/models/ from a folder of labelled crops,
// and measures how good they are before writing anything.
//
//   node scripts/build-gallery.ts path/to/dataset [--holdout N] [--out dir]
//
// dataset/ is one folder per label (flavor id or "empty"), each holding JPEG
// crops named <session>_<photo>_r<row>c<col>.jpg — the output of
// scripts/crop_cells.py. The session prefix is what makes the accuracy number
// honest: each session is held out in turn and scored against the others, so
// no photo is ever scored against crops from the same shoot.
//
// --holdout N leaves session N out of the written galleries entirely (for
// scoring the shipped code path on photos it has never seen); --out changes
// where they go (default public/models).
//
// Uses the browser's own feature code (src/features/camera/features.ts,
// embed.ts, fused.ts) and the same ONNX runtime the tablet runs, so the
// galleries and the tablet can't disagree. Needs Node 22.18+ (runs .ts directly).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { decode } from 'jpeg-js'
import * as ort from 'onnxruntime-web'
import { featureFromCrop, resizeToCrop } from '../src/features/camera/features.ts'
import { createEmbedder, toEmbedCrop, MODEL_FILE, MODEL_INPUT, MODEL_OUTPUT, EMBED_DIM } from '../src/features/camera/embed.ts'
import type { Embedder } from '../src/features/camera/embed.ts'
import { fuse, COLOR_GALLERY, FUSED_GALLERY } from '../src/features/camera/fused.ts'
import { classify, inflateGallery } from '../src/features/camera/gallery.ts'
import type { GalleryKind, GalleryMeta } from '../src/features/camera/gallery.ts'

const K = 5
/** Winner vote share for auto-fill. From the calibration table in the PR: at 0.8,
 * 89% of cells auto-fill at 97% precision and 11% are asked. Raise it and fewer
 * wrong pieces slip in but the cashier taps more. */
const CONFIDENCE_THRESHOLD = 0.8

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const datasetDir = resolve(args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--'))) ?? 'dataset')
const holdout = flag('--holdout')
const outDir = resolve(flag('--out') ?? 'public/models')
const modelPath = resolve('public/models', MODEL_FILE)

interface Row {
  label: string
  session: string
  color: Float32Array
  embedCrop: Uint8ClampedArray
  embedding?: Float32Array
  fused?: Float32Array
}

function loadRows(): Row[] {
  const rows: Row[] = []
  const labels = readdirSync(datasetDir).filter((d) => statSync(join(datasetDir, d)).isDirectory()).sort()
  for (const label of labels) {
    for (const file of readdirSync(join(datasetDir, label)).sort()) {
      if (!file.toLowerCase().endsWith('.jpg')) continue
      const jpg = decode(readFileSync(join(datasetDir, label, file)), { useTArray: true })
      rows.push({
        label,
        session: file.split('_')[0],
        color: featureFromCrop(resizeToCrop(jpg.data, jpg.width, jpg.height)),
        embedCrop: toEmbedCrop(jpg.data, jpg.width, jpg.height),
      })
    }
    process.stdout.write(`  ${label.padEnd(24)} ${rows.filter((r) => r.label === label).length}\n`)
  }
  return rows
}

async function loadEmbedder(): Promise<Embedder> {
  const session = await ort.InferenceSession.create(readFileSync(modelPath), { executionProviders: ['wasm'] })
  return createEmbedder(
    {
      async run(data, dims) {
        const out = await session.run({ [MODEL_INPUT]: new ort.Tensor('float32', data, dims) })
        return out[MODEL_OUTPUT].data as Float32Array
      },
    },
    32,
  )
}

function quantise(vectors: Float32Array[], dim: number) {
  const n = vectors.length
  const lo = new Array<number>(dim).fill(Infinity)
  const hi = new Array<number>(dim).fill(-Infinity)
  for (const v of vectors) {
    for (let d = 0; d < dim; d++) {
      if (v[d] < lo[d]) lo[d] = v[d]
      if (v[d] > hi[d]) hi[d] = v[d]
    }
  }
  const bytes = new Uint8Array(n * dim)
  vectors.forEach((v, i) => {
    for (let d = 0; d < dim; d++) {
      const span = hi[d] - lo[d]
      bytes[i * dim + d] = span > 0 ? Math.round(((v[d] - lo[d]) / span) * 255) : 0
    }
  })
  return { lo, hi, bytes }
}

/** Leave-one-session-out: build a gallery from the other sessions, score this one. */
function heldOutAccuracy(rows: Row[], vectors: Float32Array[], kind: GalleryKind, lo: number[], hi: number[], bytes: Uint8Array) {
  const dim = kind.dim
  const sessions = [...new Set(rows.map((r) => r.session))].sort()
  let top1 = 0
  let top3 = 0
  let n = 0
  const folds: Record<string, number> = {}
  for (const held of sessions) {
    const trainIdx = rows.map((r, i) => (r.session === held ? -1 : i)).filter((i) => i >= 0)
    const trainBytes = new Uint8Array(trainIdx.length * dim)
    trainIdx.forEach((src, dst) => trainBytes.set(bytes.subarray(src * dim, (src + 1) * dim), dst * dim))
    const meta: GalleryMeta = {
      featureVersion: kind.featureVersion,
      dim,
      count: trainIdx.length,
      labels: trainIdx.map((i) => rows[i].label),
      lo,
      hi,
      k: K,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      builtAt: '',
    }
    const gallery = inflateGallery(meta, trainBytes, kind)
    let ok = 0
    let m = 0
    rows.forEach((r, i) => {
      if (r.session !== held) return
      const ranked = classify(vectors[i], gallery)
      m++
      n++
      if (ranked[0]?.label === r.label) {
        ok++
        top1++
      }
      if (ranked.slice(0, 3).some((c) => c.label === r.label)) top3++
    })
    folds[held] = Math.round((ok / m) * 1000) / 10
  }
  return { top1: Math.round((top1 / n) * 1000) / 10, top3: Math.round((top3 / n) * 1000) / 10, folds }
}

function build(rows: Row[], vectors: Float32Array[], kind: GalleryKind) {
  const { lo, hi, bytes } = quantise(vectors, kind.dim)
  console.log(`\n${kind.name} (${kind.dim}-dim, ${kind.featureVersion})`)
  console.log('  held-out accuracy, each session scored against the others:')
  const heldOut = heldOutAccuracy(rows, vectors, kind, lo, hi, bytes)
  for (const [s, acc] of Object.entries(heldOut.folds)) console.log(`    session ${s}: ${acc}%`)
  console.log(`    top-1 ${heldOut.top1}%   top-3 ${heldOut.top3}%   (k=${K})`)

  const keep = rows.map((r, i) => (r.session === holdout ? -1 : i)).filter((i) => i >= 0)
  const kept = new Uint8Array(keep.length * kind.dim)
  keep.forEach((src, dst) => kept.set(bytes.subarray(src * kind.dim, (src + 1) * kind.dim), dst * kind.dim))
  const meta: GalleryMeta = {
    featureVersion: kind.featureVersion,
    dim: kind.dim,
    count: keep.length,
    labels: keep.map((i) => rows[i].label),
    lo: lo.map((v) => Number(v.toFixed(6))),
    hi: hi.map((v) => Number(v.toFixed(6))),
    k: K,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    builtAt: new Date().toISOString(),
    heldOut,
  }
  writeFileSync(join(outDir, `${kind.name}.json`), JSON.stringify(meta))
  writeFileSync(join(outDir, `${kind.name}.bin`), kept)
  console.log(`  wrote ${join(outDir, kind.name)}.{json,bin} (${keep.length} rows, ${(kept.length / 1024).toFixed(0)} KB)${holdout ? ` without session ${holdout}` : ''}`)
}

console.log(`reading ${datasetDir}`)
const rows = loadRows()
console.log(`${rows.length} crops`)

console.log(`\nembedding with ${modelPath} (${EMBED_DIM}-dim)…`)
const embedder = await loadEmbedder()
const t0 = Date.now()
const embeddings = await embedder.embed(rows.map((r) => r.embedCrop))
rows.forEach((r, i) => {
  r.embedding = embeddings[i]
  r.fused = fuse(r.color, embeddings[i])
})
console.log(`  ${((Date.now() - t0) / rows.length).toFixed(1)} ms per crop`)

mkdirSync(outDir, { recursive: true })
for (const stale of ['gallery.json', 'gallery.bin']) if (existsSync(join(outDir, stale))) rmSync(join(outDir, stale))

// Embedding alone is reported, not shipped: the fused vector beats it.
{
  const kind: GalleryKind = { name: 'embedding-only (not written)', featureVersion: 'n/a', dim: EMBED_DIM }
  const vectors = rows.map((r) => r.embedding as Float32Array)
  const { lo, hi, bytes } = quantise(vectors, kind.dim)
  const h = heldOutAccuracy(rows, vectors, kind, lo, hi, bytes)
  console.log(`\n${kind.name}: top-1 ${h.top1}%   top-3 ${h.top3}%`)
}
build(
  rows,
  rows.map((r) => r.color),
  COLOR_GALLERY,
)
build(
  rows,
  rows.map((r) => r.fused as Float32Array),
  FUSED_GALLERY,
)
