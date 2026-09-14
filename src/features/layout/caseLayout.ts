// The tablet's tile grid is meant to mirror the shop's physical display case, but we
// have no way to know the real layout without asking Cocoa Dolce staff (against the
// competition rules). So we ship a reasonable default grid and let the cashier
// rearrange it once, in-app, to match their counter. It's saved per device.

import type { CaseLayout, FlavorId } from '../../domain/types.ts'
import { FLAVORS } from '../../data/flavors.ts'

const STORAGE_KEY = 'ai-chocolation:case-layout'

export function defaultLayout(): CaseLayout {
  const ids = FLAVORS.map((f) => f.id)
  const cols = Math.ceil(Math.sqrt(ids.length))
  const rows = Math.ceil(ids.length / cols)
  const cells: (FlavorId | null)[] = Array.from({ length: rows * cols }, (_, i) => ids[i] ?? null)
  return { rows, cols, cells }
}

export function loadLayout(): CaseLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultLayout()
    const parsed = JSON.parse(raw) as CaseLayout
    const knownIds = new Set(FLAVORS.map((f) => f.id))
    const isValid =
      Array.isArray(parsed.cells) &&
      parsed.cells.length === parsed.rows * parsed.cols &&
      parsed.cells.every((c) => c === null || knownIds.has(c))
    return isValid ? parsed : defaultLayout()
  } catch {
    return defaultLayout()
  }
}

export function saveLayout(layout: CaseLayout): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
}

export function swapCells(layout: CaseLayout, indexA: number, indexB: number): CaseLayout {
  if (indexA === indexB) return layout
  const cells = [...layout.cells]
  const tmp = cells[indexA]
  cells[indexA] = cells[indexB]
  cells[indexB] = tmp
  return { ...layout, cells }
}
