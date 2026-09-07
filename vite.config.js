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
    // 默认输出到 repo 根下的 dist/（与 .gitignore 和 README「本地运行」一致，队友开箱即用）。
    // 如需自定义输出目录（如本机交付目录），用环境变量 KAN_DIST 覆盖：KAN_DIST=E:/kan-dist npm run build
    outDir: process.env.KAN_DIST || 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true, // 端口被占用时直接报错，而不是自动跳到 5174
    proxy: {
      // 开发时把 /api 请求转发给 Node 后端（默认 3000；npm run dev 一键启动时由 dev.mjs 自动注入实际端口）
      '/api': process.env.API_PROXY_TARGET || 'http://localhost:3000',
    },
  },
});
