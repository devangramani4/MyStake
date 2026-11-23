import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: proxy API + WebSocket so the app runs same-origin (refresh cookie is SameSite=Strict).
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/health': { target: 'http://localhost:4000' },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
  preview: { port: 4173 },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks; route pages are split via React.lazy.
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts') || id.includes('d3-')) return 'charts';
            if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) return 'react';
            if (id.includes('@reduxjs') || id.includes('react-redux') || id.includes('immer')) return 'state';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
