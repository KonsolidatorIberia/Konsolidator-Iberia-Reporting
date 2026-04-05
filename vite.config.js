import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
 server: {
  proxy: {
    '/v2': {
      target: 'https://api.konsolidator.com',
      changeOrigin: true,
      secure: true,
      bypass(req) {
        req.headers['cache-control'] = 'no-cache';
      },
    }
  }
}
      }
    )