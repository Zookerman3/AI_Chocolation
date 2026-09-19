import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'AI Chocolation',
        short_name: 'Chocolation',
        description: 'Capture what goes into every box, at the counter.',
        theme_color: '#1d2030',
        background_color: '#f7f6f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache only what the app needs to open: the shell, the icons, the
        // in-store flavor photos, and the 735 KB colour gallery that camera
        // assist falls back to. The big three — the 14 MB WebAssembly runtime,
        // the 2.5 MB network and the 3.1 MB fused gallery — are deliberately
        // NOT precached: asking a phone to store 20 MB before the app will even
        // start is a good way to have the install fail (iOS is strict about
        // this), and a failed install means the device is stuck on whatever
        // build it already had. They are cached on first use instead, by the
        // runtime rules below, so the camera still works offline after one use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,json,bin}'],
        globIgnores: ['**/models/gallery-fused.bin', '**/models/mobilenetv2.onnx'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // The recognizer's big files: same-origin, content-hashed or
            // revisioned by a rebuild, so cache-first and keep them.
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
              sameOrigin && (/\/models\/(gallery-fused\.bin|mobilenetv2\.onnx)$/.test(url.pathname) || url.pathname.endsWith('.wasm')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'camera-recognizer',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Flavor photos are hosted on Shopify's CDN, off-origin, so the
            // precache (same-origin build output) doesn't cover them. Cache each
            // one the first time it's viewed, so the case is still browsable
            // offline after that — the actual failure mode this app needs to
            // survive is a dropped connection mid-shift, not a cold start.
            urlPattern: ({ url }: { url: URL }) => url.hostname === 'cdn.shopify.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'flavor-photos',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['node_modules', 'dist', '.worktrees'],
  },
})
