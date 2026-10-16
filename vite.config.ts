import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    server: {
      port: 3000,
      host: '127.0.0.1'
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      // Increase chunk size warning limit (default is 500kb)
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching
          manualChunks: {
            // Vendor chunks - rarely change, cache well
            'vendor-react': ['react', 'react-dom'],
            'vendor-d3': ['d3'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-ui': ['lucide-react', 'zustand'],
            // AI/API chunks
            'vendor-ai': ['@google/genai'],
          },
        },
      },
      // Enable source maps for production debugging (optional)
      sourcemap: mode === 'development',
    },
  };
});
