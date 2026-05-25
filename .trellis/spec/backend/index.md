# Backend Development Guidelines

> 后端服务的工程契约（code-spec）。本目录的内容是 **executable contract**：必须有签名、错误矩阵、Good/Base/Bad case 与测试断言点。

---

## 适用范围

- `app/api/**` Next.js Route Handlers
- `lib/server/**` 服务端业务逻辑、外部 API 适配器、工具
- 任何跨层的请求/响应契约、数据库变更、基础设施（队列、缓存、Secret/env、外部 SaaS）改动

不适用：纯前端组件 / hooks（去 `frontend/`），思考触发器（去 `guides/`）。

---

## 文档索引

| 文档 | 主题 | 状态 |
|---|---|---|
| [External Image API Reliability](./external-image-api-reliability.md) | 外部图像生成 API（Google Gemini Image，未来七牛云等）的稳定性契约：错误分类、重试退避、限流、熔断、日志、env 命名 | active |
| [Streaming Fission Pipeline](./streaming-fission-pipeline.md) | 「单任务 N 个子镜头 + 单失败容忍 + 流式持久化 + 子集重跑」fission pipeline 编排契约（photo-fission / pose-fission 共享） | active |
| [Fission Prompt Planner](./fission-prompt-planner.md) | fission 类功能的文本 LLM prompt planning 底座契约：OpenAI 兼容调用、JSON 容错解析、Zod schema 校验、feature fallback | active |
| [Photo-Fission Category Extension](./photo-fission-category-extension.md) | 服装大片裂变新增品类的接入规范：类型/UI、品类 prompt strategy、rule-engine 路由、动态 resultCount、复用 LLM Planner 与 pipeline | active |
| [Cloudflare Integration](./cloudflare-integration.md) | Cloudflare R2 / D1 / KV 远程存储集成契约：STORAGE_MODE 双轨、客户端 signature、wrangler `.env.local` 覆盖 trap、错误矩阵 | active |
| [Multi-User Data Isolation](./multi-user-data-isolation.md) | 多用户数据隔离契约：cookie session → middleware → requireUser → service → repo 跨层数据流，DB / R2 key 强制约束 | active |

---

## 写新 spec 的规矩

1. 命名采用 kebab-case，主题不要太大（一个文件覆盖一个跨任务复用的契约即可）
2. 必须含 **签名 / 契约 / 错误矩阵 / Good-Base-Bad / Wrong-vs-Correct**
3. 引用代码必须 `path:line` 格式，方便后续工程师跳转
4. 跨层契约（API ⇄ service ⇄ store ⇄ provider）必须画一张文字版数据流
5. env key 必须列在「Contracts → Environment」一节，并且与 `.env.example` 同步

---

**语言**：中文为主，关键 API / 类型名 / env key 保留英文，代码块用真实项目代码。
