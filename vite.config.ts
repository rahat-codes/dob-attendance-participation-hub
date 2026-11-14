import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  return {
    mode: 'production',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'api-time-dev-endpoint',
        configureServer(server) {
          server.middlewares.use('/api/time', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify({ nowMs: Date.now() }));
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'motion/react'],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase')) {
              return 'firebase-vendor';
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'icons-vendor';
            }
            if (id.includes('node_modules/motion')) {
              return 'motion-core';
            }
          },
        },
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
      // HMR WebSocket is not supported across the Cloud Run reverse proxy.
      // Disabling HMR stops Vite from attempting WebSocket connections.
      hmr: false,
    },
  };
});
