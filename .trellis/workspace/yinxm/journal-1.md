# Journal - yinxm (Part 1)

> AI development session journal
> Started: 2026-05-17

---



## Session 1: photo-fission v3+v4: 9张固定套图 + Google生图稳定性 R1-R7

**Date**: 2026-05-18
**Task**: photo-fission v3+v4: 9张固定套图 + Google生图稳定性 R1-R7
**Branch**: `main`

### Summary

PRD v3 落地 photo-fission 9 张固定套图与 12 段强约束 prompt（身份/服装/场景/光线/风格 5 锁 + 解剖 + 禁止项）。PRD v4 完成 Google 生图稳定性第一阶段优化 R1-R7：统一 callGoogleImageWithRetry wrapper（GoogleImageError 10 类 category + 指数退避 + jitter + Retry-After 尊重）、进程级 IPM/RPM 令牌桶、JSON-line 结构化日志（traceId/taskId/shotId/attempt/category）、partial 失败镜头重跑入口、401/403 全局熔断 30s、输入预检（参考图≤10MB / finalPrompt≤30000字）。ai-fashion-photo 与 photo-fission 共用同一 wrapper，删除字符串匹配判错的旧逻辑。同步新增 .trellis/spec/backend/external-image-api-reliability.md 工程契约与 .trellis/spec/guides/external-ai-api-thinking-guide.md 思考清单，沉淀为可执行 7 sections code-spec。研究产物 5 篇 stability-*.md 沉淀到 task research/。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8a0e45b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
