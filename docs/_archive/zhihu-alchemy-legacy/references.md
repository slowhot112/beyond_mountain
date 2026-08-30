# 竞品 / 参考项目调研（GitHub）

> 用途：为「知乎炼金术」产品定位与黑客松计划书提供对标依据。
> 方法：在 GitHub 检索「多视角辩论 / steelmanning / devil's advocate / dialectic / critical thinking」类产品，逐个核验真实性（GitHub API 确认仓库存在、Star、创建时间），按相似维度判定。
> 核验时间：2026-08-20。Star 为 API 实时值（未作估算）。

## 我们的定位（被对标对象）
**知乎炼金术**：面向想入门新领域却被知乎上互相矛盾的高赞经验搞懵的新手，**不替你下结论**，而是把冲突观点摆成「观点对峙墙」、给「信谁框架」、用「判断力自测」逼用户产出自己的立场、再落成「行动地图」——帮用户在众声喧哗里炼出自己的判断。Web 应用形态（前端网页 + Node 后端代理知乎搜索/直答 API）。

## 相似维度定义（满足任一即纳入）
- 解决的问题类似 ｜ 使用场景类似 ｜ 目标用户类似 ｜ 产品定位/形态类似 ｜ 技术栈类似

## 相似项目明细

| 项目 | 链接 | Stars | 相似维度 | 一句话相似点 | 核心差异 | 推荐理由 |
|---|---|---|---|---|---|---|
| both-sides-research | https://github.com/PSkinnerTech/both-sides-research | 0 | 解决问题/定位 | 用「钢人论证」把对立双方最强论据摆清并审计来源，刻意不丑化任一方 | 仍「reaching evidence-grounded conclusions」，我们坚持不替用户下结论 | **方法论原型**：观点对峙墙应直接采用钢人论证，避免对峙变抬杠 |
| DialecticEngine | https://github.com/dai-zw/DialecticEngine | 1 | 解决问题/形态/技术 | 多视角哲学推理引擎，带完整 Web 前端（流式渲染、区块折叠、截图导出） | 含「辩证综合」步骤（偏给结论），我们弱化综合、强化留白 | **前端样板**：流式、对峙卡片、截图导出可直接套网页版 |
| devils-advocate | https://github.com/kiingsai/devils-advocate | 0 | 解决问题 | 先合成草稿结论，再强制用魔鬼辩驳攻击该结论本身 | 面向「决策压力测试」且 AI 先给结论；我们让用户先产立场再被攻击 | **自测机制**：判断力自测应专挑用户立场漏洞追问，而非夸奖 |
| multi-agent-debate | https://github.com/ChetanyaRathi/multi-agent-debate | 0 | 形态/解决问题 | 交互式多角色辩论平台，AI 人设围绕用户话题辩论、主席智能体引导 | 最终投票综合成共识答案，与「不综合」相反 | **交互形态**：多角色+主席引导的 Web 辩论界面可借鉴 |
| debate-ai | https://github.com/1311523821/debate-ai | 0 | 形态/解决问题 | 双模型对抗辩论平台（HTML/Web），两 AI 就话题辩论 | 目标「reach consensus」，仍走向单一结论 | **轻量壳**：纯前端实现，适合「打开即见对峙成品」参考 |
| concilium-llm | https://github.com/G00gleKid/concilium-llm | 0 | 解决问题/技术 | CLI：组建多专家 LLM 辩论并产出「加权共识答案」 | CLI 形态且最终综合；我们的差异点恰是它做的「综合」 | **反面对照**：证明「多视角→综合」是主流，反衬「不综合」的差异化 |
| Multi-Agents-Debate | https://github.com/Skytliang/Multi-Agents-Debate | 605 | 技术/解决问题 | 学界首个系统探索 LLM 多智能体辩论的框架（arXiv:2305.19118） | 纯学术框架、无产品 UI、偏「提升回答质量」 | **方法论背书**：605★ 高引框架证明多智能体辩论方向成立 |

## 分层结论
- **高度相似（核心贴合「多视角 + 不综合 / 训练判断」）**：`both-sides-research`（方法论）、`DialecticEngine`（Web 形态 + 多视角）。
- **仅部分维度相似（形态/技术可借鉴，但都走向「综合结论」）**：`devils-advocate`、`multi-agent-debate`、`debate-ai`、`concilium-llm`。
- **基础参考（学术方法论背书）**：`Multi-Agents-Debate`。

## 关键发现
1. 7 个里**没有一个**同时满足「锚定新手学习场景 + 刻意不综合 + 把判断责任留给人」——存在真实空白，不是重复造轮子。
2. 多个项目为 **2026 年新项目**（both-sides-research 06、devils-advocate 08、multi-agent-debate 06），说明「把分歧讲透而非急着综合」是当下升温的真实设计范式，可作计划书「赛道选择合理性」支撑。

## 借鉴落地映射
| 我们的问题 | 借鉴来源 | 迁移做法（合理改造） | 明确不抄 |
|---|---|---|---|
| 只是 RAG 观感 | concilium-llm | 一次调用产出多视角对峙 JSON | 不抄「加权共识」综合 |
| 半成品感 | DialecticEngine | 流式渲染 + 截图/打印导出 + 折叠分区 | 不抄 Flask/DeepSeek 后端 |
| 知乎生态差异 | 通用 RAG 接法 | 知乎搜索喂直答，立场带出处 | 不引入向量库 |
| 训练判断 | devils-advocate / both-sides-research | 钢人论证做对峙 + 自测专挑漏洞 | 不学「AI 先给结论」 |
| IP 合规 | Hiliu（往届作品） | 加 NOTICE 声明文件 | — |
| 工程整洁 | 赛博刘看山（往届作品） | 维持三层目录分离 | — |
