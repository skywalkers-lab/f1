import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? ''
const baseFromEnv = process.env.VITE_BASE_PATH || process.env.BASE_PATH || ''
const pagesBase = process.env.GITHUB_ACTIONS === 'true' && repoName ? `/${repoName}/` : '/'

export default defineConfig({
  plugins: [react()],
  base: baseFromEnv || pagesBase,
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8765',
        ws: true,
      },
      '/state': {
        target: 'http://127.0.0.1:8765',
      },
      '/health': {
        target: 'http://127.0.0.1:8765',
      },
      '/debug': {
        target: 'http://127.0.0.1:8765',
      },
      '/ml': {
        target: 'http://127.0.0.1:8765',
      },
      '/replay': {
        target: 'http://127.0.0.1:8765',
      },
      '/sessions': {
        target: 'http://127.0.0.1:8765',
      },
      '/analysis': {
        target: 'http://127.0.0.1:8765',
      },
      '/setup': {
        target: 'http://127.0.0.1:8765',
      },
    },
  },
})
