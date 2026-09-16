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
        // The nearest-neighbour gallery (public/models, ~0.7 MB) and the in-store
        // flavor photos ship with the build and must be there with the wifi down.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,json,bin}'],
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
