import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        diary: new URL('index.html', import.meta.url).pathname,
        'google-auth': new URL('google-auth/index.html', import.meta.url).pathname,
      },
    },
  },
})
