import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Shares the design tokens/components CSS with the customer web app.
  resolve: { alias: { '@shared-styles': fileURLToPath(new URL('../frontend/src/styles', import.meta.url)) } },
  server: {
    port: 5174,
    fs: { allow: ['..'] },
    proxy: { '/api': { target: 'http://localhost:4000' }, '/health': { target: 'http://localhost:4000' } },
  },
  preview: { port: 4174 },
});
