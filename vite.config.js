import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api/kis': {
        target: 'https://openapi.koreainvestment.com:9443',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kis/, ''),
        secure: true,
      },
    },
  },
})
