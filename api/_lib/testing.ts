// A tiny stand-in for Vercel's request/response pair, so the handlers can be
// exercised as ordinary functions in a unit test.

import type { ApiRequest, ApiResponse } from './http.ts'

export interface Captured {
  status: number
  headers: Record<string, string | string[]>
  body: unknown
  ended: boolean
}

export function makeRequest(init: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    headers: {},
    query: {},
    ...init,
  }
}

export function makeResponse(): { res: ApiResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: undefined, ended: false }
  const res: ApiResponse = {
    status(code) {
      captured.status = code
      return res
    },
    setHeader(name, value) {
      captured.headers[name] = value
    },
    json(body) {
      captured.body = body
      captured.ended = true
    },
    end(body) {
      if (body !== undefined) captured.body = body
      captured.ended = true
    },
  }
  return { res, captured }
}
