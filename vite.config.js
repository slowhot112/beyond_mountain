import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 构建产物输出到 dist/，由 server.mjs 托管（生产模式）
// 开发模式用 vite dev server，前端通过 /api 代理到 Node 后端
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true, // 端口被占用时直接报错，而不是自动跳到 5174
    proxy: {
      // 开发时把 /api 请求转发给 Node 后端（默认 3000）
      '/api': 'http://localhost:3000',
    },
  },
});
