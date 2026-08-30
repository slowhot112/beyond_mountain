# 部署说明（让评委公网直接体验）

本项目主体是**单进程 Node 服务**：托管前端静态文件 + 代理知乎 API。可选搭配一个 Python 文档解析服务（见方式三）。

> ⚠️ **必须保证部署时执行了前端构建**（`npm run build` 生成 `dist/`）：`server.mjs` 只托管 `dist/`
> （D-10 起旧版 `public/` 原型页已删除，不再有回退）。未构建就启动的话，所有页面会返回 404（页面内提示先构建），
> 评委将直接看到错误页——构建这步不能省。

## 方式一：Railway（推荐，免费额度够用）
1. 注册 https://railway.app ，用 GitHub 登录并连接本仓库。
2. 新建 Project → Deploy from GitHub repo，选择本仓库。
3. Railway（nixpacks）会自动执行 `npm install` + `npm run build`（package.json 里有 build 脚本），再跑 `npm start`（或自动识别 `Procfile`）。若自定义了构建流程，请确保 `npm run build` 在启动前完成。
4. Variables 中可加 `ZHIHU_ACCESS_SECRET`（拿到后填，不填则跑演示模式）。
5. 部署完成会自动给一个公网域名，`PORT` 由平台注入，无需手动设。

## 方式二：Render
1. 注册 https://render.com ，New → Web Service，连接 GitHub 仓库。
2. **Build Command 填 `npm install && npm run build`**（不要留空——留空可能不生成 `dist/`，导致回退旧版页面），Start Command 填 `npm start`。
3. 同上加 `ZHIHU_ACCESS_SECRET` 环境变量（可选）。
4. 部署后获得 `xxx.onrender.com` 公网地址。

## 方式三（后续拓展，暂不部署）：Python 文档解析服务（MarkItDown）

> **定位（D-10，2026-08-30）**：`md_server.py` 是**后续拓展模块**，当前评委演示链路**不依赖它、不部署它**——
> 简历解析以浏览器端为主链路（PDF=pdfjs / DOCX=mammoth / 图片 OCR=tesseract.js / TXT·MD 直读，零服务端依赖）。
> MarkItDown 仅在未来需要覆盖冷门格式（.doc / .xls / .ppt）或扫描件时再启用。

能力边界（如实）：
- ✅ 文字版 PDF / Word / Excel / PPT / HTML / TXT / MD 的文本提取
- ❌ **扫描版 PDF / 纯图片 OCR**：MarkItDown 核心库不带 OCR。扫描件需要额外安装 `markitdown-ocr` 插件并配置 OpenAI 兼容的视觉 LLM 客户端；当前服务未配置。

将来启用时的部署步骤（以 Render 第二个免费 Web Service 为例）：
1. 同仓库新建一个 Web Service，Runtime 选 Python 3。
2. Build Command：`pip install "markitdown[all]"`；Start Command：`python md_server.py`。
3. 环境变量：`HOST=0.0.0.0`（**必须**，否则服务只监听本机，Node 后端连不上）、`PORT=8011`。
4. 回到主服务，设置环境变量 `MD_SERVICE_URL=https://<该服务的公网地址>`（或 Railway 内网地址 `http://<service>.railway.internal:8011`）。
5. 注意：Render 免费档 15 分钟无流量会休眠，首次请求有约 1 分钟冷启动（前端有浏览器端兜底，不会白屏）。

## 环境变量
| 变量 | 必填 | 说明 |
|---|---|---|
| `ZHIHU_ACCESS_SECRET` | 否 | 知乎开放平台 Access Secret。不填 → 演示模式（话题自适应兜底，功能完整）。 |
| `STEPFUN_API_KEY` | 否 | 阶跃星辰（StepFun）API Key，`/api/resume` 结构化抽取**优先**用它（独立于知乎额度）。不填则回退知乎直答（消耗直答 100 次/天额度），两者都无 → 提示手动填写。 |
| `STEPFUN_API_URL` | 否 | StepFun 端点，默认 `https://api.stepfun.com/step_plan/v1/chat/completions`。 |
| `STEPFUN_MODEL` | 否 | StepFun 模型名，默认 `step-3.7-flash`。 |
| `PORT` | 否 | 平台自动注入，本地默认 3000。 |
| `CACHE_TTL` | 否 | 缓存秒数，默认 3600。 |
| `MD_SERVICE_URL` | 否 | MarkItDown 文档解析服务地址，默认 `http://127.0.0.1:8011`。**后续拓展模块，演示链路不依赖**（见方式三）。 |

## 评委体验保障
- 未配 Secret：任意话题均返回**话题自适应演示内容**，四大模块完整可操作。
- 已配 Secret：基于知乎真实高赞生成；额度耗尽自动回落演示兜底，**永不白屏**。
