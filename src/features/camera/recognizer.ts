// Loads what the on-device recognizer needs, once per page load: the network
// (public/models/mobilenetv2.onnx, 2.5 MB, run by onnxruntime-web in
// WebAssembly) and the fused gallery (3.2 MB). Both are precached by the
// service worker after the first visit, so this works with the wifi down.
//
// If the network can't load — an old browser without WebAssembly SIMD, a
// download that failed, a bad build — the recognizer degrades to the colour
// gallery on its own and says so, instead of taking the camera down. Fewer
// auto-fills and more confirm taps is the right failure, a dead button isn't.
//
// WebAssembly only, deliberately: WebGPU is faster but crashes iOS Safari,
// which is exactly the tablet at the counter.

import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { createEmbedder, MODEL_FILE, MODEL_INPUT, MODEL_OUTPUT } from './embed.ts'
import type { Embedder } from './embed.ts'
import { COLOR_GALLERY, FUSED_GALLERY } from './fused.ts'
import { loadGallery } from './gallery.ts'
import type { Gallery } from './gallery.ts'

export type Recognizer =
  | { kind: 'fused'; gallery: Gallery; embedder: Embedder }
  | { kind: 'color'; gallery: Gallery; embedder: null; reason: string }

export interface LoadProgress {
  /** What's being fetched. 'ready' when done. */
  phase: 'model' | 'gallery' | 'ready'
  /** Bytes so far and the expected total, when the server said. */
  loaded: number
  total: number | null
}

const MODELS_BASE = '/models/'

let cached: Promise<Recognizer> | null = null

/** The recognizer, loading it on the first call. Later calls share the same
 * promise, so the camera screen can warm it while the cashier lines the box up
 * and the detector gets it for free. */
export function loadRecognizer(onProgress?: (p: LoadProgress) => void): Promise<Recognizer> {
  if (!cached) {
    cached = load(onProgress).catch((err) => {
      cached = null // let the next attempt retry instead of caching the failure
      throw err
    })
  }
  return cached
}

async function load(onProgress?: (p: LoadProgress) => void): Promise<Recognizer> {
  let embedder: Embedder | null = null
  let reason = ''
  try {
    embedder = await loadEmbedder(onProgress)
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err)
    console.warn('Recognizer: network unavailable, falling back to colour matching.', err)
  }

  onProgress?.({ phase: 'gallery', loaded: 0, total: null })
  if (embedder) {
    try {
      const gallery = await loadGallery(FUSED_GALLERY, MODELS_BASE)
      onProgress?.({ phase: 'ready', loaded: 0, total: null })
      return { kind: 'fused', gallery, embedder }
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
      console.warn('Recognizer: fused gallery unavailable, falling back to colour matching.', err)
    }
  }
  const gallery = await loadGallery(COLOR_GALLERY, MODELS_BASE)
  onProgress?.({ phase: 'ready', loaded: 0, total: null })
  return { kind: 'color', gallery, embedder: null, reason }
}

async function loadEmbedder(onProgress?: (p: LoadProgress) => void): Promise<Embedder> {
  if (typeof WebAssembly !== 'object') throw new Error('This browser has no WebAssembly')
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  // One thread: multi-threading needs cross-origin isolation headers the host
  // doesn't send, and the runtime would only warn and fall back anyway.
  ort.env.wasm.numThreads = 1

  const bytes = await fetchWithProgress(`${MODELS_BASE}${MODEL_FILE}`, (loaded, total) =>
    onProgress?.({ phase: 'model', loaded, total }),
  )
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  if (!session.inputNames.includes(MODEL_INPUT) || !session.outputNames.includes(MODEL_OUTPUT)) {
    throw new Error(`Model ${MODEL_FILE} has inputs ${session.inputNames} / outputs ${session.outputNames}, expected ${MODEL_INPUT} -> ${MODEL_OUTPUT}`)
  }
  return createEmbedder({
    async run(data, dims) {
      const out = await session.run({ [MODEL_INPUT]: new ort.Tensor('float32', data, dims) })
      return out[MODEL_OUTPUT].data as Float32Array
    },
  })
}

/** fetch() that reports bytes as they arrive, so the veil can show a number
 * instead of a spinner on a slow first load. */
async function fetchWithProgress(url: string, onProgress: (loaded: number, total: number | null) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status})`)
  const header = res.headers.get('content-length')
  const total = header ? Number(header) || null : null
  onProgress(0, total)
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress(loaded, total)
  }
  const out = new Uint8Array(loaded)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
