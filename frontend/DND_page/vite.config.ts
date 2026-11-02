import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// React Compiler runs as a Babel plugin. Requires React 19 (or React 18 + react-compiler-runtime).
export default defineConfig({
  plugins: [react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })],
  server: {
    // Forward /api/* to FastAPI so you don't need CORS in dev.
    proxy: { '/api': { target: 'http://backend:8000', changeOrigin: true } },
  },
})
