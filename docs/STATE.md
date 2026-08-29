# 看山项目 · 事实白皮书（STATE.md）

> **本文件是「地面真相」。AI 每次新会话开工前必须先读它，绝不靠回忆/猜测。**
> 最后更新：2026-08-30

---

## 1. 统一命名（消除 4 个名字的混乱）

| 你口语说的 | 实际指 | 说明 |
|---|---|---|
| 看山 / 看山项目 | 刘看山 IP（知乎官方 IP，做辩论引导形象） | 你平时说的"看山项目"通常指**整个产品** |
| 山外山 | 产品正式名（PRD 里的名字） | 见 `docs/山外山PRD.md` |
| 知乎炼金术 / Zhihu Alchemy | 仓库对外显示名 | 见 `README.md` 标题 |
| zhihu-alchemy | 代码库目录名 | 实际工程文件夹 |

**一句话**：看山 = IP，山外山 = 产品名，知乎炼金术 = 对外名，zhihu-alchemy = 目录。它们说的是**同一个东西**。

---

## 2. 当前激活目录（唯一真源）

```
C:\Users\张鸿飞\CodeBuddy\20260819220339\zhihu-alchemy
```

- 这是 **git 仓库**，有 2 个提交（`init` + `docs: 将项目文档统一移入 docs/`）。
- 另一个 `20260819220333\zhihu-alchemy` 实为**遗留零散目录**（仅含一个已被本仓库取代的旧版 `personas.js`，无 `src/`、无 docs、非 git 仓库），**已删除**，无需再管。
- 本机 CodeBuddy 必须打开上面这个 339 目录，否则看不到文档整理与最新代码。

---

## 3. 仓库技术状态

- **前端**：React + Vite（2026-08-27 由原生 JS 迁移，见 DECISIONS D-01）
- **后端**：Node 原生 http（`server.mjs`）+ `zhihu.js`（知乎客户端，含文件缓存 / Mock 兜底）
- **无数据库、无三方重依赖**； Secret 仅在后端（`.env` 的 `ZHIHU_ACCESS_SECRET`）
- **运行**：`npm install` → `npm start`（默认 3000 端口，含 `/api/*` 完整服务）；无 Secret 时自动走 Mock，永不白屏
- **文档优先级铁律**：`DECISIONS.md` < `ZHIHU-API.md` < `REFERENCE-PROJECTS.md` < `山外山PRD.md`（冲突一律以 PRD 为准）

---

## 4. MVP 进度（截至 2026-08-28，来源 `docs/DECISIONS.md`）

✅ **已完成**
- 骨架 React+Vite 建立，`npm run build` 通过
- 模块① 阶段/目标选择（7 阶段单选 + 目标多选）
- 模块② 处境卡（可编辑、确认后才进推荐）
- 模块③ 简历解析（PDF/DOCX/TXT + 图片 OCR + 内置 `sample-resume.md`，失败降级手动）
- 模块④ 检索 + 处境匹配（每条论点带 `matchReason` 溯源到知乎）
- 模块⑤ 行动清单（可勾选、本地持久化）
- 城市选择器（BOSS 直聘式）、行业自由填写、接真实 Secret 走 LIVE、localhost 全流程联调跑通

⚠️ **未完成 / 打磨中**
- 3D 工牌：D-03 已砍，不纳入 MVP（其降级项"刘看山引导页 / dominantSide 可视化 / 导出 MD 含处境卡"已于 2026-08-30 完成，见上 ✅）

---

## 5. 待办 / 已知坑（必须处理，否则演示或评审有风险）

- 🟢 **直答限流 554 已复测（2026-08-30）**：跑一次 `alchemy('转行做数据分析师')` 实测返回 `ok:true, fallback:undefined, mock:false`，生成 3 个真实行业角色 + 真实知乎文章来源（`zhuanlan.zhihu.com/p/...?utm_medium=openapi_platform`），**限流已恢复**。配有效 Secret 即可 LIVE 演示。
- 🟢 **"假对峙"风险已消除（LIVE 正常时）**：实测 LIVE 角色为真实贴合话题的行业派别（证书速成派/实战自学派/机会先行派），非 MOCK 通用三派。注意：仅在 Secret 有效且未触 100 次/天上限时成立；演示前仍建议点"🔌 测试连接"确认额度。
- 🟡 缓存未完整实现：`zhihu.js` 还没补"按身份+关键词"维度与 PRD 要求的 3/7 天 TTL。
- 🟡 内容审核：PRD 第 7 节提了但未落地。
- 🟡 配额保护：建议接 `/api/v1/quota` 做剩余额度提示，避免演示撞 100 次/天上限。

---

## 6. 文档漂移警告（重要）

`README.md` 与 `TEAM_INTRO.md` 曾写过"前端原生 HTML/JS、无构建步骤、零三方依赖"，与实际（08-27 已切 **React+Vite**）不符；**已于 2026-08-30 修正**为 React+Vite 现状并随本次提交入库。

---

## 7. 给 AI 的铁律

1. **开工前先读本文件**（`docs/STATE.md`），不靠记忆。
2. 写代码前想想要不要套 skill（tdd / code-review / research / prototype / diagnosing-bugs …），**用户不用点名**，自动选。
3. 与 PRD 冲突时以 `docs/山外山PRD.md` 为准。
4. 任何"项目进度"汇报都基于本文件与 `docs/` 下的真实文档，不凭空编。
