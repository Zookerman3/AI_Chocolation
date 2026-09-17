// Where boxes live on the server.
//
// Two implementations behind one interface, chosen at runtime:
//
//   redis   — Upstash REST, which Vercel's KV / Upstash integration provisions
//             and whose env vars it injects automatically. Durable. No SDK: the
//             REST API is plain fetch, so this adds zero dependencies.
//   memory  — the zero-configuration fallback. Survives within a warm serverless
//             instance and is lost on a cold start.
//
// The point of the fallback is that the API deploys and answers correctly on the
// very first push, before anyone has provisioned anything. `durable` is reported
// on /api/health so nobody mistakes the fallback for real persistence.

import type { BoxRecord } from './record.ts'

export interface BoxQuery {
  from?: Date
  to?: Date
  locationId?: string
  limit?: number
}

export interface Store {
  readonly kind: 'redis' | 'memory'
  readonly durable: boolean
  list(query: BoxQuery): Promise<BoxRecord[]>
  /** Idempotent on record id: re-posting the same box overwrites, never duplicates. */
  put(records: BoxRecord[]): Promise<{ written: number }>
  count(): Promise<number>
}

const KEY = 'ai-chocolation:boxes'
const MAX_RECORDS = 20_000

function sortNewestFirst(records: BoxRecord[]): BoxRecord[] {
  return records.sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1))
}

function applyQuery(records: BoxRecord[], query: BoxQuery): BoxRecord[] {
  let out = records
  if (query.from) {
    const from = query.from.getTime()
    out = out.filter((r) => new Date(r.completedAt).getTime() >= from)
  }
  if (query.to) {
    const to = query.to.getTime()
    out = out.filter((r) => new Date(r.completedAt).getTime() <= to)
  }
  if (query.locationId) {
    out = out.filter((r) => r.locationId === query.locationId)
  }
  out = sortNewestFirst([...out])
  if (query.limit && query.limit > 0) out = out.slice(0, query.limit)
  return out
}

// --- memory ---------------------------------------------------------------

const memory = new Map<string, BoxRecord>()

export function createMemoryStore(): Store {
  return {
    kind: 'memory',
    durable: false,
    async list(query) {
      return applyQuery([...memory.values()], query)
    },
    async put(records) {
      for (const record of records) memory.set(record.id, record)
      // Keep the fallback bounded; it is a demo aid, not a database.
      if (memory.size > MAX_RECORDS) {
        const excess = sortNewestFirst([...memory.values()]).slice(MAX_RECORDS)
        for (const record of excess) memory.delete(record.id)
      }
      return { written: records.length }
    },
    async count() {
      return memory.size
    },
  }
}

// --- redis (Upstash REST) --------------------------------------------------

interface RedisConfig { url: string; token: string }

function redisConfig(): RedisConfig | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

async function redisCommand(config: RedisConfig, command: (string | number)[]): Promise<unknown> {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  })
  if (!response.ok) {
    throw new Error(`Redis command failed with ${response.status}`)
  }
  const payload = (await response.json()) as { result?: unknown; error?: string }
  if (payload.error) throw new Error(payload.error)
  return payload.result
}

export function createRedisStore(config: RedisConfig): Store {
  return {
    kind: 'redis',
    durable: true,
    async list(query) {
      // One hash keyed by record id: idempotent writes for free, and a single
      // round trip to read. At a shop's volume (tens of boxes a day) reading the
      // whole hash and filtering here is cheaper than maintaining indexes.
      const result = (await redisCommand(config, ['HVALS', KEY])) as unknown
      if (!Array.isArray(result)) return []
      const records: BoxRecord[] = []
      for (const entry of result) {
        try {
          records.push(typeof entry === 'string' ? (JSON.parse(entry) as BoxRecord) : (entry as BoxRecord))
        } catch {
          // One corrupt value must not take the whole response down.
        }
      }
      return applyQuery(records, query)
    },
    async put(records) {
      if (records.length === 0) return { written: 0 }
      const args: (string | number)[] = ['HSET', KEY]
      for (const record of records) {
        args.push(record.id, JSON.stringify(record))
      }
      await redisCommand(config, args)
      return { written: records.length }
    },
    async count() {
      const result = await redisCommand(config, ['HLEN', KEY])
      return typeof result === 'number' ? result : 0
    },
  }
}

// --- selection -------------------------------------------------------------

export function getStore(): Store {
  const config = redisConfig()
  return config ? createRedisStore(config) : createMemoryStore()
}

/** Exposed for tests. */
export function resetMemoryStore(): void {
  memory.clear()
}

export { applyQuery }
