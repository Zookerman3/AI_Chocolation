// Which shop this tablet stands in.
//
// Chosen once per device and stored locally, exactly like the case layout. It is
// stamped onto every box saved afterwards, which is what lets the office split
// production numbers by store — the single thing a multi-unit operator asks for
// first, and the reason this field exists at all.

const LOCATION_KEY = 'ai-chocolation:location'

export interface ShopLocation {
  id: string
  name: string
}

/** The public Cocoa Dolce locations. "Other" keeps a tablet honest rather than
 * forcing it into a shop it is not in. */
export const LOCATIONS: ShopLocation[] = [
  { id: 'downtown', name: 'Downtown HQ' },
  { id: 'bradley', name: 'Bradley Fair' },
  { id: 'newmarket', name: 'NewMarket Square' },
  { id: 'vegas', name: 'Fontainebleau Las Vegas' },
]

export function loadLocationId(): string | undefined {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    return raw && raw.trim() ? raw : undefined
  } catch {
    return undefined
  }
}

export function locationName(id: string | undefined): string {
  if (!id) return 'Not set'
  return LOCATIONS.find((l) => l.id === id)?.name ?? id
}

export function saveLocationId(id: string | undefined): void {
  try {
    if (id && id.trim()) localStorage.setItem(LOCATION_KEY, id.trim())
    else localStorage.removeItem(LOCATION_KEY)
  } catch {
    // A tablet with no storage still records boxes; they just arrive unlabelled.
  }
}
