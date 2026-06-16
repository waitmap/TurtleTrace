import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/kline/sina': {
        target: 'https://money.finance.sina.com.cn',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/kline\/sina/, ''),
      },
      '/api/kline/eastmoney': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/kline\/eastmoney/, ''),
      },
    },
  },
})
