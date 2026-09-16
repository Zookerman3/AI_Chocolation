// The gallery is every labelled training crop as a fingerprint, plus its label.
// Classifying a new crop is nearest-neighbour: score it against all of them,
// take the five closest, and let them vote weighted by similarity.
//
// Shipped as two files in public/models/: gallery.json (labels, scale, meta)
// and gallery.bin (one byte per value, 1920 x 392 = 735 KB). Quantising to a
// byte cost nothing measurable — scripts/build-gallery.ts checks that every
// time it runs.

import { FEATURE_DIM, FEATURE_VERSION } from './features.ts'

export interface GalleryMeta {
  featureVersion: string
  dim: number
  count: number
  /** Label of each row, in order. */
  labels: string[]
  /** Per-dimension dequantisation range: value = byte / 255 * (hi - lo) + lo. */
  lo: number[]
  hi: number[]
  k: number
  /** Winner vote share at or above which a cell is auto-filled. Measured, not guessed. */
  confidenceThreshold: number
  builtAt: string
  /** Leave-one-session-out accuracy at build time, for the README and the video. */
  heldOut?: { top1: number; top3: number; folds: Record<string, number> }
}

export interface Gallery {
  meta: GalleryMeta
  /** count x dim, row-major, L2-normalised. */
  vectors: Float32Array
}

export interface Candidate {
  label: string
  /** Share of the weighted vote this label won, 0..1. */
  share: number
}

export const LABEL_EMPTY = 'empty'

/** Turns the shipped bytes back into unit vectors. */
export function inflateGallery(meta: GalleryMeta, bytes: Uint8Array): Gallery {
  if (meta.featureVersion !== FEATURE_VERSION) {
    throw new Error(
      `Gallery was built for feature ${meta.featureVersion}, app computes ${FEATURE_VERSION}. Run: node scripts/build-gallery.ts`,
    )
  }
  if (meta.dim !== FEATURE_DIM || bytes.length !== meta.count * meta.dim) {
    throw new Error(`Gallery shape mismatch: expected ${meta.count}x${meta.dim}, got ${bytes.length} bytes`)
  }
  const vectors = new Float32Array(meta.count * meta.dim)
  for (let r = 0; r < meta.count; r++) {
    let norm = 0
    const base = r * meta.dim
    for (let d = 0; d < meta.dim; d++) {
      const v = (bytes[base + d] / 255) * (meta.hi[d] - meta.lo[d]) + meta.lo[d]
      vectors[base + d] = v
      norm += v * v
    }
    norm = Math.sqrt(norm) + 1e-9
    for (let d = 0; d < meta.dim; d++) vectors[base + d] /= norm
  }
  return { meta, vectors }
}

/** Ranked labels for one fingerprint. First entry is the best guess; its share
 * is the confidence the UI shows and thresholds on. */
export function classify(feature: Float32Array, gallery: Gallery, k = gallery.meta.k): Candidate[] {
  const { meta, vectors } = gallery
  const sims = new Float32Array(meta.count)
  for (let r = 0; r < meta.count; r++) {
    const base = r * meta.dim
    let s = 0
    for (let d = 0; d < meta.dim; d++) s += vectors[base + d] * feature[d]
    sims[r] = s
  }
  // top-k by partial selection; the gallery is small enough that a sort is fine too
  const idx = Array.from(sims.keys()).sort((a, b) => sims[b] - sims[a]).slice(0, k)
  const votes = new Map<string, number>()
  let total = 0
  for (const i of idx) {
    const w = Math.max(sims[i], 0)
    votes.set(meta.labels[i], (votes.get(meta.labels[i]) ?? 0) + w)
    total += w
  }
  return [...votes.entries()]
    .map(([label, v]) => ({ label, share: total > 0 ? v / total : 0 }))
    .sort((a, b) => b.share - a.share)
}

let cached: Promise<Gallery> | null = null

/** Fetches and inflates the gallery once per page load. ~0.7 MB, precached by the
 * service worker after the first visit, so this works with no network at all. */
export function loadGallery(base = '/models/'): Promise<Gallery> {
  if (!cached) {
    cached = (async () => {
      const [metaRes, binRes] = await Promise.all([fetch(`${base}gallery.json`), fetch(`${base}gallery.bin`)])
      if (!metaRes.ok || !binRes.ok) {
        throw new Error(`Could not load the flavor gallery (${metaRes.status}/${binRes.status})`)
      }
      const meta = (await metaRes.json()) as GalleryMeta
      const bytes = new Uint8Array(await binRes.arrayBuffer())
      return inflateGallery(meta, bytes)
    })().catch((err) => {
      cached = null // let the next attempt retry instead of caching the failure
      throw err
    })
  }
  return cached
}
