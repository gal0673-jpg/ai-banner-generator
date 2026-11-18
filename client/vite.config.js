import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = 'http://127.0.0.1:8888'
const toApi = (extra = {}) => ({ target: API_TARGET, changeOrigin: true, ...extra })

/**
 * `/admin/*` is shared by the API (FastAPI admin endpoints) and the SPA (`/admin/catalog`).
 * Browser page navigations (Accept: text/html) must be served by Vite's index.html,
 * otherwise a refresh on /admin/catalog is proxied to FastAPI and returns a JSON 404.
 */
function serveSpaForPageNavigations(req) {
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    return '/index.html'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      // Allow importing shared design tokens from the repo root (e.g. ../shared/*).
      // Without this, Vite blocks files outside the client/ directory and the app can render blank.
      allow: ['..'],
    },
    // Same-origin API in dev when client/.env has VITE_API_URL= (empty).
    // Keep in sync with the routers included in api.py — any API prefix missing here
    // falls through to Vite (GET → index.html with 200, POST/PUT/DELETE → 404).
    proxy: {
      '/auth': toApi(),
      '/me/': toApi(), // /me/credits (routers/auth.py)
      '/avatar-studio/generate': toApi(),
      '/generate': toApi(), // also covers /generate-ugc
      '/banners': toApi(),
      '/status': toApi(),
      '/tasks': toApi(),
      '/upload-temp-asset': toApi(),
      '/business': toApi(), // BusinessProfile flow (routers/business.py)
      // Avatar Studio catalog (must match FastAPI routers/catalog.py)
      '/catalog': toApi(),
      '/admin': toApi({ bypass: serveSpaForPageNavigations }),
      '/task-files': toApi(),
      // Task status WebSocket (routers/ws.py) — same-origin so the auth cookie is sent.
      '/ws': toApi({ ws: true }),
    },
  },
})
