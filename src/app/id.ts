// crypto.randomUUID() is only exposed in a secure context. A tablet opened over plain
// http on the shop's LAN — which is exactly how we'd demo it without a deploy — has
// window.crypto but no randomUUID, and starting a box would throw. Ids only need to be
// unique within one tablet's localStorage, so a fallback is fine.

export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
