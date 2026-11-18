import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Never inline assets as data: URIs, so the strict Content-Security-Policy holds.
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
});
