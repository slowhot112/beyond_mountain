# 部署说明（让评委公网直接体验）

本项目是**单进程 Node 服务**：既托管前端静态文件，又代理知乎 API。零三方依赖、无数据库，开箱即部署。

## 方式一：Railway（推荐，免费额度够用）
1. 注册 https://railway.app ，用 GitHub 登录并连接本仓库。
2. 新建 Project → Deploy from GitHub repo，选择本仓库。
3. Settings → 启动命令填 `npm start`（或自动识别 `Procfile`）。
4. Variables 中可加 `ZHIHU_ACCESS_SECRET`（拿到后填，不填则跑演示模式）。
5. 部署完成会自动给一个公网域名，`PORT` 由平台注入，无需手动设。

## 方式二：Render
1. 注册 https://render.com ，New → Web Service，连接 GitHub 仓库。
2. Build Command 留空，Start Command 填 `npm start`。
3. 同上加 `ZHIHU_ACCESS_SECRET` 环境变量（可选）。
4. 部署后获得 `xxx.onrender.com` 公网地址。

## 环境变量
| 变量 | 必填 | 说明 |
|---|---|---|
| `ZHIHU_ACCESS_SECRET` | 否 | 知乎开放平台 Access Secret。不填 → 演示模式（话题自适应兜底，功能完整）。 |
| `STEPFUN_API_KEY` | 否 | 阶跃星辰（StepFun）API Key，用于简历结构化字段提取（见 `/api/resume`）。不填 → 简历解析降级为浏览器端 pdfjs/tesseract 兜底。 |
| `STEPFUN_API_URL` | 否 | StepFun 端点，默认 `https://api.stepfun.com/step_plan/v1/chat/completions`。 |
| `STEPFUN_MODEL` | 否 | StepFun 模型名，默认 `step-3.7-flash`。 |
| `PORT` | 否 | 平台自动注入，本地默认 3000。 |
| `CACHE_TTL` | 否 | 缓存秒数，默认 3600。 |
| `MD_SERVICE_URL` | 否 | MarkItDown 本地服务地址，默认 `http://127.0.0.1:8011`，简历上传 `/api/parse-doc` 用。 |

## 评委体验保障
- 未配 Secret：任意话题均返回**话题自适应演示内容**，四大模块完整可操作。
- 已配 Secret：基于知乎真实高赞生成；额度耗尽自动回落演示兜底，**永不白屏**。
