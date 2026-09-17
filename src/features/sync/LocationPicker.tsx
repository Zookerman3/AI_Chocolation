// Set once, when the tablet is put on the counter. Lives on the Records screen
// because it is a setup task, not something a cashier touches mid-rush.

import { useState } from 'react'
import { loadLocationId, LOCATIONS, saveLocationId } from './location.ts'

export function LocationPicker({ onChange }: { onChange?: (id: string | undefined) => void }) {
  const [value, setValue] = useState<string>(() => loadLocationId() ?? '')

  function pick(next: string) {
    setValue(next)
    saveLocationId(next || undefined)
    onChange?.(next || undefined)
  }

  return (
    <div className="location-picker">
      <label htmlFor="tablet-location">This tablet is at</label>
      <select id="tablet-location" value={value} onChange={(e) => pick(e.target.value)}>
        <option value="">Not set</option>
        {LOCATIONS.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <p>
        {value
          ? 'Stamped onto every box saved from now on, so the office can split production by shop.'
          : 'Until this is set, boxes from this tablet arrive at the office unlabelled and cannot be split by shop.'}
      </p>
    </div>
  )
}
