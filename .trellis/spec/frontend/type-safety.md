# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

(To be filled by the team)

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

### Scenario: Workbench Generation Task Contracts

#### 1. Scope / Trigger

This applies when a workbench feature reads feature-specific server data, creates a generation task through `POST /api/tasks`, and later renders task results in the UI.

Trigger for this contract:

* Adding or changing a `FeatureType`.
* Adding or changing a feature-specific params interface.
* Changing task credit calculation, workflow routing, or third-party image adapter payloads.

#### 2. Signatures

Frontend task creation shape:

```typescript
interface CreateTaskBody {
  featureType: FeatureType
  inputAssetIds: string[]
  params: TaskParams
}
```

Pose fission cases are read from the backend, not hard-coded as the only source in UI code:

```typescript
GET /api/pose-fission/cases
// -> { cases: PoseCase[] }
```

Shared task params must be represented as a discriminated-by-feature union through `TaskParams` in `lib/types.ts`. Each feature-specific form is responsible for submitting the matching params shape, and the server is responsible for normalizing and validating params before storing a task.

```typescript
export type TaskParams =
  | AiFashionPhotoParams
  | PhotoFissionParams
  | BackgroundReplaceParams
  | PoseFissionParams
```

#### 3. Contracts

`FeatureType` is the source of truth for workbench feature ids. Any new feature must update these shared constants together:

* `FEATURES`
* `FEATURE_LABELS`
* `FEATURE_WORKFLOWS`
* Any feature-specific option/case constants used by the form or gallery

Feature-specific params must include only serializable data because they cross the client/server boundary through JSON.

For pose fission specifically, the server owns:

* Pose case existence checks.
* Image ratio and resolution validation.
* Optional detail-image boolean validation.
* Asset count consistency against `hasFrontDetail` / `hasBackDetail`.
* Filling derived fields such as `poseName`, `posePrompt`, `resultCount`, and `creditsCost`.

#### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Missing `featureType`, `inputAssetIds`, or `params` | `POST /api/tasks` returns 400 with a clear error |
| Missing uploaded asset id | Task store rejects with `素材不存在：<assetId>` |
| Feature requires multiple images but not enough were uploaded | Third-party adapter throws a feature-specific error |
| Form-required UI input is missing | Client form blocks submission and displays a local error |
| Pose fission `poseCaseId` does not exist | Server returns 400 with `姿势案例不存在` |
| Pose fission detail booleans do not match asset count | Server returns 400 with `姿势裂变素材数量与细节图参数不一致` |
| Pose fission image ratio or resolution is invalid | Server returns 400 with a field-specific error |

#### 5. Good/Base/Bad Cases

Good:

```typescript
const params: PoseFissionParams = {
  version: 'advanced',
  poseCaseId: selectedPoseCase.id,
  poseName: selectedPoseCase.name,
  posePrompt: selectedPoseCase.prompt,
  hasFrontDetail: Boolean(frontDetailImage),
  hasBackDetail: Boolean(backDetailImage),
  imageRatio: '3:4',
  resolution: '4k',
  resultCount: 6,
  creditsCost: 35,
}
```

Base:

* One required main image plus optional detail images.
* One selected pose case.
* Existing task polling and result rendering are reused.
* UI may send only the editable pose fission fields; the backend fills canonical derived fields.

Bad:

```typescript
// Do not send File, Blob, or object URLs inside params.
const params = { poseImageFile: file }
```

#### 6. Tests Required

When changing this contract, verify:

* TypeScript passes with `tsc --noEmit`.
* A production build passes.
* The form blocks missing required inputs before calling `POST /api/tasks`.
* Demo mode returns the requested result count for the feature.
* The task can be retrieved through `GET /api/tasks/[taskId]`.
* Invalid pose case id returns 400.
* Pose fission task params returned by `GET /api/tasks/[taskId]` contain normalized `poseName`, `posePrompt`, `resultCount`, and `creditsCost`.

### Scenario: Raycast Local Proxy Image Adapter

#### 1. Scope / Trigger

This applies when server code calls the OpenAI-compatible Raycast Local Proxy image API for text-to-image or image edits.

#### 2. Signatures

Default local proxy configuration:

```env
IMAGE_API_BASE_URL=http://127.0.0.1:11436/v1
IMAGE_API_MODEL=gpt-image-2
IMAGE_API_DEMO=0
```

Image edits call:

```typescript
POST ${IMAGE_API_BASE_URL}/images/edits
{
  model: 'gpt-image-2' | 'nano-banana' | string,
  prompt: string,
  image: string,
  n: 1 | 2 | 3 | 4,
  response_format: 'url'
}
```

#### 3. Contracts

* The adapter defaults to the real local proxy at `http://127.0.0.1:11436/v1`.
* Demo mode is opt-in only through `IMAGE_API_DEMO=1`.
* `Authorization: Bearer <key>` is sent only when `IMAGE_API_KEY` is non-empty because the proxy may run without an API key.
* The proxy health endpoint lives at `/health`, outside `/v1`.
* The image API can return either `url` or `b64_json`; the adapter must accept both.
* Each edit batch must use `n <= 4`.
* Image calls need a long timeout because image edits can take more than one minute.

#### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| `IMAGE_API_DEMO=1` | Skip Raycast and return local demo image URLs |
| Proxy health check fails | Task fails with a clear Raycast Local Proxy availability error |
| `/images/edits` returns OpenAI-compatible error | Task fails with `error.message` from the proxy |
| Response omits both `url` and `b64_json` | Adapter skips the item and fails if no usable results remain |

#### 5. Good/Base/Bad Cases

Good:

```typescript
body: JSON.stringify({
  model: raycastImageModel,
  prompt,
  image: referenceSheetDataUrl,
  n: batchSize,
  response_format: 'url',
})
```

Bad:

```typescript
// Do not silently force demo mode just because IMAGE_API_BASE_URL is absent.
const demoMode = !process.env.IMAGE_API_BASE_URL
```

#### 6. Tests Required

When changing this adapter, verify:

* TypeScript passes with `tsc --noEmit`.
* Production build passes.
* Demo mode can still complete a task with `IMAGE_API_DEMO=1`.
* Real mode reports a clear proxy availability error when Raycast Local Proxy is not running.

#### 7. Wrong vs Correct

Wrong:

```typescript
// Feature id added only in the sidebar; server workflow lookup is missing.
export type FeatureType = 'new-feature'
```

Correct:

```typescript
export type FeatureType = 'new-feature'

export const FEATURE_WORKFLOWS: Record<FeatureType, string> = {
  'new-feature': 'new_feature_v1',
}
```

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

(To be filled by the team)
