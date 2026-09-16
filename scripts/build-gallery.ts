#!/usr/bin/env node
// Builds public/models/gallery.{json,bin} from a folder of labelled crops, and
// measures how good it is before writing anything.
//
//   node scripts/build-gallery.ts path/to/dataset
//
// dataset/ is one folder per label (flavor id or "empty"), each holding JPEG
// crops named <session>_<photo>_r<row>c<col>.jpg — the output of the cropping
// tool in the Photos folder. The session prefix is what makes the accuracy
// number honest: each session is held out in turn and scored against the other
// three, so no photo is ever scored against crops from the same shoot.
//
// Uses the browser's own feature code (src/features/camera/features.ts), so the
// gallery and the tablet can't disagree. Needs Node 22.18+ (runs .ts directly).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { decode } from 'jpeg-js'
import { featureFromCrop, resizeToCrop, FEATURE_DIM, FEATURE_VERSION } from '../src/features/camera/features.ts'
import { classify, inflateGallery } from '../src/features/camera/gallery.ts'
import type { GalleryMeta } from '../src/features/camera/gallery.ts'

const K = 5
/** Winner vote share for auto-fill. From the calibration table in the PR: at 0.8,
 * 89% of cells auto-fill at 97% precision and 11% are asked. Raise it and fewer
 * wrong pieces slip in but the cashier taps more. */
const CONFIDENCE_THRESHOLD = 0.8

const datasetDir = resolve(process.argv[2] ?? 'dataset')
const outDir = resolve('public/models')

interface Row {
  label: string
  session: string
  feature: Float32Array
}

function loadRows(): Row[] {
  const rows: Row[] = []
  const labels = readdirSync(datasetDir).filter((d) => statSync(join(datasetDir, d)).isDirectory()).sort()
  for (const label of labels) {
    for (const file of readdirSync(join(datasetDir, label)).sort()) {
      if (!file.toLowerCase().endsWith('.jpg')) continue
      const jpg = decode(readFileSync(join(datasetDir, label, file)), { useTArray: true })
      const crop = resizeToCrop(jpg.data, jpg.width, jpg.height)
      rows.push({ label, session: file.split('_')[0], feature: featureFromCrop(crop) })
    }
    process.stdout.write(`  ${label.padEnd(24)} ${rows.filter((r) => r.label === label).length}\n`)
  }
  return rows
}

function quantise(rows: Row[]) {
  const n = rows.length
  const lo = new Array<number>(FEATURE_DIM).fill(Infinity)
  const hi = new Array<number>(FEATURE_DIM).fill(-Infinity)
  for (const r of rows) {
    for (let d = 0; d < FEATURE_DIM; d++) {
      if (r.feature[d] < lo[d]) lo[d] = r.feature[d]
      if (r.feature[d] > hi[d]) hi[d] = r.feature[d]
    }
  }
  const bytes = new Uint8Array(n * FEATURE_DIM)
  rows.forEach((r, i) => {
    for (let d = 0; d < FEATURE_DIM; d++) {
      const span = hi[d] - lo[d]
      bytes[i * FEATURE_DIM + d] = span > 0 ? Math.round(((r.feature[d] - lo[d]) / span) * 255) : 0
    }
  })
  return { lo, hi, bytes }
}

/** Leave-one-session-out: build a gallery from three sessions, score the fourth. */
function heldOutAccuracy(rows: Row[], lo: number[], hi: number[], bytes: Uint8Array) {
  const sessions = [...new Set(rows.map((r) => r.session))].sort()
  let top1 = 0
  let top3 = 0
  let n = 0
  const folds: Record<string, number> = {}
  for (const held of sessions) {
    const trainIdx = rows.map((r, i) => (r.session === held ? -1 : i)).filter((i) => i >= 0)
    const trainBytes = new Uint8Array(trainIdx.length * FEATURE_DIM)
    trainIdx.forEach((src, dst) => trainBytes.set(bytes.subarray(src * FEATURE_DIM, (src + 1) * FEATURE_DIM), dst * FEATURE_DIM))
    const meta: GalleryMeta = {
      featureVersion: FEATURE_VERSION,
      dim: FEATURE_DIM,
      count: trainIdx.length,
      labels: trainIdx.map((i) => rows[i].label),
      lo,
      hi,
      k: K,
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      builtAt: '',
    }
    const gallery = inflateGallery(meta, trainBytes)
    let ok = 0
    let m = 0
    for (const r of rows) {
      if (r.session !== held) continue
      const ranked = classify(r.feature, gallery)
      m++
      n++
      if (ranked[0]?.label === r.label) {
        ok++
        top1++
      }
      if (ranked.slice(0, 3).some((c) => c.label === r.label)) top3++
    }
    folds[held] = Math.round((ok / m) * 1000) / 10
  }
  return { top1: Math.round((top1 / n) * 1000) / 10, top3: Math.round((top3 / n) * 1000) / 10, folds }
}

console.log(`reading ${datasetDir}`)
const rows = loadRows()
console.log(`${rows.length} crops, ${FEATURE_DIM}-dim, feature ${FEATURE_VERSION}`)
const { lo, hi, bytes } = quantise(rows)
console.log('\nheld-out accuracy (each session scored against the other three):')
const heldOut = heldOutAccuracy(rows, lo, hi, bytes)
for (const [s, acc] of Object.entries(heldOut.folds)) console.log(`  session ${s}: ${acc}%`)
console.log(`  top-1 ${heldOut.top1}%   top-3 ${heldOut.top3}%   (k=${K})`)

const meta: GalleryMeta = {
  featureVersion: FEATURE_VERSION,
  dim: FEATURE_DIM,
  count: rows.length,
  labels: rows.map((r) => r.label),
  lo: lo.map((v) => Number(v.toFixed(6))),
  hi: hi.map((v) => Number(v.toFixed(6))),
  k: K,
  confidenceThreshold: CONFIDENCE_THRESHOLD,
  builtAt: new Date().toISOString(),
  heldOut,
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'gallery.json'), JSON.stringify(meta))
writeFileSync(join(outDir, 'gallery.bin'), bytes)
console.log(`\nwrote ${join(outDir, 'gallery.json')} and gallery.bin (${(bytes.length / 1024).toFixed(0)} KB)`)
