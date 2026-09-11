import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Bee Hive Dashboard — Vite configuration.
// - base: './' so built assets resolve correctly when served from any path
//   (the dashboard is served as static files by hive-server at /).
// - server.proxy forwards /api/* to the hive-server during dev so that
//   `npm run dev` works end-to-end without CORS.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../scripts/hive-dist',
    emptyOutDir: true,
  },
});
