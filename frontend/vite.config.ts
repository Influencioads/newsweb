import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // The API is same-origin in production behind nginx; proxying in dev keeps
      // cookie/CORS behaviour identical between the two environments.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/media': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // §10.3 Core Web Vitals: keep the initial bundle small. Vendor chunks are
    // split so a CMS-only dependency never lands in the reader's critical path.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('react-hook-form') || id.includes('zod') || id.includes('@hookform'))
            return 'vendor-forms';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
} as Parameters<typeof defineConfig>[0]);
