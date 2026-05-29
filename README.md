# AI 服装电商创作工作台

> 面向服装电商商家的 AI 出图工作台，一站式生成模特大片、详情页图与投流素材。

基于 [Next.js](https://nextjs.org) + [v0](https://v0.app) 搭建的 MVP 项目。生图后端默认接入 **Google Gemini 官方图像 API**（Nano Banana / Nano Banana Pro），并可通过七牛 OpenAI 兼容渠道使用 GPT Image 2。

## ✨ 核心功能

| 功能 | 说明 | 输入 | 输出 |
| --- | --- | --- | --- |
| **AI 服装大片** | 上传参考图 + 选择「我的模特」生成高级商拍大片 | 多张参考图 + 模特素材 + Prompt | 1 张大片（1k / 2k / 4k，按任务可切换 Nano Banana / Nano Banana Pro / GPT Image 2） |
| **服装大片 - 元素替换** | 替换原图中的服装、环境或人像元素 | 原图 + 替换元素图 + Prompt | 4 / 8 / 12 / 16 张 |
| **服装大片裂变** | 上传产品图，按固定 9 镜头蓝图自动生成全景套图 | 服装产品图（可选正/背面细节） | **9 张固定套图**（支持失败镜头单独重跑） |
| **姿势裂变** | 从内置 45 个姿势模板里多选 1–9 个，保留服装细节生成同款多姿势素材 | 主图 + 可选正/背面细节 + 多选姿势 | **N 张**（N = 用户选中的姿势数，1 ≤ N ≤ 9） |

附加能力：

- 官方模特库（12 位预置模特，支持性别 / 年龄 / 人种 / 发色筛选）
- 「我的模特」库（浏览器 `localStorage` 持久化）
- 姿势模板库（45 个真实姿势：正面站姿、侧身、回头背影、半蹲、交叉步、靠墙、抬腿、儿童姿势等）
- 服装大片裂变 & 姿势裂变案例库（一键回填主图 + 镜头/姿势组合）
- 任务进度轮询、历史记录、结果下载与收藏
- Google 生图客户端限流（IPM / RPM）+ 指数退避重试（适配 Free / Tier 1 / Tier 2）

## 🛠 技术栈

- **框架**：Next.js 16 (App Router) + React 19 + TypeScript 5.7
- **样式**：Tailwind CSS v4 + shadcn/ui (Radix UI)
- **表单**：react-hook-form + Zod
- **后端**：Next.js API Routes
- **存储**：进程内 Map + JSON 文件持久化（MVP 阶段，未接数据库）
- **AI 生图**：
  - 默认 **Google Gemini 官方 API**（`gemini-3.1-flash-image-preview` Nano Banana / `gemini-3-pro-image-preview` Nano Banana Pro）
  - 可选 **GPT Image 2**（`gpt-image-2`，需配置支持 `openai/gpt-image-*` 的七牛 `qiniu` provider）
  - 兜底 **OpenAI 兼容 `/v1/images/edits`**（默认指向 Raycast Local Proxy）
- **Prompt 工程**：服装大片裂变 Prompt 已基于「一百 AIGC」研究重写镜头描述，强化身份/服装/环境锁定

## 🚀 快速开始

```bash
pnpm install
cp .env.example .env.local   # 填入 GOOGLE_API_KEY 或切换到 raycast
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

> 🖥️ **Mac mini 生产环境运维**：本项目部署在 Mac mini 上，公网入口 `http://47.96.71.237:3000`。**生产环境跑的是 `next start`（不是 next dev），不会热加载** —— 每次改代码必须 `pnpm build` + `pm2 restart yibai-fission --update-env`。完整的更新流程、登录配置、自愈机制、排查手册请看 👉 [`docs/mac-mini-operations.md`](docs/mac-mini-operations.md)。
>

### Demo 模式

如果暂时没有可用的图像 API，把 `.env.local` 中的 `IMAGE_API_DEMO` 设为 `1`，工作台会回放本地占位图，便于演示和 UI 调试：

```env
IMAGE_API_DEMO=1
```

### 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `IMAGE_API_PROVIDER` | 生图后端：`google`（官方 Gemini）/ `raycast`（兜底） | `google` |
| `GOOGLE_API_KEY` | Google AI Studio API Key（[申请](https://aistudio.google.com/apikey)） | 空 |
| `GOOGLE_IMAGE_MODEL` | Gemini 默认模型：`gemini-3.1-flash-image-preview` / `gemini-3-pro-image-preview` | `gemini-3.1-flash-image-preview` |
| `GOOGLE_IMAGE_TIMEOUT_MS` | Gemini 单图超时（2K/4K + 多图建议 ≥ 480s） | `600000` |
| `GOOGLE_IMAGE_IPM` | 每分钟最多发起的 image 请求数（Free=2 / Tier1=10 / Tier2=50） | `10` |
| `GOOGLE_IMAGE_RPM` | 每分钟最多发起的总请求数 | `150` |
| `GOOGLE_IMAGE_RETRY_ATTEMPTS` | 重试总尝试次数（含首次） | `4` |
| `GOOGLE_IMAGE_RETRY_BASE_DELAY_MS` | 重试基础退避（毫秒，指数 + jitter） | `1000` |
| `GOOGLE_IMAGE_RETRY_MAX_DELAY_MS` | 重试最大退避封顶（毫秒） | `60000` |
| `IMAGE_API_BASE_URL` | Raycast / OpenAI 兼容图像 API 基地址 | `http://127.0.0.1:11436/v1` |
| `IMAGE_API_KEY` | Raycast / OpenAI 兼容 API Key（可选） | 空 |
| `IMAGE_API_MODEL` | Raycast / OpenAI 兼容模型名 | `gpt-image-2` |
| `IMAGE_API_TIMEOUT_MS` | Raycast / OpenAI 兼容超时 | `120000` |
| `IMAGE_API_SKIP_HEALTHCHECK` | 跳过本地健康检查 | `0` |
| `IMAGE_API_DEMO` | 启用本地 Demo 模式（不调用任何 provider） | `0` |
| `STORAGE_MODE` | `local` 本地演示 / `oss` 阿里云 OSS 存储 | `local` |
| `LOCAL_AUTH_MODE` | local 认证：`super-admin` 内网直进 / `password` 账号登录 | `super-admin` |
| `LOCAL_IMAGE_ROOT` | local 图片根目录；留空使用 `public/generated` | 空 |

## 📁 目录结构

```
app/
  api/                  # 资产上传、任务、photo-fission/pose-fission 案例 REST 接口
  layout.tsx, page.tsx
components/
  workbench/            # 工作台三栏布局：功能侧边栏、参数面板、结果/案例库
  ui/                   # shadcn/ui 组件
lib/
  server/               # 任务编排、AI 服务、Google/Raycast 适配器、限流 & 重试
    google-genai-adapter.ts
    google-image-throttle.ts
    google-image-retry.ts
    photo-fission-service.ts   # 9 张固定镜头蓝图编排
    pose-fission-service.ts    # 多选姿势裂变编排
    third-party-image-adapter.ts
  pose-templates-seed.ts        # 45 个姿势模板种子数据
  types.ts                       # 全局类型 + 功能/比例/分辨率枚举
data/                            # MVP 阶段的 JSON 持久化文件
public/
  generated/             # 默认本地图片目录；也可用 LOCAL_IMAGE_ROOT 指到仓库外
  poses/                 # 45 张姿势参考缩略图
scripts/                 # 姿势模板拉取、维护脚本
```

## 🔄 生图任务流程

```
前端上传素材 ──► POST /api/assets/upload ──► 落盘本地图片目录 / R2
        │
        └──► POST /api/tasks ──► 任务进入 pending
                                    │
                                    ▼
                            runTask 异步执行
                                    │
              校验素材 → 构造 shotPlan / pose 列表 → 调用 Gemini / Raycast
                                    │
                                    ▼
              限流（IPM/RPM）+ 重试（指数退避 + jitter）+ 并发控制
                                    │
                                    ▼
              结果写入本地图片目录 / R2，状态置为 success
                                    │
            前端每 900ms 轮询 GET /api/tasks/[taskId] 更新进度
            （服装大片裂变支持失败镜头单独重跑：targetShotIds）
```

## 📌 项目状态

当前为 MVP 阶段，已完成：

- ✅ 工作台 UI 与四大功能参数收集
- ✅ 任务编排、轮询、历史与下载
- ✅ 模型选择器（Nano Banana / Nano Banana Pro / GPT Image 2）
- ✅ Raycast / OpenAI 兼容 API 兜底
- ✅ 服装大片裂变 9 张固定镜头蓝图 + 失败镜头单独重跑
- ✅ 姿势裂变多选模板（1–9 张）+ 45 个姿势模板种子库
- ✅ Google 生图客户端限流 + 指数退避重试
- ✅ Prompt 工程升级（基于「一百 AIGC」研究重写镜头描述）
- ✅ 本地 Demo 模式

后续可扩展：

- ⏳ 接入真实对象存储（OSS / S3）
- ⏳ 接入数据库与多用户鉴权
- ⏳ 增加积分计费与配额管理

## 📄 License

MIT

---

由 [v0.app](https://v0.app/chat/projects/prj_jMqd0I9XVhws1Dzeg5yIBfriIJU7) 协同开发，开发流程使用 [Trellis](https://github.com/) 管理。
