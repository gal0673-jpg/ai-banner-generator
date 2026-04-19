import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin API in dev when client/.env has VITE_API_URL= (empty)
      '/auth': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/avatar-studio/generate': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/generate': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/banners': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/status': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/tasks': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/upload-temp-asset': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/admin': { target: 'http://127.0.0.1:8888', changeOrigin: true },
      '/task-files': { target: 'http://127.0.0.1:8888', changeOrigin: true },
    },
  },
})
