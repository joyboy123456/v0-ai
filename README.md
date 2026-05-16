# AI 服装电商创作工作台

> 面向服装电商商家的 AI 出图工作台，一站式生成模特大片、详情页图与投流素材。

基于 [Next.js](https://nextjs.org) + [v0](https://v0.app) 搭建的 MVP 项目，通过 OpenAI 兼容的图像编辑 API（默认接 [Raycast Local Proxy](https://raycastapp.com/)）调用大模型完成图生图。

## ✨ 核心功能

| 功能 | 说明 | 输入 | 输出 |
| --- | --- | --- | --- |
| **AI 服装大片** | 上传参考图 + 选择「我的模特」生成高级商拍大片 | 多张参考图 + 模特素材 + Prompt | 1 张大片（1k / 2k / 4k） |
| **服装大片 - 元素替换** | 替换原图中的服装、环境或人像元素 | 原图 + 替换元素图 + Prompt | 4 / 8 / 12 / 16 张 |
| **服装大片裂变** | 上传产品图，自动生成多张不同模特、姿势、景别的展示图 | 服装产品图（可选正/背面细节） | 4 / 8 / 12 / 16 张 |
| **姿势裂变** | 从内置姿势案例库挑选目标姿势，保留服装细节生成同款多姿势素材 | 主图 + 可选正/背面细节 + 姿势案例 | 6 张 |

附加能力：

- 官方模特库（12 位预置模特，支持性别 / 年龄 / 人种 / 发色筛选）
- 「我的模特」库（浏览器 `localStorage` 持久化）
- 姿势案例库（回头背影、半蹲近景、正面招手、侧身行走、交叉步、手持包前进）
- 任务进度轮询、历史记录、结果下载与收藏

## 🛠 技术栈

- **框架**：Next.js 16 (App Router) + React 19 + TypeScript 5.7
- **样式**：Tailwind CSS v4 + shadcn/ui (Radix UI)
- **表单**：react-hook-form + Zod
- **后端**：Next.js API Routes
- **存储**：进程内 Map + JSON 文件持久化（MVP 阶段，未接数据库）
- **AI 生图**：OpenAI 兼容 `/v1/images/edits` 协议（默认指向 Raycast Local Proxy）

## 🚀 快速开始

```bash
pnpm install
cp .env.example .env.local   # 按需修改 IMAGE_API_BASE_URL / IMAGE_API_KEY
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

### Demo 模式

如果暂时没有可用的图像 API，把 `.env.local` 中的 `IMAGE_API_DEMO` 设为 `1`，工作台会回放本地占位图，便于演示和 UI 调试：

```env
IMAGE_API_DEMO=1
```

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `IMAGE_API_BASE_URL` | OpenAI 兼容图像 API 基地址 | `http://127.0.0.1:11436/v1` |
| `IMAGE_API_KEY` | API Key（可选） | 空 |
| `IMAGE_API_MODEL` | 模型名 | `gpt-image-2` |
| `IMAGE_API_TIMEOUT_MS` | 请求超时 | `120000` |
| `IMAGE_API_SKIP_HEALTHCHECK` | 跳过健康检查 | `0` |
| `IMAGE_API_DEMO` | 启用本地 Demo 模式 | `0` |

## 📁 目录结构

```
app/
  api/                  # 资产上传、任务、姿势案例 REST 接口
  layout.tsx, page.tsx
components/
  workbench/            # 工作台三栏布局：功能侧边栏、参数面板、结果/案例库
  ui/                   # shadcn/ui 组件
lib/
  server/               # 任务编排、AI 服务、第三方图像适配器
  types.ts              # 全局类型 + 功能/比例/分辨率枚举
data/                   # MVP 阶段的 JSON 持久化文件
public/generated/       # 上传素材与生成结果落盘目录
```

## 🔄 生图任务流程

```
前端上传素材 ──► POST /api/assets/upload ──► 落盘 public/generated/assets/
        │
        └──► POST /api/tasks ──► 任务进入 pending
                                    │
                                    ▼
                            runTask 异步执行
                                    │
              校验素材 → 拼接参考板 SVG → 调用图像 API
                                    │
                                    ▼
              结果写入 public/generated/results/，状态置为 success
                                    │
            前端每 900ms 轮询 GET /api/tasks/[taskId] 更新进度
```

## 📌 项目状态

当前为 MVP 阶段，已完成：

- ✅ 工作台 UI 与四大功能参数收集
- ✅ 任务编排、轮询、历史与下载
- ✅ Raycast / OpenAI 兼容 API 接入
- ✅ 本地 Demo 模式

后续可扩展：

- ⏳ 接入真实对象存储（OSS / S3）
- ⏳ 接入数据库与多用户鉴权
- ⏳ 增加积分计费与配额管理

## 📄 License

MIT

---

由 [v0.app](https://v0.app/chat/projects/prj_jMqd0I9XVhws1Dzeg5yIBfriIJU7) 协同开发，开发流程使用 [Trellis](https://github.com/) 管理。
