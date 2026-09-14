// Regenerates src/data/flavors.json from Cocoa Dolce's public Shopify product feed.
// Source: https://cocoadolce.com/products.json (public storefront API, no auth).
//
// The store's product *handles* are mislabeled for two items (a known data quirk noted
// in CLAUDE.md): the handle "amaretto-copy" is actually "Confetti Cake", and
// "confetti-cake-copy" is actually "Tea & Honey". We identify every flavor by its
// product *title*, and derive the FlavorId by slugifying the title, so this mislabeling
// never leaks into the app.
//
// Run with: node scripts/fetch-flavors.mjs

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const STORE_URL = 'https://cocoadolce.com/products.json?limit=250'
const OUT_PATH = fileURLToPath(new URL('../src/data/flavors.json', import.meta.url))

// Bonbons are the $3.35 individually-sold "Assortment" products tagged "individual
// chocolates". This excludes bars, cookies, macarons, boxed sets, gift cards, and
// shipping labels, which share the product feed but aren't display-case flavors.
const BONBON_PRICE = '3.35'
const BONBON_PRODUCT_TYPE = 'Assortment'
const BONBON_TAG = 'individual chocolates'

const CHOCOLATE_TAGS = new Map([
  ['Dark Chocolate', 'dark'],
  ['Milk Chocolate', 'milk'],
  ['White Chocolate', 'white'],
  ['Gold Chocolate', 'gold'],
])

const SEASONAL_TAGS = new Set([
  'fall',
  'fall favorites',
  'christmas',
  'holiday',
  'winter favorites',
  'summer',
  'valentine',
  'seasonal',
])

function slugify(title) {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents (NFD): é -> e
    .toLowerCase()
    .replace(/'/g, '') // S'Mores -> smores
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function main() {
  return fetch(STORE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Cocoa Dolce store feed returned ${res.status}`)
      return res.json()
    })
    .then(({ products }) => {
      const bonbons = products.filter(
        (p) =>
          p.product_type === BONBON_PRODUCT_TYPE &&
          p.variants?.[0]?.price === BONBON_PRICE &&
          (p.tags ?? []).includes(BONBON_TAG),
      )

      const seen = new Map()
      for (const p of bonbons) {
        const id = slugify(p.title)
        const existing = seen.get(id)
        if (existing && existing.handle !== p.handle) {
          throw new Error(`Slug collision: "${p.title}" from both ${existing.handle} and ${p.handle}`)
        }
        seen.set(id, p)
      }

      const flavors = bonbons
        .map((p) => {
          const tags = p.tags ?? []
          const chocolate = tags.map((t) => CHOCOLATE_TAGS.get(t)).find(Boolean) ?? null
          const allergens = tags.filter((t) => t.endsWith(' Allergy')).map((t) => t.replace(/ Allergy$/, ''))
          const seasonal = tags.some((t) => SEASONAL_TAGS.has(t.toLowerCase()))
          return {
            id: slugify(p.title),
            name: p.title,
            imageUrl: p.images?.[0]?.src ?? '',
            chocolate,
            allergens,
            seasonal,
            sourceUrl: `https://cocoadolce.com/products/${p.handle}`,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      const out = {
        fetchedAt: new Date().toISOString(),
        source: STORE_URL,
        flavors,
      }
      return writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
        .then(() => console.log(`Wrote ${flavors.length} flavors to src/data/flavors.json`))
    })
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
