import { beforeEach, describe, expect, it } from 'vitest'
import { clearRecords, listRecords, saveRecord } from './records.ts'
import type { BoxRecord } from '../../domain/types.ts'

function record(id: string): BoxRecord {
  return {
    id,
    size: 6,
    pieces: [{ flavorId: 'amaretto', count: 6 }],
    startedAt: '2026-09-14T00:00:00.000Z',
    completedAt: '2026-09-14T00:00:10.000Z',
    durationMs: 10_000,
    undoCount: 0,
    method: 'tap',
    demo: false,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('records', () => {
  it('starts empty', () => {
    expect(listRecords()).toEqual([])
  })

  it('saves newest-first', () => {
    saveRecord(record('a'))
    saveRecord(record('b'))
    expect(listRecords().map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('clears everything', () => {
    saveRecord(record('a'))
    clearRecords()
    expect(listRecords()).toEqual([])
  })

  it('survives corrupted storage instead of throwing', () => {
    localStorage.setItem('ai-chocolation:records', 'not json')
    expect(listRecords()).toEqual([])
  })
})
