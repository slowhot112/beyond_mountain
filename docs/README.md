# 山外山 · 文档索引（docs/）

> 本目录是项目的**文档真相源**。每次新对话进来，请先按下面的"阅读顺序"读完核心文件，再动手写代码或写文案。
> 优先级铁律：`山外山PRD.md` > `REFERENCE-PROJECTS.md` > `ZHIHU-API.md` > `DECISIONS.md` > 其他。任何冲突以更高优先级为准。
> 历史版本文档（转型前《知乎炼金术》）在 [`_archive/`](_archive/README.md)，仅作参考，不是真相源。

---

## 一、新对话必读（按顺序读这 4 份）

1. **`山外山PRD.md`** —— 产品需求真相：定位、用户画像、四大核心功能模块。
2. **`DECISIONS.md`** —— 已拍板的决策日志（技术选型、产品范围），活文档，随项目迭代。
3. **`ZHIHU-API.md`** —— 知乎开放平台 15 个接口的真实字段、调用上限与坑点（已验证）。
4. **`REFERENCE-PROJECTS.md`** —— 8 个对标项目的真实核验（防幻觉/防技术栈记错），含自身现状基线。

> 配套提示语（可直接复制到新对话开头）：
> 「先读 zhihu-alchemy 下的 `docs/山外山PRD.md`、`docs/DECISIONS.md`、`docs/ZHIHU-API.md`、`docs/REFERENCE-PROJECTS.md`，所有信息以文件为准，不要凭记忆。」

---

## 二、文档分类速查

### 1. 宪法层 · 产品与决策（最高优先级）
| 文件 | 用途 |
|---|---|
| `山外山PRD.md` | 产品需求文档：定位 / 用户画像 / 四大模块 / 技术架构方向 / 知乎生态契合度 |
| `DECISIONS.md` | 决策日志（活文档）：所有已拍板的技术选型与产品范围决定，含日期与理由 |

### 2. 实现层 · 技术与对接
| 文件 | 用途 |
|---|---|
| `ZHIHU-API.md` | 知乎开放平台 API 文档（v1.2 已验证）：接口路径 / 调用上限 / 返回字段 / CLI |
| `DEPLOY.md` | 部署说明：Railway / Render 两种方式 / 环境变量 / 评委体验保障 / 可选拓展的 Python 解析服务（暂不部署） |
| `REFERENCE-PROJECTS.md` | 外部参考项目知识库：8 个 GitHub 对标项目的真实核验，含技术栈与可借鉴点 |

### 3. 资料层 · 参考与样本
| 文件 | 用途 |
|---|---|
| `sample-resume.md` 的说明 | 样例简历（虚构"张同学"）已移至 `public/sample-resume.md`——前端"载入内置样例简历"直接读取该文件，随 Vite 构建打包 |

### 4. 归档区 · 历史版本（仅参考，非真相源）
| 位置 | 内容 |
|---|---|
| `_archive/README.md` | 归档索引 |
| `_archive/zhihu-alchemy-legacy/` | 转型前《知乎炼金术》旧版文档：TEAM_INTRO / plan-material / references |

---

## 三、按场景找文件

| 你要做什么 | 先看这些 |
|---|---|
| 理解产品是什么 / 改需求 | `山外山PRD.md` → `DECISIONS.md` |
| 写代码 / 调 API / 排查坑 | `ZHIHU-API.md` → `REFERENCE-PROJECTS.md` → `DECISIONS.md` |
| 部署上线 / 给评委体验 | `DEPLOY.md` |
| 引用外部背书 / 找文献 | `REFERENCE-PROJECTS.md`（竞品核验）→ `_archive/zhihu-alchemy-legacy/`（旧版素材） |
| 联调求职场景 / 准备 demo 数据 | `public/sample-resume.md` |

> ⚠️ **模块编号旁注**：`山外山PRD.md` 第4节用"模块 1-5"编号（模块 5 沉浸式工牌已按 D-03 降级为静态引导，标 `[已修订 2026-08-27]`）。
> - 读 PRD 时：以"模块 1-4"为准（模块 5 仅保留静态入口）。
> - 前端 UI 的四大卡片名（对峙墙 / 信谁框架 / 判断力自测 / 行动地图）是渲染层产物，不要把"模块 N"硬映射到"卡片名"——两者是不同抽象层的产物。
> - 旧版《知乎炼金术》时代的对外讲法见 `_archive/zhihu-alchemy-legacy/TEAM_INTRO.md`（仅参考旧叙事，定位以 PRD 为准）。

---

## 四、维护规则

- **新增文档**：在本索引里同步登记分类与一句话用途，保持"目录与文件一一对应"。
- **决策变更**：在 `DECISIONS.md` 加 `[已修订 YYYY-MM-DD]` 备注，**不要静默修改历史决策**。
- **PRD 修订**：以 PRD 为准；若有冲突，更新 `DECISIONS.md` 中的相关条目并标注修订原因。
- **文档过期**：不再反映现状的历史版本文档移入 `_archive/` 并在归档索引登记，不要留在正文目录里冒充现行文档。
