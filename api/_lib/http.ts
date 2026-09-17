// Minimal structural types for a Vercel Node serverless function.
//
// Deliberately NOT importing @vercel/node: that would add a dependency to every
// teammate's install for two interfaces. Vercel passes Node's IncomingMessage /
// ServerResponse with `body`, `query` and `json()` bolted on, and structural
// typing matches that exactly.

export interface ApiRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface ApiResponse {
  status(code: number): ApiResponse
  setHeader(name: string, value: string | string[]): void
  json(body: unknown): void
  end(body?: string): void
}

/** Reads a query parameter that may arrive repeated. */
export function param(req: ApiRequest, name: string): string | undefined {
  const value = req.query?.[name]
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed === '' ? undefined : trimmed
}

export function header(req: ApiRequest, name: string): string | undefined {
  const value = req.headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads are public on purpose: the rubric's first gate is that the link opens
 * with no login and no install, and a dashboard behind auth fails it. Writes are
 * gated by a shared token when SYNC_TOKEN is set.
 */
export function applyCors(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-sync-token')
  res.setHeader('Access-Control-Max-Age', '86400')
  res.setHeader('Vary', 'Origin')
}

export function preflight(req: ApiRequest, res: ApiResponse): boolean {
  if (req.method !== 'OPTIONS') return false
  applyCors(res)
  res.status(204).end()
  return true
}

export function fail(res: ApiResponse, status: number, message: string, extra?: Record<string, unknown>): void {
  applyCors(res)
  res.status(status).json({ error: message, ...extra })
}

/** Writes need the shared token once SYNC_TOKEN is configured. Until then they
 * are open, and /api/health says so rather than pretending otherwise. */
export function writeAllowed(req: ApiRequest): { ok: true } | { ok: false; why: string } {
  const expected = process.env.SYNC_TOKEN
  if (!expected) return { ok: true }
  const given = header(req, 'x-sync-token')
  if (!given) return { ok: false, why: 'This API requires an x-sync-token header.' }
  if (given !== expected) return { ok: false, why: 'That sync token is not valid.' }
  return { ok: true }
}

export function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}
