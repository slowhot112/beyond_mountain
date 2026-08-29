# 参考开源项目知识库（山外山 / 知乎黑客松 MVP）

> 本文件是「山外山」项目的**外部记忆**。所有技术栈、链接、借鉴点均来自 2026-08-27 实际核查的 GitHub 仓库页面，非凭印象。
> 用途：防止后续开发中出现幻觉、行号错乱、技术栈记错。每次要参考某项目前，先读这个文件。

### ⚠️ 使用说明（每次新对话先读这 3 个文件，以文件为准，不凭记忆）
- `DECISIONS.md` —— **已拍板的决策**（技术选型/产品范围），最高优先级
- `ZHIHU-API.md` —— 知乎 API 真实接口/上限/坑
- `REFERENCE-PROJECTS.md` —— 本文，8 个参考项目真相
> 新对话开头可直接复制：「先读 zhihu-alchemy 下的 DECISIONS.md、ZHIHU-API.md、REFERENCE-PROJECTS.md，所有信息以文件为准，不要凭记忆。」

---

## 0. 我们自己的现状（对比基线）

| 层 | 技术 | 证据 |
|---|---|---|
| 后端 | Node.js 原生 `http` 模块（`server.mjs`），零 Web 框架依赖 | `import { createServer } from 'node:http'` |
| 前端 | React 18 + Vite 5 + 原生 CSS（无 UI 库） | `package.json` 含 `react ^18.3.1`、`vite ^5.4.0`、`@vitejs/plugin-react` |
| AI/数据 | `zhihu.js` 调知乎 API + 文件缓存 + Mock 兜底 + StepFun 简历解析 | `.env.example` 含 `STEPFUN_*` |
| 启动 | `npm start`（生产/Node 后端）/ `npm run dev`（Vite 热更新） | `package.json` scripts |

**结论**：现为「React + Vite 前端 + Node 原生后端」结构。决策日志 `DECISIONS.md` D-01/D-02 拍板定档（D-01：前端从原生 JS 升 React；D-02：后端保留 Node 原生 http）。

---

## 1. 参考项目总览表（技术栈已核实）

| # | 项目 | 语言/后端 | 前端 | 是否 Web UI | 最终是否给结论 | Star |
|---|---|---|---|---|---|---|
| 1 | both-sides-research | 无代码（Markdown+YAML Skill） | 无 | 否（纯提示词资产） | 是（证据支撑结论） | 0 |
| 2 | DialecticEngine | Python + Flask + SSE | Vanilla JS | 是（完整前端） | 是（辩证综合） | 0 |
| 3 | devils-advocate | 无代码（Skill，需 agent harness） | 无 | 否 | 是（主席综合+自攻） | 0 |
| 4 | multi-agent-debate | Python + FastAPI + WebSocket | 原生 HTML/CSS/JS | 是 | 是（投票共识 ≥60%） | 0 |
| 5 | debate-ai | 零后端（纯前端） | Alpine.js + Tailwind | 是（轻量） | 是（consensus） | 0 |
| 6 | concilium-llm | Python（CLI） | 无 | 否（命令行） | 是（加权共识） | 0 |
| 7 | Multi-Agents-Debate | Python（脚本） | 无 | 否（CLI） | 框架无 UI（背书用） | 608 |
| 8 | **ArguMesh**（用户给的） | **Hono 4 + Node** | **React 19 + Vite 6** | 是 | 否（留白/溯源） | 3 |

**关键规律**：带完整 Web 前端的（DialecticEngine、multi-agent-debate、debate-ai、ArguMesh）**几乎都用前端框架或至少结构化 JS**；纯框架/CLI 的才不用。→ 我们做交互型 Web，应上框架。

---

## 2. 逐项目详解（为什么参考 / 怎么实现 / 怎么做）

### 项目 1：both-sides-research
- **链接**：https://github.com/PSkinnerTech/both-sides-research
- **技术栈**：纯 Markdown 文档 + YAML（无代码，是一个"可移植 AI Agent 技能"）
- **为什么参考**：钢人论证（Steelman）方法论最正宗——先给对立面建"最强可信 case"，不丑化、不虚假平衡
- **它怎么做**：7 步工作流 Restate→Source base→Steelman→Audit→Counterarguments→Logic review→Output；输出含 Strongest case for/against + Key cruxes + 什么证据会改变结论
- **我们怎么借鉴（已实现）**：后端 `zhihu.js` 的 `alchemy()` prompt 强制"用钢人论证呈现最强论点、落到具体行业、不丑化对立面"；强制每个角色 rebuts 至少质疑另一角色
- **差异**：它最终给结论；我们坚持不替用户定论

### 项目 2：DialecticEngine
- **链接**：https://github.com/dai-zw/DialecticEngine
- **技术栈**：Python 3.10+ / Flask（SSE 流式）/ 前端 Vanilla JS + Marked.js + DOMPurify + html2canvas / 向量库 Milvus / DeepSeek API
- **为什么参考**：完整 Web 前端 + **流式渲染（SSE）** + 截图导出，是我们"计划借鉴但未做"的标杆
- **它怎么做**：21 个中国传统哲学视角自主辩论；PolicyRouter 智能路由；双层记忆（短期摘要+长期向量库）；前端节流 Markdown 渲染 + 逐轮截图
- **我们怎么借鉴（计划未做）**：流式渲染 + 截图/打印导出（见 PRD 8.2(1)）；后端需把直答改成 stream
- **差异**：含"辩证综合"；我们弱化综合、强化留白

### 项目 3：devils-advocate
- **链接**：https://github.com/kiingsai/devils-advocate
- **技术栈**：无代码（SKILL.md，需 Claude Code / OpenClaw 等 agent harness 运行）
- **为什么参考**：魔鬼辩驳（强制自攻结论）方法论
- **它怎么做**：先抓真实数据→并行 5 视角（反向/第一性原理/扩张/局外人/执行者）→多模型路由→机械事实核查→匿名盲评→主席综合后**每次强制 devil's-advocate 攻击自身结论**→置信度评级
- **我们怎么借鉴（部分实现）**：生成结果含 `quiz`（逼用户选立场+写理由+看反馈）；但当前是"静态自测"（生成时写死），非运行期实时对抗（见 PRD 8.1(3) 隐患）
- **差异**：AI 先给结论再被攻击；我们让人先产立场再被攻击

### 项目 4：multi-agent-debate
- **链接**：https://github.com/ChetanyaRathi/multi-agent-debate
- **技术栈**：Python + FastAPI + WebSockets + SQLite / 前端原生 HTML5+CSS3+JS（玻璃拟态 UI）/ Ollama 或 Gemini
- **为什么参考**：交互式多角色辩论 + 主席引导（Agent 21）的 UI 范式
- **它怎么做**：20 个角色 + 主席禁言/投票；WebSocket token 级流式；投票 ≥60% 宣布共识；SQLite 持久化辩论历史
- **我们怎么借鉴**：主席引导、角色交锋的呈现思路
- **差异**：最终投票综合（consensus）；与"不综合"相反，反衬我们差异化

### 项目 5：debate-ai
- **链接**：https://github.com/1311523821/debate-ai
- **技术栈**：零后端纯前端 / Alpine.js + Tailwind + marked.js + PDF.js / fetch+SSE 流式
- **为什么参考**：**最轻量 Web**（单 HTML、GitHub Pages 直部署），证明"零后端也能做多角色对抗"
- **它怎么做**：10 个 AI 角色互相审查；三种共识模式（自动/投票/全部完成）；角色级模型覆盖；历史+导出
- **我们怎么借鉴**：轻量前端思路；但我们要走"框架化"而非单 HTML
- **差异**：走向 consensus

### 项目 6：concilium-llm
- **链接**：https://github.com/G00gleKid/concilium-llm
- **技术栈**：Python 3.10+（CLI，`pip install -e .`）/ BotHub 或 OpenAI API / 嵌入模型 text-embedding-3-small 做分歧检测
- **为什么参考**：CLI 多专家辩论产**加权共识**的反面教材
- **它怎么做**：3 专家动态辩论→moderator 评估共识→嵌入向量余弦距离方差检测分歧提前终止→synthesis agent 加权共识
- **我们怎么借鉴**：反向差异点——它综合，我们不综合

### 项目 7：Multi-Agents-Debate（MAD）
- **链接**：https://github.com/Skytliang/Multi-Agents-Debate
- **技术栈**：Python（脚本 interactive.py / debate4tran.sh）/ OpenAI API / 无 UI
- **为什么参考**：学术界 MAD 框架（NeurIPS/ICLR 引用，608★），**背书"多智能体辩论方向成立"**
- **它怎么做**：正方(devil)/反方(angel)辩论纠正偏见，克服思想退化(DoT)；支持反直觉 QA、常识翻译
- **我们怎么借鉴**：方向背书，无直接 UI 可抄
- **差异**：纯框架无 UI

### 项目 8：ArguMesh（用户主动给的参考，最值得对齐）
- **链接**：https://github.com/Fyuan0206/ArguMesh
- **技术栈**：前端 **React 19 + TypeScript + Vite 6** / 后端 **Hono 4 + @hono/node-server** / 数据库 **SQLite + Drizzle ORM**（PDF BLOB 同库）/ PDF: pdfjs-dist + tesseract.js / AI: OpenAI 或 Anthropic 兼容
- **核心理念**：本地优先、零云依赖、单用户、AI 可选；Literature→Evidence Matrix→Research Thread→Experiments→Writing 闭环
- **为什么参考**：
  1. 完整可跑的 React+Hono+SQLite 全栈样板，技术选型成熟
  2. **证据矩阵**（论文×维度，AI 填格 + 人工核验锁定不被覆盖）→ 对应我们"溯源不可篡改"
  3. **结构化 PDF 标注**（选区存 Note/Claim/Evidence + 自动出处页码）→ 对应我们"翻面看来源"
  4. **研究主线**（洞见池＋RQ，来源溯源，不静默覆盖）→ 对应我们"不综合、留白"
  5. **Research Agent 白名单动作**（每轮至多一个动作）→ 可控多轮对话
- **我们怎么借鉴**：MVP 技术选型直接对齐 React + Vite 前端（与 ArguMesh 一致，可抄组件）；溯源/留白理念直接吸收
- **差异**：它是科研场景（论文），我们是求职决策（知乎经验）

---

## 2.5 知乎开放平台 API 事实基线（最高优先级真相，已验证 v1.2）

> 来源文件：`ZHIHU-API.md`（2026-08-27 知乎开放平台 API 文档 v1.2，状态"已验证"）
> **已交叉核对**：现有 `zhihu.js` 调用的三个路径与此文档完全一致，确认是真实在用的接口规范。

### 可用接口（✅ 已验证）

| 模块 | 方式 | 路径 | 日上限 | 我们是否已在用 |
|---|---|---|---|---|
| 知乎热榜 | GET | `/api/v1/content/hot_list` | 100 | ✅ `zhihu.js` 第82行 |
| 站内搜索 | GET | `/api/v1/content/zhihu_search` | 5000 | ✅ `zhihu.js` 第57行 |
| 全网搜索 | GET | `/api/v1/content/global_search` | 5000 | ❌ 未接 |
| 直答 Agent | POST | `/v1/chat/completions` | 100 | ✅ `zhihu.js` 第102行 |
| 关注列表 | GET | `/api/v1/user/followees` | 需认证 | ❌ 未接 |
| 我的创作 | GET | `/api/v1/user/contents` | 需认证 | ❌ 未接 |
| 收藏夹列表/内容/最近 | GET | `/api/v1/user/favlists` 等 | 需认证 | ❌ 未接 |
| 知识库列表/检索/上传 | GET/POST | `/api/v1/knowledge/*` | 需认证 | ❌ 未接 |
| 额度查询 | GET | `/api/v1/quota` | 免费 | ❌ 未接 |

### 不可用接口（CLI 不支持，别踩坑）

| 接口 | 原因 |
|---|---|
| `/openapi/feed/following` 关注流 | CLI 不支持 |
| `/openapi/user/followers` 粉丝列表 | CLI 不支持 |

### 关键限制（必须在应用层处理）

1. **热榜 100 次/天、直答 100 次/天、搜索 5000 次/天**，用完即止
2. 缓存策略（文档给定）：
   - `hot_list`: TTL 4 小时，每日拉一次
   - `zhihu_search` / `global_search`: TTL 1 小时，按 query hash 缓存
   - `agent_answer`(直答): TTL 1 小时，按 query hash 缓存
3. 错误处理：429 退避重试读缓存；403 查 Key；500 重试3次降级；配额用尽(0) 强制读缓存
4. **引用关系不可用**：知乎是"问题-回答"聚合模式，无论文级双向引用 API。
   - 获取"同一问题的其他回答"可⚠️变通实现（搜索）；反向引用不支持
   - → 影响我们"翻面看来源文章"的设计：只能靠搜索聚合，不能真做引用图谱

### 与 PRD 第6节的差异（PRD 写得较粗，以 ZHIHU-API.md 为准）

- PRD 写"知乎故事/回答 API""关注流 API 分享"——但**关注流 CLI 不支持**，PRD 的 OAuth 分享链路实际不可行（与 PRD 9 风险表"OAuth 卡公网"一致）
- PRD 未提**全网搜索 global_search**（5000/天，可做外部 RAG 检索）和**知识库接口**（可上传简历/文档做 RAG）——这两个是 MVP 可低成本利用的增量能力
- PRD 未提**额度查询 `/api/v1/quota`**——建议接入，做"剩余额度"提示避免演示时撞上限

### 缓存代码参考（文档给的 TS 版，我们当前用文件缓存，可对齐）

见 `ZHIHU-API.md` 第 227-247 行 `CACHE_CONFIG`；我们 `zhihu.js` 现有简易文件缓存，需补 query hash 维度。

---

## 3. 核心差异化（对所有参考项目的共同立场）

所有参考项目大多最终产出"结论 / 综合 / 共识"，而「山外山」坚持 **不替用户定论**——AI 只把知乎零散真实经历按处境重新组织、呈现对立最强论据，让用户自己判断翻哪座山。

---

## 4. 待办：技术架构决策（需用户拍板）

- [ ] 前端框架：建议 **React + Vite**（与 ArguMesh 对齐，能直接借鉴组件/状态写法）
- [ ] 后端：保留现有 Node `server.mjs`，或升级 Hono（对齐 ArguMesh）
- [ ] 3D 工牌（Three.js）：MVP 建议**砍掉/降级**为静态刘看山引导页，省时间做核心链路
- [ ] 统一 PRD 第 4 节与第 7 节的技术矛盾

---

## 5. 核查记录

- 核查时间：2026-08-27
- 核查方式：逐个 web_fetch GitHub 仓库页面，读取 README/结构
- 注意：Star/Fork 数为抓取时快照，可能变动；技术栈以仓库实际文件为准
- 本文件优先于任何"我记忆中的"项目信息；如有冲突以本文件 + 实际仓库为准
