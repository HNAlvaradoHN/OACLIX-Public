import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const androidShell = mode === 'android'

  return {
    base: androidShell ? '/app/' : '/',
    plugins: androidShell ? [react()] : [react(), cloudflare()],
    build: androidShell
      ? {
          outDir: 'dist-android',
          emptyOutDir: true,
        }
      : undefined,
  }
})
