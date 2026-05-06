import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import 'dotenv/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5175,
    proxy: {
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        headers: {
          'x-api-key': process.env.VITE_ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
        }
      }
    }
  },
  build: {
    outDir: 'dist',
  },
})
