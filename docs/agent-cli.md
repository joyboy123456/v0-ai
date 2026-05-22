# Agent CLI

`fashion-ai` 是给 Agent 调用的生图入口，复用平台现有 `task-store`、prompt 组装、fission pipeline、存储适配器和 Google/Raycast provider。

## 运行方式

```bash
pnpm --silent fashion-ai run ai-fashion-photo --image ./input.png --prompt "高级服装商拍" --out ./outputs --json
pnpm --silent fashion-ai run photo-fission --image ./input.png --category tops --out ./outputs --json
pnpm --silent fashion-ai run pose-fission --image ./input.png --poses pose-tpl-stand-front,pose-tpl-stand-side --out ./outputs --json
```

`--json` 模式下，stdout 只输出 JSON；进程退出码非 0 表示失败。

## 三个功能

### AI 服装大片

```bash
pnpm --silent fashion-ai run ai-fashion-photo \
  --image ./product.png \
  --image ./model.png \
  --prompt "保持服装细节，生成高级棚拍电商大片" \
  --prompt-mode enhanced \
  --ratio 3:4 \
  --resolution 2k \
  --out ./outputs \
  --json
```

### AI 服装大片裂变

```bash
pnpm --silent fashion-ai run photo-fission \
  --image ./main.png \
  --front-detail ./front.png \
  --back-detail ./back.png \
  --category tops \
  --ratio 3:4 \
  --resolution 2k \
  --out ./outputs \
  --json
```

### 姿势裂变

```bash
pnpm --silent fashion-ai run pose-fission \
  --image ./main.png \
  --poses pose-tpl-stand-front,pose-tpl-stand-side,pose-tpl-walk-step \
  --ratio 3:4 \
  --resolution 2k \
  --out ./outputs \
  --json
```

不传 `--poses` 时，默认使用基础 3 张：`pose-tpl-stand-front,pose-tpl-stand-side,pose-tpl-walk-step`。

## 常用参数

| 参数 | 说明 |
|---|---|
| `--image` | 输入图片。`ai-fashion-photo` 可重复传多张；`photo-fission` / `pose-fission` 只接受一张主图 |
| `--front-detail` | 正面细节图，仅裂变类功能使用 |
| `--back-detail` | 背面细节图，仅裂变类功能使用 |
| `--ratio` | 图片比例，默认 `3:4` |
| `--resolution` | `1k` / `2k` / `4k`，默认 `2k` |
| `--model` | Gemini 图片模型，不传则使用平台默认模型 |
| `--out` | 结果保存目录；不传则保存到 `outputs/fashion-ai/<taskId>/` |
| `--timeout-ms` | 等待任务完成的超时时间，默认 20 分钟 |
| `--poll-ms` | 任务轮询间隔，默认 1000 |
| `--json` | 输出 Agent 可解析 JSON |

## JSON 输出

成功：

```json
{
  "taskId": "task_xxx",
  "status": "success",
  "message": "生成完成",
  "outDir": "/abs/path/outputs",
  "results": [
    {
      "assetId": "result_task_xxx_shot_1",
      "label": "正面主图",
      "shotId": "shot_1",
      "url": "/generated/results/result_task_xxx_shot_1.jpg",
      "filePath": "/abs/path/outputs/01-正面主图.jpg",
      "finalPrompt": "..."
    }
  ]
}
```

失败：

```json
{
  "ok": false,
  "error": "错误原因"
}
```

## Agent 调用约束

- Agent 应优先使用 `pnpm --silent fashion-ai ... --json`，避免包管理器日志污染 stdout。
- Agent 不要直接调用 Google API，必须通过 CLI 复用平台 pipeline。
- Agent 需要批量生成时，应逐条调用 CLI；后续再补 manifest 批处理。
- 本地 CLI 默认任务用户为 `usr_local_user01`，与本地 Web 平台 fallback 用户一致。
