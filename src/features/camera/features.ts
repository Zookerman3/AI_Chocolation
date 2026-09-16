// One chocolate -> one 392-number fingerprint.
//
// This is the whole "model". No neural network, no download: a colour histogram,
// a tiny lightness-normalised thumbnail and a texture histogram, all computed
// from a 96x96 crop of a single cell. Measured on the four training sessions,
// leaving each one out in turn: 92.7% top-1, 97.0% top-3 (scripts/build-gallery.ts
// prints the current numbers). That clears the Phase 2 checkpoint without a
// 25 MB model, which matters at a counter on shop wifi.
//
// The same function builds the gallery (Node, scripts/build-gallery.ts) and
// classifies at the counter (browser). Never let those two drift: change this
// file, rebuild the gallery, and bump FEATURE_VERSION so a stale gallery is
// refused instead of silently mis-scoring.
//
// No DOM here: input is raw RGBA bytes so it runs in Node, a worker, or a test.

export const FEATURE_VERSION = 'v1-hsv12x4x4-lab8-tex8'
export const CROP = 96
export const FEATURE_DIM = 12 * 4 * 4 + 8 * 8 * 3 + 8 // 392

const W_HIST = 3.0
const W_THUMB = 1.0
const W_TEX = 2.5
const DISK_R2 = 36 * 36 // the bonbon sits inside this disk; the corners are cell wall

/** Area-average resize of RGBA pixels to CROP x CROP. Same as OpenCV INTER_AREA
 * for downscaling, which is what the gallery crops went through. */
export function resizeToCrop(src: Uint8ClampedArray | Uint8Array, sw: number, sh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CROP * CROP * 4)
  for (let y = 0; y < CROP; y++) {
    const y0 = Math.floor((y * sh) / CROP)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / CROP))
    for (let x = 0; x < CROP; x++) {
      const x0 = Math.floor((x * sw) / CROP)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / CROP))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4
        for (let xx = x0; xx < x1; xx++) {
          r += src[i]
          g += src[i + 1]
          b += src[i + 2]
          i += 4
          n++
        }
      }
      const o = (y * CROP + x) * 4
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
      out[o + 3] = 255
    }
  }
  return out
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

/** Fingerprint of one CROP x CROP RGBA image. L2-normalised, so cosine similarity
 * is a plain dot product. */
export function featureFromCrop(rgba: Uint8ClampedArray): Float32Array {
  const hist = new Float32Array(12 * 4 * 4)
  const lab = new Float32Array(CROP * CROP * 3)
  const gray = new Float32Array(CROP * CROP)
  let histTotal = 0

  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const p = y * CROP + x
      const i = p * 4
      const r = rgba[i]
      const g = rgba[i + 1]
      const b = rgba[i + 2]

      gray[p] = 0.299 * r + 0.587 * g + 0.114 * b

      // CIE Lab in OpenCV's 8-bit scaling (L*255/100, a+128, b+128)
      const rl = srgbToLinear(r)
      const gl = srgbToLinear(g)
      const bl = srgbToLinear(b)
      const X = (0.412453 * rl + 0.35758 * gl + 0.180423 * bl) / 0.950456
      const Y = 0.212671 * rl + 0.71516 * gl + 0.072169 * bl
      const Z = (0.019334 * rl + 0.119193 * gl + 0.950227 * bl) / 1.088754
      const fx = labF(X)
      const fy = labF(Y)
      const fz = labF(Z)
      lab[p * 3] = ((116 * fy - 16) * 255) / 100
      lab[p * 3 + 1] = 500 * (fx - fy) + 128
      lab[p * 3 + 2] = 200 * (fy - fz) + 128

      const dy = y - 48
      const dx = x - 48
      if (dy * dy + dx * dx > DISK_R2) continue

      // HSV, OpenCV 8-bit: H in 0..180, S and V in 0..255
      const v = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const delta = v - mn
      const s = v === 0 ? 0 : (255 * delta) / v
      let h = 0
      if (delta !== 0) {
        if (v === r) h = (60 * (g - b)) / delta
        else if (v === g) h = 120 + (60 * (b - r)) / delta
        else h = 240 + (60 * (r - g)) / delta
        if (h < 0) h += 360
      }
      const hb = Math.min(11, Math.floor(h / 2 / 15))
      const sb = Math.min(3, Math.floor(s / 64))
      const vb = Math.min(3, Math.floor(v / 64))
      hist[hb * 16 + sb * 4 + vb] += 1
      histTotal++
    }
  }

  // 8x8 Lab thumbnail with the lightness channel mean-centred, so a dim session
  // and a bright one produce the same fingerprint. This one change was worth
  // +5 points on the dimmest training session.
  const thumb = new Float32Array(8 * 8 * 3)
  let lMean = 0
  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      let L = 0
      let A = 0
      let B = 0
      for (let yy = ty * 12; yy < ty * 12 + 12; yy++) {
        for (let xx = tx * 12; xx < tx * 12 + 12; xx++) {
          const p = (yy * CROP + xx) * 3
          L += lab[p]
          A += lab[p + 1]
          B += lab[p + 2]
        }
      }
      const o = (ty * 8 + tx) * 3
      thumb[o] = L / 144
      thumb[o + 1] = A / 144
      thumb[o + 2] = B / 144
      lMean += thumb[o]
    }
  }
  lMean /= 64
  for (let i = 0; i < 64; i++) thumb[i * 3] -= lMean

  // Texture: histogram of Sobel gradient magnitude inside the disk. Splatter,
  // stripes and a smooth glaze land in different bins.
  const tex = new Float32Array(8)
  let texTotal = 0
  const at = (x: number, y: number) => {
    // BORDER_REFLECT_101, as OpenCV's Sobel does
    const xx = x < 0 ? -x : x >= CROP ? 2 * CROP - x - 2 : x
    const yy = y < 0 ? -y : y >= CROP ? 2 * CROP - y - 2 : y
    return gray[yy * CROP + xx]
  }
  for (let y = 0; y < CROP; y++) {
    for (let x = 0; x < CROP; x++) {
      const dy = y - 48
      const dx = x - 48
      if (dy * dy + dx * dx > DISK_R2) continue
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1)
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)
      const mag = Math.hypot(gx, gy)
      if (mag < 400) {
        tex[Math.floor(mag / 50)] += 1
        texTotal++
      }
    }
  }

  const out = new Float32Array(FEATURE_DIM)
  let o = 0
  for (let i = 0; i < hist.length; i++) out[o++] = (hist[i] / (histTotal + 1e-6)) * W_HIST
  for (let i = 0; i < thumb.length; i++) out[o++] = (thumb[i] / 255) * W_THUMB
  for (let i = 0; i < tex.length; i++) out[o++] = (tex[i] / (texTotal + 1e-6)) * W_TEX

  let norm = 0
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm) + 1e-9
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}
