# Developer Journal — kiro

---

## Session 1: AI Fashion Photo Feature — Full Refactor + Google Gemini Integration

**Date**: 2026-05-17
**Branch**: `main`

### Summary

Refactored the `ai-fashion-photo` feature end-to-end: unified model library into reference images, fixed SSR hydration, wired Google Gemini official API, added upload size guard, and built out model library CRUD + history panel.

---

### Context: What This Project Is

**AI 服装电商创作工作台** — An AI-powered e-commerce image generation workbench for fashion merchants.

- **Stack**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui
- **4 features**: AI Fashion Photo, Element Replace, Photo Fission, Pose Fission
- **Image API**: Pluggable provider (Raycast local proxy OR Google Gemini official)
- **Storage**: In-memory Map + JSON file (`data/fashion-mvp-store.json`) — MVP only, no DB
- **Single page**: Everything renders inside `<Workbench />` at `/`

---

### Main Changes

#### 1. Model Library → Reference Images Unification

**Before**: Model library had a separate "selected model" state. Selecting a model was distinct from uploading a reference image.

**After**: Selecting a model = adding it as a reference image. `fashionReferences` state is lifted to `Workbench`. Both `LeftPanel` and `RightPanel` share it via props.

Key files changed:
- `components/workbench/workbench.tsx` — lifted `fashionReferences` state, added `handleAddFashionReference`, `handleRemoveFashionReference`
- `components/workbench/left-panel.tsx` — removed local `fashionReferences` state, removed `selectedCompanyModel`, `CompanyModelStrip` now calls `onAddModelReference` directly
- `components/workbench/right-panel.tsx` — `MyModelLibraryPanel` now calls `onConfirm(models[])` which maps to `onAddFashionReference`

#### 2. Prompt Strategy: User-Controlled (No Backend Wrapping)

**Before**: Backend wrapped user prompt in a long system prompt with PRESERVE/AVOID instructions.

**After**: `buildAiFashionPhotoPrompt()` returns `params.prompt` directly. User writes the full prompt. Frontend placeholder guides with example: "让图1的女孩穿上图2的连衣裙..."

#### 3. Multi-Image: Array Instead of SVG Reference Sheet

**Before**: Multiple images were assembled into a single SVG "reference board" (grid layout with labels).

**After**: Images sent as a plain array `["data:image/png;base64,...", ...]`. The proxy (both Raycast v1.1 and Google) natively supports multi-image arrays.

Removed: `createAiFashionPhotoReferenceSheet()` function entirely.

#### 4. Asset Resolution Fix

**Problem**: Assets stored on disk have `fileUrl = "/generated/assets/xxx.png"`. Sending this relative path to the image proxy caused `Invalid JSON` error (proxy can't fetch relative URLs).

**Fix**: Added `resolveAssetToDataUrl()` in `task-store.ts` — reads file from disk, returns `data:image/...;base64,...`.

#### 5. Upload Size Guard (8MB limit)

Added `validateUploadSize(file)` in `lib/utils.ts`. Applied to all 3 upload entry points:
- `UploadBox` (single image, used by element-replace / photo-fission / pose-fission)
- `FashionReferenceUploader` (multi-image, ai-fashion-photo)
- `MyModelLibraryPanel` upload button

**Why 8MB**: Proxy recommends ≤10MB. Base64 inflates ~1.33×. 8MB raw → ~10.7MB body, safe.

#### 6. SSR Hydration Fix

`companyModels` was initialized from `localStorage` in `useState()` initializer, causing React hydration mismatch. Fixed with empty initial state + `useEffect` hydration + `companyModelsHydrated` guard flag. Same pattern applied to `favorites` in `RightPanel`.

#### 7. Google Gemini Official API Integration

New file: `lib/server/google-genai-adapter.ts`

Switch via: `IMAGE_API_PROVIDER=google` in `.env.local`

**Critical findings** (took significant debugging):
- Do NOT pass `generationConfig.responseModalities` — causes 404 on 3.x models
- Use `generationConfig.imageConfig.aspectRatio` / `imageConfig.imageSize` (NOT `response_format.image.*` which is SDK-only)
- `imageSize` must be uppercase: `"1K"`, `"2K"`, `"4K"` (lowercase → 400)
- Nano Banana 2 / Pro emit "thought images" (intermediate compositions) — skip parts with `thought: true`, take the last non-thought image
- 3.x models can take 2+ minutes per image (thinking mode is always on)
- Rate limits are aggressive — don't run probe scripts in rapid succession

**Current `.env.local` state**:
```
IMAGE_API_PROVIDER=google
GOOGLE_API_KEY=<set>
GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

#### 8. Model Library CRUD

`MyModelLibraryPanel` now supports:
- **Delete**: Hover → 🗑️ → confirmation overlay
- **Rename**: Double-click name OR hover → ✏️ → inline input (Enter/blur saves, Esc cancels)
- **Multi-select**: Single click selects, double click immediately adds + closes

#### 9. History Panel Enhancement

`TaskHistory` now shows:
- Result thumbnails inline (per-image star + download on hover)
- Prompt text (line-clamp-2)
- Error message for failed tasks
- "复制提示词" button (copies to clipboard, shows "已复制" for 1.5s)
- Favorites persisted to `localStorage` (key: `fashion_favorites`)

---

### Git Commits (today's work — not yet committed)

All changes are uncommitted local modifications. Last committed state: `56f8b2a` (README rewrite).

Files modified:
- `lib/types.ts` — removed `FashionModel`, `FASHION_MODELS`, `officialModelId/Name` from `AiFashionPhotoParams`
- `lib/utils.ts` — added `validateUploadSize`, `MAX_UPLOAD_BYTES`
- `lib/server/ai-fashion-photo-service.ts` — simplified prompt builder, removed SVG sheet
- `lib/server/task-store.ts` — added `resolveAssetToDataUrl`, fixed input image resolution
- `lib/server/third-party-image-adapter.ts` — added Google provider dispatch, `extractGoogleImageOptions`
- `lib/server/google-genai-adapter.ts` — NEW: Google Gemini REST adapter
- `components/workbench/workbench.tsx` — lifted `fashionReferences`, added CRUD callbacks, SSR hydration fix
- `components/workbench/left-panel.tsx` — removed `selectedCompanyModel`, unified reference flow
- `components/workbench/right-panel.tsx` — `MyModelLibraryPanel` CRUD, `TaskHistory` enhancement, favorites persistence
- `components/workbench/upload-components.tsx` — added size validation
- `.env.local` — added Google API config, switched provider to `google`
- `.env.example` — updated with Google vars

---

### Testing Status

- [OK] `pnpm build` passes (TypeScript + Next.js build)
- [OK] No TypeScript diagnostics on changed files
- [OK] Google Gemini 2.5 flash image: end-to-end tested with real pillow image → 200 OK
- [OK] Google Gemini 3.1 flash image preview: end-to-end tested → 200 OK (~116s)
- [PARTIAL] Raycast proxy: previously working, not re-tested after today's changes (asset resolution fix should help)
- [TODO] UI smoke test: model library CRUD, history panel, reference image flow

---

### Status

🔄 **In Progress** — Core changes done, needs UI smoke test + commit

---

### Next Steps

1. **Commit today's changes** — all modified files above
2. **UI smoke test** — test model library CRUD, reference image flow, history panel in browser
3. **Verify Raycast provider still works** — switch `IMAGE_API_PROVIDER=raycast` and test
4. **Image compression** — currently blocked on >8MB images. Consider canvas-based compression in browser as a future improvement (currently just blocked with error message)
5. **Other 3 features** — element-replace, photo-fission, pose-fission are untouched. Their SVG reference sheets are still in place (intentional — only ai-fashion-photo was refactored)
6. **Model selection UI** — add a dropdown to switch between Nano Banana / Nano Banana 2 / Nano Banana Pro (deferred)

---

### Key Decisions Made

| Decision | Rationale |
|---|---|
| User writes full prompt (no backend wrapping) | More control, matches how Cherry Studio / industry tools work |
| Model library = reference images (unified) | Simpler mental model, no "selected model" concept |
| 8MB upload limit (hard block, no compression) | Simplest fix; compression deferred |
| Google Gemini as default provider | Better identity preservation, official API |
| `gemini-3.1-flash-image-preview` as default model | Balance of quality and speed; Pro is slower |
| No model selection UI yet | Deferred; env var is sufficient for now |
