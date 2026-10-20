import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { apiPlugin } from './server/api-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiPlugin(env)],
    resolve: {
      alias: { '@': '/src' },
    },
  }
})
