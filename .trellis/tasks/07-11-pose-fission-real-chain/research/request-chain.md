# 姿势裂变真实请求链路

1. `components/workbench/left-panel.tsx` 向 `POST /api/tasks` 提交 `featureType`、按主图/正面细节/背面细节排列的 `inputAssetIds` 和姿势参数；浏览器不提交 Prompt。
2. `app/api/tasks/route.ts` 调用 `createTask`。
3. `lib/server/task-store.ts` 标准化参数、异步启动 `runTask`，并保持素材顺序转换为 data URL。
4. `lib/server/pose-fission-service.ts` 对每个姿势单独构建 Prompt，将当前姿势图追加到素材数组最后，再调用一次 `runImageEditViaProvider({ count: 1 })`。
5. 单次图片顺序为：主图 → 可选正面细节 → 可选背面细节 → 当前姿势图。
6. Gemini 请求把图片按顺序放入 `parts`，Prompt 文本位于最后；OpenAI/Seedream 请求把 Prompt 放入 `prompt`、图片放入同序 `image[]`。
7. `provider-image-router.ts` 已支持 `inputImageLabels` 并将其传给 Google 和老张 Gemini；姿势裂变当前尚未传入标签。
8. Provider Pool 和 Adapter 不应承载姿势业务规则，规则集中在任务参数和逐姿势 Prompt 构建阶段。
