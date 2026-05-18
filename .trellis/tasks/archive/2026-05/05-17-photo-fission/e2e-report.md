# 服装大片裂变 photo-fission — E2E 执行报告

执行时间：2026-05-17
执行者：Codex

## 结论

P0 未全部通过，当前不能验收为完成。

主要阻塞：

1. TC-1.1 默认 4 张正向链路未全成功：任务最终为 `partial`，仅成功 2/4。
2. Google 调用中 `shot_2`、`shot_3` 出现 `fetch failed`，后端 partial 容忍逻辑生效，但正向 P0 不通过。
3. TC-6.2 损坏图片上传被接受，`corrupted.jpg` 返回 200 并创建 asset，这是 P1 缺陷。
4. `pnpm lint` 无法执行：`eslint: command not found`。

## 环境

- 本地服务：`http://localhost:3000`
- `GOOGLE_API_KEY`：已设置，未打印真值
- `IMAGE_API_PROVIDER=google`
- `GOOGLE_IMAGE_MODEL=gemini-3.1-flash-image-preview`
- `GOOGLE_IMAGE_TIMEOUT_MS=600000`
- 测试素材目录：`/Users/shishenglin1/Desktop/test-photo-fission`

测试素材：

- `kid-dress.jpg`：5.9MB，童装参考图
- `adult-top.jpg`：116KB，成人服装参考图
- `corrupted.jpg`：17B，伪造损坏图片
- `oversize.jpg`：21MB，超大图片

## 已执行用例

| 用例 | 结果 | 证据 |
|---|---:|---|
| TC-2.1 未上传参考图前端拦截 | 通过 | 点击「立即生成」后显示「请先上传参考图」，store 任务数 28 -> 28 |
| TC-2.2 参数篡改：非法品类/数量/比例等 | 通过 | API 返回 400 中文错误 |
| TC-6.2 超大文件上传 | 通过 | `oversize.jpg` 返回 413 |
| TC-6.2 损坏文件上传 | 失败 | `corrupted.jpg` 返回 200，创建 `asset_1779021215894_jjietl` |
| TC-1.1 默认 4 张创建任务 | 通过 | 创建 `task_1779021215981_av4p72` |
| TC-1.1 默认 4 张最终成功 | 失败 | `status=partial`，message=`已生成 2/4 张，部分镜头失败` |
| TC-1.1 4 张 label 全量结果 | 失败 | shotPlan 有 4 条，但 results 仅 `正面全身`、`服装细节特写` |
| TC-4 数据契约 | 通过 | 成功结果均带 `label`、`shotId`、`finalPrompt` |
| TC-4 API Key 泄露检查 | 通过 | store 中未命中 `AIza` / `GOOGLE_API_KEY` |
| UI 历史展示 partial | 通过 | 历史卡片展示「部分成功」、2 张结果、label 角标 |
| UI 复制全部 Prompt | 待复查 | 按钮存在，但 Browser 读取剪贴板为空 |

## 关键任务数据

```json
{
  "taskId": "task_1779021215981_av4p72",
  "featureType": "photo-fission",
  "status": "partial",
  "message": "已生成 2/4 张，部分镜头失败",
  "shotPlanLabels": ["正面全身", "45度侧面", "半身近景", "服装细节特写"],
  "resultLabels": ["正面全身", "服装细节特写"]
}
```

## 后端日志摘录

```text
[google-api] task=task_1779021215981_av4p72_shot_1 model=gemini-3.1-flash-image-preview count=1 promptLen=499 images=1 aspect=3:4 size=-
[google-api] task=task_1779021215981_av4p72_shot_2 model=gemini-3.1-flash-image-preview count=1 promptLen=506 images=1 aspect=3:4 size=-
[google-api] task=task_1779021215981_av4p72_shot_1 call#1 status=200 took=25515ms
[photo-fission] task=task_1779021215981_av4p72 shot=shot_2 失败：fetch failed
[photo-fission] task=task_1779021215981_av4p72 shot=shot_3 失败：fetch failed
[google-api] task=task_1779021215981_av4p72_shot_4 call#1 status=200 took=19949ms
```

## 截图

- `screenshots/partial-history.png`：历史任务展示 partial、label 角标、复制 Prompt 按钮

## 质量命令

| 命令 | 结果 |
|---|---:|
| `pnpm build` | 通过 |
| `pnpm exec tsc --noEmit` | 通过 |
| `pnpm lint` | 失败：`eslint: command not found` |

## 当前判断

后端核心数据结构和 partial 容忍设计是可用的，UI 历史展示也能显示 label。但 P0 正向全成功没有通过，因此不能验收。

建议下一步：

1. 先排查 Google `fetch failed` 的根因，确认是网络瞬断、图片过大、模型不稳定，还是 adapter 没有重试。
2. 给 per-shot Google 调用增加有限重试，至少对 `fetch failed` / 5xx / 429 做指数退避重试。
3. 修复上传接口：不能只信 MIME type，应校验图片魔数或真实解码结果，拒绝伪造损坏图片。
4. 修复 lint 依赖或脚本配置后重新跑质量门。
5. 修复后重跑 TC-1.1、TC-1.2、TC-1.3，P0 全绿后再继续 P1/P2。
