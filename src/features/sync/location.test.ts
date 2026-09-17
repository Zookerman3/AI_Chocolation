import { beforeEach, describe, expect, it } from 'vitest'
import { loadLocationId, LOCATIONS, locationName, saveLocationId } from './location.ts'

beforeEach(() => localStorage.clear())

describe('device location', () => {
  it('is unset until someone sets it', () => {
    expect(loadLocationId()).toBeUndefined()
  })

  it('round-trips', () => {
    saveLocationId('bradley')
    expect(loadLocationId()).toBe('bradley')
    expect(locationName('bradley')).toBe('Bradley Fair')
  })

  it('treats blank as unset rather than storing an empty label', () => {
    saveLocationId('   ')
    expect(loadLocationId()).toBeUndefined()
  })

  it('clears', () => {
    saveLocationId('vegas')
    saveLocationId(undefined)
    expect(loadLocationId()).toBeUndefined()
  })

  it('shows an unknown id rather than hiding it', () => {
    expect(locationName('pop-up-stall')).toBe('pop-up-stall')
    expect(locationName(undefined)).toBe('Not set')
  })

  it('lists the four shops', () => {
    expect(LOCATIONS.map((l) => l.id)).toEqual(['downtown', 'bradley', 'newmarket', 'vegas'])
  })
})
