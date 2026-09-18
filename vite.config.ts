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
        theme_color: '#9e8959',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The recognizer ships with the build and must be there with the wifi
        // down: the galleries (public/models, ~4 MB), the network
        // (mobilenetv2.onnx, 2.5 MB), the WebAssembly runtime that runs it
        // (~14 MB, emitted by Vite from onnxruntime-web) and the in-store flavor
        // photos. Workbox's default cap is 2 MiB per file, hence the override.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,json,bin,onnx,wasm}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Flavor photos are hosted on Shopify's CDN, off-origin, so the default
        // precache (same-origin build output) doesn't cover them. Cache each one
        // the first time it's viewed, so the case is still browsable offline
        // after that — the actual failure mode this app needs to survive: a
        // dropped connection mid-shift, not a cold start with zero network ever.
        runtimeCaching: [
          {
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
