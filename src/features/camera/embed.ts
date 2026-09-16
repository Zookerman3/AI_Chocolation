// One chocolate -> one 1280-number embedding from a pretrained network.
//
// The colour fingerprint in features.ts clears the checkpoint when the photo
// looks like the training photos, and falls apart when it doesn't: dim light,
// a cool white balance, a box a fifth of a cell off the outline, another
// camera. A pretrained MobileNetV2 (ImageNet, ONNX model zoo, no training of
// ours) describes a crop in a way that survives all of that — measured in
// README "Known limits". Its global-average-pool output is the embedding;
// the 1000-class head is cut off, we never ask it what an ImageNet class is.
//
// This file is pure: it turns RGBA crops into the network's input tensor and
// its output into unit vectors. Running the network is someone else's job —
// recognizer.ts in the browser (onnxruntime-web, WebAssembly), the gallery
// builder in Node (same runtime) — so both produce identical numbers.

import { resizeRgba } from './features.ts'

/** Which network, which output, at what size. Baked into the fused gallery's
 * version string so a gallery built with a different model is refused. */
export const EMBED_VERSION = 'mobilenetv2-12-gap464-int8-160'
export const EMBED_DIM = 1280
/** Input side in pixels. MobileNetV2 was trained at 224; on these crops 160
 * scores the same (98.0 vs 97.8 held-out) and runs twice as fast. */
export const EMBED_SIZE = 160
export const MODEL_FILE = 'mobilenetv2.onnx'
export const MODEL_INPUT = 'input'
export const MODEL_OUTPUT = '464'

// ImageNet normalisation, the one the network was trained with.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/** The minimum of an ONNX session this module needs, so tests can fake it. */
export interface EmbedSession {
  /** Runs the network on an NCHW float tensor, returns the flat N x EMBED_DIM output. */
  run(input: Float32Array, dims: number[]): Promise<Float32Array>
}

export interface Embedder {
  /** Unit-length embedding for each EMBED_SIZE x EMBED_SIZE RGBA crop, in order. */
  embed(crops: Uint8ClampedArray[]): Promise<Float32Array[]>
}

/** Packs RGBA crops (each EMBED_SIZE square) into one NCHW, ImageNet-normalised
 * float tensor: dims [n, 3, EMBED_SIZE, EMBED_SIZE]. */
export function toModelInput(crops: Uint8ClampedArray[]): { data: Float32Array; dims: number[] } {
  const plane = EMBED_SIZE * EMBED_SIZE
  const data = new Float32Array(crops.length * 3 * plane)
  crops.forEach((crop, n) => {
    if (crop.length !== plane * 4) {
      throw new Error(`Embedding wants a ${EMBED_SIZE}x${EMBED_SIZE} RGBA crop, got ${crop.length / 4} pixels`)
    }
    const base = n * 3 * plane
    for (let p = 0; p < plane; p++) {
      const i = p * 4
      data[base + p] = (crop[i] / 255 - MEAN[0]) / STD[0]
      data[base + plane + p] = (crop[i + 1] / 255 - MEAN[1]) / STD[1]
      data[base + 2 * plane + p] = (crop[i + 2] / 255 - MEAN[2]) / STD[2]
    }
  })
  return { data, dims: [crops.length, 3, EMBED_SIZE, EMBED_SIZE] }
}

/** Scales a vector to unit length, in place, and returns it. */
export function l2normalize(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) + 1e-9
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** Resize any RGBA region to the size the network wants. */
export function toEmbedCrop(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number): Uint8ClampedArray {
  return resizeRgba(src, sw, sh, EMBED_SIZE)
}

/** Wraps a session into the batch-in, unit-vectors-out shape the detector uses.
 * `batch` caps how many crops go through the network per call: a 5x6 box is
 * 30 crops, which is fine for memory but keeps the UI frozen a beat longer on
 * a slow tablet; smaller batches give the event loop a turn in between. */
export function createEmbedder(session: EmbedSession, batch = 8): Embedder {
  return {
    async embed(crops) {
      const out: Float32Array[] = []
      for (let i = 0; i < crops.length; i += batch) {
        const slice = crops.slice(i, i + batch)
        const { data, dims } = toModelInput(slice)
        const y = await session.run(data, dims)
        if (y.length !== slice.length * EMBED_DIM) {
          throw new Error(`Embedding output has ${y.length} values, expected ${slice.length}x${EMBED_DIM}`)
        }
        for (let n = 0; n < slice.length; n++) out.push(l2normalize(y.slice(n * EMBED_DIM, (n + 1) * EMBED_DIM)))
      }
      return out
    },
  }
}
