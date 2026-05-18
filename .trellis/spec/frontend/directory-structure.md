# Directory Structure

## Project Layout

```
v0-ai/
├── app/
│   ├── api/                        # Next.js API Routes (server-side)
│   │   ├── assets/upload/route.ts  # POST: upload image → returns assetId + fileUrl
│   │   ├── photo-fission/cases/
│   │   │   ├── route.ts            # GET: list photo-fission cases
│   │   │   └── [caseId]/
│   │   │       ├── route.ts        # GET: single case meta
│   │   │       └── shots/route.ts  # GET: case shot list
│   │   ├── pose-fission/
│   │   │   ├── cases/route.ts      # GET: list pose-fission cases
│   │   │   ├── cases/[caseId]/route.ts  # GET: single pose case meta
│   │   │   ├── templates/route.ts  # GET: list pose templates (for multi-select dialog)
│   │   │   └── tasks/[taskId]/retry/route.ts  # POST: retry failed pose templates ({ templateIds })
│   │   ├── tasks/route.ts          # GET: list tasks | POST: create task
│   │   └── tasks/[taskId]/
│   │       ├── route.ts            # GET: single task status
│   │       ├── download/route.ts   # POST: batch download
│   │       ├── results/[assetId]/route.ts   # GET: result asset bytes
│   │       └── retry-shots/route.ts # POST: retry failed photo-fission shots ({ shotIds })
│   ├── layout.tsx                  # Root layout, metadata, Analytics
│   └── page.tsx                    # Single page → renders <Workbench />
│
├── components/
│   ├── ui/                         # shadcn/ui primitives (do not modify)
│   ├── workbench/
│   │   ├── workbench.tsx           # Root layout: FeatureSidebar + LeftPanel + RightPanel
│   │   ├── feature-sidebar.tsx     # Left nav: 4 feature tabs
│   │   ├── left-panel.tsx          # Input panel: upload + params + generate button
│   │   ├── right-panel.tsx         # Output panel: results / history / model library / fission case library
│   │   ├── pose-library-dialog.tsx # Multi-select modal for pose templates (1-9)
│   │   ├── option-selectors.tsx    # Reusable ratio/option selector UI
│   │   ├── upload-components.tsx   # UploadBox (single image upload)
│   │   ├── company-model-library.tsx  # (legacy, superseded by MyModelLibraryPanel in right-panel)
│   │   └── index.ts                # Re-exports
│   └── theme-provider.tsx
│
├── lib/
│   ├── types.ts                    # ALL shared types + constants (FEATURES, POSE_TEMPLATES, POSE_FISSION_CASES, etc.)
│   ├── utils.ts                    # cn(), validateUploadSize()
│   └── server/                     # Server-only modules (never import in client components)
│       ├── task-store.ts                    # In-memory + JSON persistence for assets + tasks; runTask 分流 fission features
│       ├── ai-fashion-photo-service.ts      # Prompt builder for ai-fashion-photo
│       ├── photo-fission-service.ts         # Prompt builder + runPhotoFissionPipeline
│       ├── photo-fission-case-store.ts      # Photo-fission case library data store
│       ├── pose-fission-service.ts          # Prompt builder + runPoseFissionPipeline
│       ├── third-party-image-adapter.ts     # Provider dispatch (raycast | google | demo)
│       ├── google-genai-adapter.ts          # Google Gemini REST adapter
│       ├── google-image-retry.ts            # callGoogleImageWithRetry + GoogleImageError
│       ├── google-image-throttle.ts         # IPM/RPM token bucket
│       └── log.ts                           # Structured image event logger
│
├── data/
│   └── fashion-mvp-store.json      # Runtime persistence (git-ignored)
│
└── public/
    ├── cases/                      # Photo / pose fission case static assets (committed)
    └── generated/
        ├── assets/                 # Uploaded images (git-ignored)
        └── results/                # Generated images (git-ignored)
```

## Key Conventions

- **`lib/types.ts`** is the single source of truth for all types and constants. Never define feature-related types elsewhere.
- **`lib/server/`** files must never be imported in client components (`'use client'`). They run only in API routes.
- **`components/workbench/`** is the only place for workbench UI. Do not create new top-level component directories.
- **`data/`** and **`public/generated/`** are runtime-only and git-ignored.

## Feature Routing

The app has 4 features, all rendered in the same `<Workbench />` layout:

| Feature ID | Left Panel Form | Right Panel Tab |
|---|---|---|
| `ai-fashion-photo` | AiFashionPhotoForm | current / history / my-model-library |
| `element-replace` | inline in LeftPanel | current / history |
| `photo-fission` | inline in LeftPanel | current / history / fission-case-library |
| `pose-fission` | PoseFissionForm + PoseLibraryDialog | cases / history |

## Fission Feature File Map

`photo-fission` 与 `pose-fission` 是同构 fission feature。新增第三个 fission feature 时应对照以下文件清单确认没有遗漏。详见 `backend/streaming-fission-pipeline.md`。

| 关注点 | photo-fission | pose-fission |
|---|---|---|
| 类型层 | `lib/types.ts:PhotoFissionParams / PhotoFissionShot / PHOTO_FISSION_CATEGORIES` | `lib/types.ts:PoseFissionParams / PoseTemplate / POSE_FISSION_CASES / POSE_TEMPLATES` |
| Pipeline | `lib/server/photo-fission-service.ts:runPhotoFissionPipeline` | `lib/server/pose-fission-service.ts:runPoseFissionPipeline` |
| Retry 路由 | `app/api/tasks/[taskId]/retry-shots/route.ts` | `app/api/pose-fission/tasks/[taskId]/retry/route.ts` |
| Retry 函数 | `lib/server/task-store.ts:retryPhotoFissionShots` | `lib/server/task-store.ts:retryPoseFissionShots` |
| 案例库路由 | `app/api/photo-fission/cases/**` | `app/api/pose-fission/cases/**` |
| 案例库 UI | `components/workbench/right-panel.tsx:PhotoFissionCaseLibrary` | `components/workbench/right-panel.tsx:PoseFissionCaseLibrary` |
| 并发 env | `PHOTO_FISSION_CONCURRENCY`（默认 3） | `POSE_FISSION_CONCURRENCY`（默认 2） |
