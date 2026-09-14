// Sample box records so a judge can open the live link and see Records/Stats working
// without needing real chocolates on hand. Deterministic (seeded), so it looks the
// same on every load instead of reshuffling each time demo mode is toggled.

import type { BoxRecord } from '../domain/types.ts'
import { BOX_SIZES } from '../domain/types.ts'
import { FLAVORS } from '../data/flavors.ts'

function mulberry32(seed: number) {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function generateDemoRecords(count = 24, now = Date.now()): BoxRecord[] {
  const rng = mulberry32(20260914)
  const records: BoxRecord[] = []

  for (let i = 0; i < count; i++) {
    const size = pick(BOX_SIZES, rng)
    const distinctCount = Math.max(2, Math.min(6, Math.round(size / 4)))

    const flavorIds = new Set<string>()
    while (flavorIds.size < distinctCount) flavorIds.add(pick(FLAVORS, rng).id)
    const ids = [...flavorIds]

    const counts = new Map(ids.map((id) => [id, 1]))
    let leftover = size - distinctCount
    while (leftover > 0) {
      const id = pick(ids, rng)
      counts.set(id, (counts.get(id) ?? 0) + 1)
      leftover--
    }

    const durationMs = Math.round((15 + size * 1.8 + rng() * 10) * 1000)
    const startedAt = now - (count - i) * 3_600_000 - durationMs
    const completedAt = startedAt + durationMs

    records.push({
      id: `demo-${i}`,
      size,
      pieces: ids.map((flavorId) => ({ flavorId, count: counts.get(flavorId) ?? 1 })),
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs,
      undoCount: rng() < 0.2 ? 1 : 0,
      method: 'tap',
      demo: true,
    })
  }

  return records
}
