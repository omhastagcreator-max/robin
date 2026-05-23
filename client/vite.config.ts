import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

// Bake the deploy commit SHA into the bundle so the running client can
// compare against /api/version and self-update.
//
// Vercel auto-injects VERCEL_GIT_COMMIT_SHA on every deploy. For local
// dev we fall back to a wall-clock string so the version string just
// reflects "whenever you last hit save"; the version check is silently
// no-op'd at runtime when this equals 'dev'.
const BUILD_VERSION =
  process.env.VITE_BUILD_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  'dev';

export default defineConfig({
  plugins: [react()],
  define: {
    // Inline as a string literal — Vite replaces this at build time so
    // there's zero runtime cost and no risk of an undefined global.
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4002',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Push the warning threshold up: with our manual chunking the largest
    // single asset is `livekit` (~180 KB) which is intrinsic to huddle
    // functionality and can't be reduced without dropping the feature.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime.
          vendor:    ['react', 'react-dom', 'react-router-dom'],
          // Animation runtime — heavy, only needed once per visit.
          motion:    ['framer-motion'],
          // Charts (only AdminReports + ClientDashboard need it; before
          // this they were leaking into the main bundle on every page).
          charts:    ['recharts'],
          // Realtime networking — shared between huddle and chat.
          socket:    ['socket.io-client'],
          // LiveKit client — only loaded when the user enters the huddle.
          livekit:   ['livekit-client'],
          // Date utilities — date-fns ships every function as a separate
          // chunk by default, but it's still ~60 KB across the surfaces
          // we touch. Isolating it lets the browser cache it across
          // navigations.
          datefns:   ['date-fns', 'react-day-picker'],
          // Icon set — lucide-react has thousands of icons and we use
          // ~80. Tree-shaken, but the symbol overhead is non-trivial.
          icons:     ['lucide-react'],
          // OAuth flow — only needed on /login.
          oauth:     ['@react-oauth/google'],
          // Toasts — small but shared everywhere.
          toasts:    ['sonner'],
        },
      },
    },
  },
});
