# Quality Guidelines

## Image Provider Architecture

The project supports two image generation providers, switched via `IMAGE_API_PROVIDER` env var.

> **Fission features exception**：`pose-fission` 跳过 `IMAGE_API_PROVIDER` 切换，直接在 `task-store.runTask` 内分流到 `runPoseFissionPipeline` → `runImageEditViaProvider`。原因详见 `backend/streaming-fission-pipeline.md`。`photo-fission` 出于历史 demo 路径兼容仍走 `runThirdPartyWorkflow`，但实际 provider 调用同样经 `runImageEditViaProvider`。新增 fission feature 时**应直接学 pose-fission 的分流**，省一层 dispatcher。

### Provider: `raycast` (default)

- Endpoint: `POST ${IMAGE_API_BASE_URL}/v1/images/edits` (OpenAI-compatible)
- Auth: `Authorization: Bearer ${IMAGE_API_KEY}` (optional)
- Image field: `image` — accepts string (single dataURL) or array of strings (multi-image)
- Response: `{ data: [{ b64_json, revised_prompt }] }`
- Timeout: `IMAGE_API_TIMEOUT_MS` (default 120s)
- Demo mode: `IMAGE_API_DEMO=1` returns Unsplash placeholder images

### Provider: `google`

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Auth: `x-goog-api-key: ${GOOGLE_API_KEY}` header
- Model: `GOOGLE_IMAGE_MODEL` (default `gemini-3.1-flash-image-preview`)
- Request body:
  ```json
  {
    "contents": [{ "role": "user", "parts": [
      { "inline_data": { "mimeType": "image/png", "data": "<base64>" } },
      { "text": "<prompt>" }
    ]}],
    "generationConfig": {
      "imageConfig": { "aspectRatio": "3:4", "imageSize": "1K" }
    }
  }
  ```
- **CRITICAL**: Do NOT pass `responseModalities` — it causes 404 on 3.x models
- **CRITICAL**: Use `generationConfig.imageConfig` NOT `generationConfig.response_format.image` (SDK-only field)
- **CRITICAL**: `imageSize` must be uppercase: `"1K"`, `"2K"`, `"4K"` (lowercase causes 400)
- Response: `candidates[0].content.parts[*].inlineData.data` (base64, skip parts with `thought: true`)
- Timeout: `GOOGLE_IMAGE_TIMEOUT_MS` (default 600s — 3.x models can take 2+ minutes, multi-image / Pro thinking pushes 200s+)

### Available Selectable Models

| Model ID | Name | Notes |
|---|---|---|
| `gemini-3.1-flash-image-preview` | Nano Banana | Max 14 input images, up to 4K |
| `gemini-3-pro-image-preview` | Nano Banana Pro | Google flagship quality, thinking mode, slower |
| `gpt-image-2` | GPT Image 2 | Requires a compatible `qiniu` provider (`openai/gpt-image-*`) |

All feature forms that expose model choice should use the shared `FashionModelSelect` style and render `SELECTABLE_FASHION_MODELS`, so AI fashion photo, photo fission, and pose fission stay visually consistent.

## Asset Resolution Before API Call

Assets stored on disk have `fileUrl = "/generated/assets/xxx.png"` (relative path). The image proxy cannot fetch relative URLs.

**Solution**: `resolveAssetToDataUrl()` in `task-store.ts` reads the file from disk and converts to dataURL before sending to the API.

```typescript
// ✅ Correct — resolves to dataURL
const inputImages = await Promise.all(
  task.inputAssetIds.map(async (assetId) => {
    const asset = store.assets.get(assetId)
    if (!asset) return null
    if (asset.dataUrl) return asset.dataUrl
    return resolveAssetToDataUrl(asset)  // reads disk, returns data:image/...;base64,...
  })
)
```

```typescript
// ❌ Wrong — sends relative path, proxy rejects with "Invalid JSON"
const inputImages = task.inputAssetIds.map((id) => store.assets.get(id)?.fileUrl)
```

## ai-fashion-photo Prompt Strategy

The prompt is sent **as-is** from the user. No backend wrapping.

- Images are passed as an array: `[image1_dataURL, image2_dataURL, ...]`
- The model treats them as "Image 1", "Image 2", etc. in order
- The user must describe each image's role in the prompt
- The frontend placeholder guides users with an example

**Do not** add system-level prompt wrapping — it limits user control and was removed intentionally.

## Forbidden Patterns

### Don't use SVG reference sheets

Previously the code assembled multiple images into a single SVG "reference board" before sending to the API. This was removed because:
- The proxy natively supports multi-image arrays
- SVG degrades image quality (each image is scaled to a small cell)
- The model sees a "grid image" not individual references

### Don't initialize localStorage state in useState initializer

See `state-management.md` for the correct SSR hydration pattern.

### Don't send `responseModalities` to Google Gemini 3.x

Causes 404. The default behavior (text + image) is what we want anyway.
