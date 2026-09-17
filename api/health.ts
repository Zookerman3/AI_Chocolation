// GET /api/health — is the API up, is it durable, and how much does it hold.
//
// The dashboard calls this before it shows a "live" chip, so the chip can never
// claim a connection that is not there, and never claim durability the server
// does not have.

import { applyCors, fail, preflight } from './_lib/http.ts'
import type { ApiRequest, ApiResponse } from './_lib/http.ts'
import { getStore } from './_lib/store.ts'

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (preflight(req, res)) return
  if (req.method !== 'GET') {
    applyCors(res)
    res.setHeader('Allow', 'GET, OPTIONS')
    res.status(405).json({ error: 'Use GET.' })
    return
  }

  const store = getStore()
  try {
    const count = await store.count()
    applyCors(res)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ok: true,
      store: store.kind,
      durable: store.durable,
      // Said plainly, because a demo that silently forgets is worse than one
      // that admits it will.
      note: store.durable
        ? 'Boxes are stored durably.'
        : 'No database is configured, so boxes are held in memory and are lost when the serverless instance restarts. Add a Vercel KV / Upstash integration to make this durable.',
      writesProtected: Boolean(process.env.SYNC_TOKEN),
      count,
      time: new Date().toISOString(),
    })
  } catch (cause) {
    fail(res, 502, 'The box store did not answer.', {
      store: store.kind,
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
