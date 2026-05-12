import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  console.log('[vite] ANTHROPIC KEY loaded:', env.VITE_ANTHROPIC_KEY ? 'YES ✓' : 'NO ✗')

  return {
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
        },
        '/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/anthropic/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.VITE_ANTHROPIC_KEY);
              proxyReq.setHeader('anthropic-version', '2023-06-01');
            });
          },
        },
      }
    }
  }
})