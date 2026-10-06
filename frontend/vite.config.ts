import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Keep three.js out of the main bundle; only the Train tab needs it.
        manualChunks: (id) =>
          id.includes('node_modules/three') || id.includes('@react-three') ? 'three' : undefined,
      },
    },
  },
})
