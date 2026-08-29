# 知乎开放平台 API 文档

> 版本：v1.2
> 日期：2026-08-27
> 状态：已验证

---

## 接口汇总

| 模块 | 请求方式 | 接口路径 | CLI 命令 | 日调用上限 | 验证状态 |
|------|---------|---------|---------|-----------|---------|
| 知乎热榜 | GET | `/api/v1/content/hot_list` | `hot` | 100 | ✅ |
| 知乎站内搜索 | GET | `/api/v1/content/zhihu_search` | `search zhihu` | 5000 | ✅ |
| 全网搜索 | GET | `/api/v1/content/global_search` | `search global` | 5000 | ✅ |
| 关注流 | GET | `/openapi/feed/following` | - | 无标注 | ❌ CLI 不支持 |
| 关注列表 | GET | `/api/v1/user/followees` | `me followees` | 需认证 | ✅ |
| 粉丝列表 | GET | `/openapi/user/followers` | - | 需认证 | ❌ CLI 不支持 |
| 直答 Agent | POST | `/v1/chat/completions` | `answer` | 100 | ✅ |
| 我的创作 | GET | `/api/v1/user/contents` | `me contents` | 需认证 | ✅ |
| 收藏夹列表 | GET | `/api/v1/user/favlists` | `me favorites lists` | 需认证 | ✅ |
| 收藏夹内容 | GET | `/api/v1/user/favlist_contents` | `me favorites items` | 需认证 | ✅ |
| 最近收藏 | GET | `/api/v1/user/collections` | `me favorites recent` | 需认证 | ✅ |
| 知识库列表 | GET | `/api/v1/knowledge/bases` | `knowledge bases` | 需认证 | ✅ |
| 知识库检索 | POST | `/api/v1/knowledge/search` | `knowledge search` | 需认证 | ✅ |
| 知识库上传 | POST | `/api/v1/knowledge/files` | `knowledge upload` | 需认证 | ✅ |
| API 额度查询 | GET | `/api/v1/quota` | `quota` | 免费 | ✅ |

---

## 1. 知乎热榜

**接口**：`GET /api/v1/content/hot_list`

**功能**：拉取实时热榜内容，支持自定义时间范围（最近 N 小时）

**返回字段**：
- 热度分值
- 问题标题
- 优质回答摘要
- 互动数据

**日调用上限**：100 次

**应用场景**：
- 每日抓取热点话题，生成「今日热点摘要」
- 围绕热门话题策划专题讨论
- 发布内容时引用热榜数据作为背景

---

## 2. 知乎站内搜索

**CLI 命令**：`zhihu search zhihu --query "关键词" --count 10`

**接口**：`GET /api/v1/content/zhihu_search`

**功能**：关键词检索知乎全站内容

**返回字段**：
- 文章/问答标题
- 摘要
- 作者
- 发布时间
- 相关性分数
- 权威度等级
- 点赞数
- 评论数
- 精选评论

**日调用上限**：5000 次

**应用场景**：
- 挖掘用户共同兴趣
- 查阅知乎站内高质量讨论
- 利用信号筛选优质内容

---

## 3. 全网搜索

**CLI 命令**：`zhihu search global --query "关键词" --count 10`

**接口**：`GET /api/v1/content/global_search`

**功能**：关键词检索全网相关内容

**返回字段**：
- 网页标题
- 摘要
- 作者
- 发布时间
- 相关性分数
- 权威度等级

**日调用上限**：5000 次

**应用场景**：
- 挖掘用户共同兴趣
- 查阅全网高质量讨论
- 利用信号筛选优质内容

---

## 4. 关注流

> ⚠️ **注意**：此接口在 CLI 中不支持

**接口**：`GET /openapi/feed/following`

**功能**：获取关注人动态与内容流

**返回字段**：
- 关注人发布的动态
- 内容流

---

## 5. 直答 Agent

**CLI 命令**：`zhihu answer --query "问题"`

**接口**：`POST /v1/chat/completions`

**功能**：轻量化智能直答，基于知乎海量优质内容快速生成精准、可信的自然语言回答

**返回字段**：
- 自然语言回答

**日调用上限**：100 次

**应用场景**：
- 根据用户问题，直接生成有据可依的精炼回答
- 快速搭建问答工具、内容助手、智能咨询

---

## 调用限制说明

### 重要限制

1. **热榜接口**：单用户总调用量上限 100 次/天，用完即止
2. **搜索接口**：单用户总调用量上限 5000 次/天，用完即止
3. **直答 Agent**：单用户总调用量上限 100 次/天，用完即止

### 建议

- 在应用层做好缓存，避免重复请求
- 热榜数据建议每日拉取一次后缓存
- 搜索结果建议按 query 维度缓存（TTL: 1小时）

---

## 知研应用

### 热榜 → 首页「今日热榜」模块

```
用户访问首页
    │
    ▼
检查缓存（TTL: 4小时）
    │
    ├── 有 → 返回缓存数据
    │
    └── 无 → 调用 /api/v1/content/hot_list
                │
                ▼
            缓存结果
                │
                ▼
            返回热榜数据
```

### 站内搜索 → 报告生成 + 诘问引用

```
用户提交问题
    │
    ▼
调用 /api/v1/content/zhihu_search
    │
    ▼
过滤高质量内容（点赞>100, 评论>20）
    │
    ▼
生成报告 / 诘问引用
    │
    ▼
缓存结果（按 query hash）
```

### 全网搜索 → 外部 RAG 检索

```
用户提交问题
    │
    ▼
调用 /api/v1/content/global_search
    │
    ▼
与知乎搜索结果合并去重
    │
    ▼
返回给诘问引擎
```

### 直答 Agent → 备选回复生成

```
诘问引擎生成问题后
    │
    ▼
调用 /v1/chat/completions 获取参考回答
    │
    ▼
辅助生成更精准的追问
    │
    ▼
缓存结果（TTL: 1小时）
```

---

## 缓存策略

```typescript
// 缓存配置
const CACHE_CONFIG = {
  hot_list: {
    ttl: 4 * 60 * 60,  // 4小时
    key: 'zhihu:hot_list'
  },
  zhihu_search: {
    ttl: 60 * 60,       // 1小时
    key: (query: string) => `zhihu:search:${hash(query)}`
  },
  global_search: {
    ttl: 60 * 60,       // 1小时
    key: (query: string) => `zhihu:global:${hash(query)}`
  },
  agent_answer: {
    ttl: 60 * 60,       // 1小时
    key: (query: string) => `zhihu:agent:${hash(query)}`
  }
};
```

---

## CLI 快速使用

### 安装与配置

```bash
# 安装 (macOS/Linux)
bash ~/.claude/skills/zhihu/scripts/setup.sh

# 安装 (Windows PowerShell)
powershell -ExecutionPolicy Bypass -File ~/.claude/skills/zhihu/scripts/setup.ps1

# 配置 Access Secret
zhihu-cli auth set --secret-stdin
# 或交互式配置
zhihu-cli auth set

# 验证配置
zhihu-cli auth status --verify
```

### 常用命令示例

```bash
# 热榜
zhihu hot --limit 20

# 搜索
zhihu search zhihu --query "人工智能" --count 10
zhihu search global --query "AI发展趋势" --count 10

# 直答
zhihu answer --query "量子计算的应用"

# 我的创作与关注
zhihu me contents --type all --limit 20
zhihu me followees --limit 20

# 收藏
zhihu me favorites lists
zhihu me favorites items --url-token 971307412 --limit 20
zhihu me favorites recent --limit 10

# 知识库
zhihu knowledge bases --scope all
zhihu knowledge search --query "关键词" --scope personal --limit 10
zhihu knowledge upload --file "/path/to/file.pdf" --progress

# 额度查询
zhihu quota
zhihu quota --api-id knowledge
```

### 输出格式

| 参数 | 说明 |
|------|------|
| `--output json` | JSON 输出 (默认) |
| `--output text` | 纯文本输出 |
| `--output sse` | 服务器推送事件流 |
| `--pretty` | 美化 JSON 格式 |

---

## 错误处理

| 错误码 | 含义 | 处理策略 |
|--------|------|---------|
| 429 | 请求过于频繁 | 退避重试，优先读缓存 |
| 403 | 权限不足 | 检查 API Key |
| 500 | 服务端错误 | 重试 3 次后降级 |
| 0 | 配额用尽 | 强制读缓存，返回历史数据 |

---

## 局限性说明

### 不支持的接口

以下接口在官方 CLI 中**不可用**：

| 接口 | 原因 |
|------|------|
| `/openapi/feed/following` | CLI 不支持关注流 |
| `/openapi/user/followers` | CLI 不支持粉丝列表 |

### 引用关系不可用

知乎平台架构是「问题-回答」聚合模式，**没有论文级别的双向引用 API**：

| 功能 | 支持情况 |
|------|---------|
| 获取帖子的引用列表 | ❌ 不支持 |
| 获取反向引用（谁引用了我） | ❌ 不支持 |
| 同一问题的其他回答 | ⚠️ 可变通实现 |

**替代方案**：通过搜索接口获取「同一问题的其他热门回答」作为关联推荐。

---

*文档版本：v1.2 | 更新：2026-08-27 | 新增：CLI 命令对照表、验证状态、不支持接口说明*
