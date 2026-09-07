# 部署说明（让评委公网直接体验）

本项目主体是**单进程 Node 服务**：托管前端静态文件 + 代理知乎 API。可选搭配一个 Python 文档解析服务（见方式三）。

> ⚠️ **必须保证部署时执行了前端构建**（`npm run build` 生成 `dist/`）：`server.mjs` 只托管 `dist/`
> （D-10 起旧版 `public/` 原型页已删除，不再有回退）。未构建就启动的话，所有页面会返回 404（页面内提示先构建），
> 评委将直接看到错误页——构建这步不能省。

## 选型结论（2026-09-06）：Railway 优于 Vercel

一句话：**我们部署的是"一整台一直开着的小电脑"，Vercel 擅长的是"用完即走的临时函数"，两者不是一回事。**

| 对比项 | Railway（推荐） | Vercel | 对本项目的影响 |
|---|---|---|---|
| 服务形态 | 常驻 Node 进程，照跑 `node server.mjs` | 只认 serverless 函数（按路由拆、有冷启动） | 现在代码零改动直接上 Railway；上 Vercel 要把 `server.mjs` 拆成十几个函数、大改 |
| 构建产物托管 | 自己托管 `dist/`，SPA 路由自己控制 | 平台管静态托管 | Railway 与本地行为完全一致 |
| 长耗时 AI 调用 | 无时长限制 | 免费档函数有执行时长限制 | 炼金一次要 10 秒级多次调知乎直答，Vercel 容易超时 |
| 环境变量/密钥 | 平台 Variables，随便加 | 支持，但要逐函数配权限 | Railway 省心 |
| 中文路径/文件名资源 | 文件系统自管 | 文件系统只读（/tmp） | 刘看山 GIF、导出等按常规文件走，Railway 无坑 |
| OAuth 公网回调 | HTTPS 域名即支持 | HTTPS 域名即支持 | 两者持平 |
| 费用 | 新账号送试用额度，够演示 | 免费档可用但处处受限 | Railway 够用 |

结论：**Railway**。Vercel 适合"纯静态站 + 几个轻接口"的形态，我们的应用是长耗时 AI + 常驻 API + 自托管产物，
硬塞进 Vercel 会付出大改代价、换来更多超时/冷启动风险，不值得。
（日后若产品收敛成"纯前端展示页 + 少量接口"，再考虑把静态部分搬到 Vercel 提速。）

## 方式一：Railway（推荐，免费额度够用）
1. 注册 https://railway.app ，用 GitHub 登录并连接本仓库。
2. 新建 Project → Deploy from GitHub repo，选择本仓库。
3. 构建/启动已由根目录 `nixpacks.toml` 显式定义：`npm ci` → `npm run build` → `node server.mjs`，无需在页面里改任何命令。
4. Variables 中可加 `OPENAI_API_KEY`（拿到后填，不填则跑演示模式；旧名 `ZHIHU_ACCESS_SECRET` 仍兼容，见下表）。完整变量清单见根目录 `.env.example`。
5. 部署完成会自动给一个公网域名，`PORT` 由平台注入，无需手动设。
6. 验证：浏览器打开公网域名；再访问 `/api/health` 看密钥与额度是否正常。

## 方式二：Render
1. 注册 https://render.com ，New → Web Service，连接 GitHub 仓库。
2. **Build Command 填 `npm install && npm run build`**（不要留空——留空可能不生成 `dist/`，导致回退旧版页面），Start Command 填 `npm start`。
3. 同上加 `OPENAI_API_KEY` 环境变量（可选；旧名 `ZHIHU_ACCESS_SECRET` 仍兼容）。
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
| `OPENAI_API_KEY` | 否 | 知乎开放平台 Access Secret（OpenAI 兼容命名）。不填 → 演示模式（话题自适应兜底，功能完整）。旧名 `ZHIHU_ACCESS_SECRET` 保留为回退，仍可识别（见 D-11）。⚠️ 额度提示（`[已修订 2026-09-01]`）：当前 Secret 已是**赛事专用额度**——直答 Total 100（剩余 98）、热榜 100、知乎搜索 5000、全网搜 5000、知识库 500，公网部署够用，无需更换。若后续更换 Secret，部署前用 `/api/health` 复核额度即可（该接口走免费额度查询，不消耗配额）。原「2026-08-30 试用额度：直答 Total 2 / 热榜 2 / 搜索 10」为使用另一 Secret 时的观测值，已作废，不作为部署依据。 |
| `OPENAI_BASE_URL` | 否 | 直答端点（OpenAI 兼容），默认 `https://developer.zhihu.com/v1`（知乎直答现状，调用 `{OPENAI_BASE_URL}/chat/completions`）。可指向任意 OpenAI 兼容服务。 |
| `OPENAI_MODEL` | 否 | 直答模型名，默认 `zhida-fast-1p5`（知乎直答现状）。 |
| `STEPFUN_API_KEY` | 否 | 阶跃星辰（StepFun）API Key，`/api/resume` 结构化抽取**优先**用它（独立于知乎额度）。不填则回退知乎直答（消耗直答 100 次/天额度），两者都无 → 提示手动填写。 |
| `STEPFUN_API_URL` | 否 | StepFun 端点，默认 `https://api.stepfun.com/step_plan/v1/chat/completions`。 |
| `STEPFUN_MODEL` | 否 | StepFun 模型名，默认 `step-3.7-flash`。 |
| `PORT` | 否 | 平台自动注入，本地默认 3000。 |
| `CACHE_TTL` | 否 | 缓存秒数，默认 3600。 |
| `MD_SERVICE_URL` | 否 | MarkItDown 文档解析服务地址，默认 `http://127.0.0.1:8011`。**后续拓展模块，演示链路不依赖**（见方式三）。 |

## 评委体验保障
- 未配 Secret：任意话题均返回**话题自适应演示内容**，四大模块完整可操作。
- 已配 Secret：基于知乎真实高赞生成；额度耗尽自动回落演示兜底，**永不白屏**。
