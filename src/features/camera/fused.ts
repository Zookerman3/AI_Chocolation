// The recognizer's actual feature: colour fingerprint and network embedding,
// side by side, each scaled so that the cosine similarity of two fused vectors
// is a weighted average of the two cosines:
//
//   cos(fused_a, fused_b) = COLOR_WEIGHT * cos(colour) + (1 - COLOR_WEIGHT) * cos(embedding)
//
// The network alone is robust and slightly worse at splitting the look-alike
// pairs; the colour alone is sharp on those and fragile to everything else.
// Together, at 0.7 colour, held-out top-1 went from 92.2 (colour) / 97.9
// (network) to 98.4, and the studio product photo went from 4 wrong auto-fills
// to none. That weight is baked into the gallery, so change it here, rebuild,
// and the version string below changes with it.

import { FEATURE_DIM, FEATURE_VERSION } from './features.ts'
import { EMBED_DIM, EMBED_VERSION } from './embed.ts'
import type { GalleryKind } from './gallery.ts'

export const COLOR_WEIGHT = 0.7
export const FUSED_DIM = FEATURE_DIM + EMBED_DIM // 1672
export const FUSED_VERSION = `v2-fused(${FEATURE_VERSION}x${COLOR_WEIGHT}+${EMBED_VERSION})`

const COLOR_SCALE = Math.sqrt(COLOR_WEIGHT)
const EMBED_SCALE = Math.sqrt(1 - COLOR_WEIGHT)

/** Joins one unit colour fingerprint and one unit embedding into a unit fused vector. */
export function fuse(color: Float32Array, embedding: Float32Array): Float32Array {
  if (color.length !== FEATURE_DIM || embedding.length !== EMBED_DIM) {
    throw new Error(`fuse: expected ${FEATURE_DIM} + ${EMBED_DIM} values, got ${color.length} + ${embedding.length}`)
  }
  const out = new Float32Array(FUSED_DIM)
  for (let i = 0; i < FEATURE_DIM; i++) out[i] = color[i] * COLOR_SCALE
  for (let i = 0; i < EMBED_DIM; i++) out[FEATURE_DIM + i] = embedding[i] * EMBED_SCALE
  return out
}

/** The two galleries scripts/build-gallery.ts writes to public/models/. */
export const FUSED_GALLERY: GalleryKind = { name: 'gallery-fused', featureVersion: FUSED_VERSION, dim: FUSED_DIM }
export const COLOR_GALLERY: GalleryKind = { name: 'gallery-color', featureVersion: FEATURE_VERSION, dim: FEATURE_DIM }
