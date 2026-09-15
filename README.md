# AI 服装电商创作工作台

面向服装电商商家的 AI 商拍工作台，用参考图、模特素材、服装细节图和姿势图生成商品主图、详情页套图与投流素材。

项目基于 Next.js 16、React 19 和 TypeScript 构建，前端工作台、任务 API、生图编排与本地持久化位于同一应用中。

## 核心功能

当前产品入口仅开放以下三项功能：

| 功能 | 主要输入 | 输出与能力 |
| --- | --- | --- |
| **AI 服装大片** | 多张人物、服装、姿势或场景参考图，可复用“我的模特”，并填写 Prompt | 每次生成 1 张；支持基础增强/原始提示词、多种比例、2K/4K 和模型切换 |
| **服装大片裂变** | 1 张满意的模特主图，可补充服装正面、侧面、背面细节图 | 当前开放童装连衣裙、套装、裤子；支持生成 2/4/9/10 张（裤子不提供 9 张），自动规划不同角度、景别与动作 |
| **姿势裂变** | 人物主图、可选服装正/背面细节图，以及用户姿势库中的 1–9 个姿势 | 选择 N 个姿势生成 N 张结果；保留人物、服装与背景，仅替换人物姿势 |

“元素替换”已从当前产品功能入口和任务类型中移除，不再作为可用功能。

## 服装大片裂变能力

- 使用 LLM 分镜导演生成结构化镜头 Prompt，并按镜头独立生图。
- 连衣裙、套装支持五官特征锁定；可选择人像小卡并涂抹主图人脸 Mask。
- 裤子支持正面、侧面、背面细节图，每个角度最多上传 2 张，并可指定主图是否露手。
- 单个镜头成功后立即持久化；部分失败时保留已成功结果。
- 支持失败镜头批量重跑、单镜头重新生成和生成结果人脸精修。

## 素材、任务与结果管理

- “我的模特”库、五官人像小卡库和用户自建姿势库。
- 姿势支持全身、上半身、下半身分类，可上传、重命名和删除。
- 当前任务、历史任务、案例库和收藏结果统一管理。
- 支持任务取消、失败重试、单张/批量下载、删除和按时间清理未收藏图片。
- 前端轮询任务进度；任务状态包括 `pending`、`running`、`success`、`partial`、`failed` 和 `cancelled`。
- 任务、素材和结果按登录用户隔离。

## 可选模型与供应商路由

当前模型选择器开放：

- Nano Banana（Gemini 3.1 Flash）
- Nano Banana Pro（Gemini 3 Pro）
- GPT Image 2
- 豆包 Seedream 4.5

服务端提供统一的多供应商生图路由，可配置 Google、OpenAI 兼容渠道、即梦、火山引擎和老张 API。供应商池支持加权分配、独立并发与 IPM/RPM 限流、指数退避重试、临时熔断和兼容渠道故障切换，并提供供应商健康检查接口。

## 存储、认证与计费

- **图片存储**：通过 `STORAGE_MODE` 在本地文件系统和阿里云 OSS 之间切换；素材路径按用户隔离。
- **任务元数据**：当前使用进程内 Map，并通过 JSON 文件持久化，尚未接入独立数据库和消息队列。
- **认证**：支持密码登录；本地部署也可使用 `LOCAL_AUTH_MODE=super-admin` 的内网超级管理员模式。
- **计费统计**：记录成功生成的模型、图片数量、单价和金额，可查看今日生成量、今日费用和模型明细。
- **账户余额**：配置老张 API 管理令牌后，可查询账户剩余额度、已用额度和累计请求次数。

计费模块用于团队侧成本统计，不是面向终端用户的积分或配额扣减系统。

## 技术栈

- **框架**：Next.js 16（App Router）+ React 19 + TypeScript 5.7
- **样式**：Tailwind CSS v4 + shadcn/ui（Radix UI）
- **表单与校验**：react-hook-form + Zod
- **后端**：Next.js API Routes
- **图片处理**：Sharp
- **对象存储**：本地文件系统 / 阿里云 OSS
- **任务持久化**：进程内状态 + JSON 文件

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。调用真实模型前，请在 `.env.local` 中配置至少一个可用生图渠道；仅调试界面时可启用 Demo 模式：

```env
IMAGE_API_DEMO=1
```

常用配置：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `IMAGE_PROVIDERS` | 多供应商 JSON 配置；未配置时从单渠道环境变量构建供应商池 | 空 |
| `GOOGLE_API_KEY` | Google Gemini API Key | 空 |
| `QINIU_IMAGE_API_KEY` | OpenAI 兼容图像渠道 API Key | 空 |
| `VOLCES_API_KEY` | 火山引擎/豆包图像渠道 API Key | 空 |
| `IMAGE_API_DEMO` | 启用本地 Demo 模式，不调用真实供应商 | `0` |
| `STORAGE_MODE` | 图片存储模式：`local` / `oss` | `local` |
| `LOCAL_IMAGE_ROOT` | 本地图片根目录；留空时使用 `public/generated` | 空 |
| `LOCAL_AUTH_MODE` | `super-admin` 内网直进 / `password` 账号登录；生产缺失或非法时按 `password` 处理 | 开发 `super-admin`，生产 `password` |
| `LOCAL_SUPER_ADMIN_USERNAME` | 本地管理员用户名 | `user01` |
| `LOCAL_ADMIN_PASSWORD` | 本地管理员密码；生产环境必须显式配置，不提供默认值 | 开发环境为兼容旧流程保留默认值，生产为空 |
| `LAOZHANG_ACCESS_TOKEN` | 查询老张 API 账户余额所需的管理令牌 | 空 |

阿里云 OSS 模式还需配置 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION` 和 `OSS_PUBLIC_URL`。

> Mac mini 生产环境使用 `next start`，代码更新后需要重新执行 `pnpm build` 并重启进程，不会像开发模式一样热更新。部署与排查流程见 [docs/mac-mini-operations.md](docs/mac-mini-operations.md)。

## 目录结构

```text
app/
  api/                         # 上传、任务、姿势库、认证、计费和健康检查接口
components/
  workbench/                   # 功能参数、任务结果、案例与素材库界面
lib/
  server/
    billing/                   # 计费事件、今日统计与账户余额
    storage/                   # local / OSS 存储适配器
    ai-fashion-photo-service.ts
    photo-fission-service.ts
    pose-fission-service.ts
    provider-image-router.ts   # 多供应商统一路由
    task-store.ts              # 任务编排与 JSON 持久化
  types.ts                     # 功能、任务、模型和参数类型
data/                           # 本地 JSON / JSONL 状态文件
public/generated/              # 默认本地图片目录
```

## 生图任务流程

```text
上传素材
  -> 创建 pending 任务
  -> 异步编排 Prompt / 镜头 / 姿势
  -> 供应商池分配、限流、重试与故障切换
  -> 每张成功结果立即写入 local 或 OSS
  -> 更新任务进度与 success / partial / failed 状态
  -> 前端轮询并展示结果
```

当前任务直接在 Next.js 进程内异步执行，适合单机或内部部署；如需多实例水平扩容，应进一步接入共享数据库和独立任务队列。

## 项目状态

已完成：

- 三项核心生图工作流及任务结果管理
- 服装裂变分镜规划、人脸锁定、镜头级重试与精修
- 用户模特库、人像小卡库和姿势库
- 多模型选择与多供应商容错路由
- local / OSS 双存储模式
- 登录认证、用户数据隔离、收藏与清理
- 今日成本统计、账户余额和供应商健康检查

当前仍属于持续迭代中的单机应用，任务元数据和认证会话尚未迁移到适合多实例部署的共享基础设施。

## License

MIT

本地创作助手 Beta 的使用与开放方式见 [说明](docs/agent-beta.md)。其中标注的 VOZEB-PRO 改编代码适用独立许可，详见 [第三方说明](third-party/vozeb-pro/NOTICE.md)。

---

由 [v0.app](https://v0.app/chat/projects/prj_jMqd0I9XVhws1Dzeg5yIBfriIJU7) 协同开发。
