import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    // 5173/5188 等端口属于本机其他项目，固定 5190 避免抢默认口
    port: 5190,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
