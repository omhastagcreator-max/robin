import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
