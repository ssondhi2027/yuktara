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
        // Keep three.js out of the main bundle: only the Train tab and the landing
        // page's 3D body load it, on demand. React gets a chunk of its own first,
        // or the bundler puts it in "three" (@react-three uses it) and every page
        // would download three.js to get React.
        manualChunks: (id) => {
          const p = id.split('\\').join('/')
          if (/node_modules\/(react|react-dom|scheduler)\//.test(p)) return 'react'
          if (p.includes('node_modules/three') || p.includes('@react-three')) return 'three'
          return undefined
        },
      },
    },
  },
})
