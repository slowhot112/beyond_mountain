# 知乎炼金术 · Zhihu Alchemy

> 知乎黑客松 2026「校园新锐季」· **知识炼金场** 赛道参赛作品
> 把知乎高赞讨论，用 AI 炼成你的知识卡片 · 学习路径 · 自测题。

---

## 一句话介绍

输入一个你想搞懂的话题，后端先调用**知乎搜索 API** 拉取真实高赞内容，再交给**知乎直答（大模型）API** 生成结构化学习材料，前端以卡片 / 路径 / 自测题三种形态呈现，并支持一键导出 Markdown 学习地图。

## 核心特性

- 🎯 **真实知乎生态**：后端直连官方开放平台 API（搜索 / 热榜 / 直答），非假数据。
- 🧭 **人群模式**：职场新人 / 在校学生 / 通用，AI 针对性生成不同侧重点的学习方案。
- 🐻‍❄️ **刘看山 IP 联动**：以知乎官方 IP 作为引导形象，强化社区契合度。
- ⬇️ **可分享产出**：一键导出学习地图（Markdown），便于传播与攒人气。
- 🔌 **本地缓存**：自动缓存 API 结果，应对知乎 100 次/天 等频次限制。
- 🚀 **轻量技术栈**：后端仅用 Node 内置模块；前端 React + Vite 构建为纯静态文件，评委点开即用。

## 技术架构

```
┌─────────────┐     HTTP      ┌──────────────────┐    Bearer Token    ┌─────────────────┐
│  浏览器前端   │ ───────────▶ │  Node 轻量后端    │ ─────────────────▶ │ 知乎开放平台 API │
│ (纯静态页面)  │ ◀─────────── │ (API 代理+缓存)  │ ◀───────────────── │ 搜索/热榜/直答   │
└─────────────┘    JSON      └──────────────────┘   Secret 仅存后端   └─────────────────┘
```

- **前端**：React + Vite（组件化开发，构建产物为静态文件，由 Node 后端托管）。
- **后端**：Node.js（ESM），`server.mjs` 托管静态文件并代理知乎 API；`zhihu.js` 封装鉴权、缓存与三大接口。
- **鉴权**：仅需 `Access Secret`（赛事发放），请求头 `Authorization: Bearer <secret>` + `X-Request-Timestamp`，**无需 OAuth**。
- **缓存**：基于文件系统的极简 TTL 缓存，降低 API 调用频次。

## 本地运行

```bash
# 1. 安装依赖并启动（前端 React+Vite + Node 后端）
npm install
npm start                 # 启动 Node 后端（含静态托管），默认 3000 端口

# 2. 新终端：前端开发模式（热更新，默认 5173）
npm run dev
#    或生产构建： npm run build && npm run preview
```

> 知乎 API Secret 放在项目根目录 `.env`：`ZHIHU_ACCESS_SECRET=你的密钥`
> 没有密钥也能跑（自动走 mock 数据，方便演示）。

## 部署（供评委公网访问）

纯静态前端 + 一个 Node 进程，可一键部署到任意支持 Node 的平台（如 CloudBase /  Railway / 腾讯云函数等）。部署后直接提供公网链接即可，符合赛事"网页类项目提供公网 Demo"的要求。

## 接口一览

| 路由 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 + 当前模式（demo/live） |
| `GET /api/hot` | 知乎热榜（演示/真实） |
| `GET /api/search?q=` | 知乎搜索 |
| `GET /api/alchemy?q=&mode=` | 知识炼金主流程（搜索 + 直答） |

## 项目价值（可写进简历）

- 完整的前后端分离全栈实践，理解 HTTP 代理、鉴权头、API 限流与缓存。
- 真实第三方开放平台（知乎）API 集成经验。
- 围绕"AI + 真实社区场景"的产品设计思维，而非纯玩具 Demo。

## 简历文档解析（MarkItDown 服务，可选但推荐）

后端 `/api/parse-doc` 会把上传的简历文件转发给本地 **MarkItDown** 服务转成纯文本，
再交给 LLM 抽取结构化字段。支持 **PDF / Word / Excel / PPT / 图片（含扫描件 OCR）/ HTML / TXT / MD**。

前端已做兜底：若 MarkItDown 服务未启动，会自动回退到浏览器端 `pdfjs-dist` / `tesseract.js` 本地解析。

### 启动步骤（一次性）

```bash
# 安装 MarkItDown（含 OCR 插件）
pip install "markitdown[all]"

# 启动解析服务（默认 127.0.0.1:8011）
python md_server.py
# 或双击 start-md.bat
```

> 服务地址可在 Node 端用环境变量覆盖：`MD_SERVICE_URL=http://127.0.0.1:9000 npm start`

## 接口一览（统一 REST 信封）

所有 JSON 接口统一返回：
- 成功：`{ "ok": true, "data": { ... } }`
- 失败：`{ "ok": false, "code": "错误码", "message": "人话提示" }`

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 检测 Secret 是否配置/可达 |
| `/api/hot` | GET | 知乎热榜 |
| `/api/search?q=` | GET | 知乎搜索 |
| `/api/alchemy` | POST / GET | 知识炼金主流程 |
| `/api/resume` | POST | 简历文本 → 结构化字段（需先有文本） |
| `/api/parse-doc` | POST | 上传文档 → 纯文本（MarkItDown，需服务已启动） |
| `/api/oauth/config` | GET | 知乎 OAuth 配置 |
| `/api/oauth/callback` | GET | 知乎 OAuth 回调 |
