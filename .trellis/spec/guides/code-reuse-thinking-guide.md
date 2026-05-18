# Code Reuse Thinking Guide

> **Purpose**: Stop and think before creating new code - does it already exist?

---

## The Problem

**Duplicated code is the #1 source of inconsistency bugs.**

When you copy-paste or rewrite existing logic:
- Bug fixes don't propagate
- Behavior diverges over time
- Codebase becomes harder to understand

---

## Before Writing New Code

### Step 1: Search First

```bash
# Search for similar function names
grep -r "functionName" .

# Search for similar logic
grep -r "keyword" .
```

### Step 2: Ask These Questions

| Question | If Yes... |
|----------|-----------|
| Does a similar function exist? | Use or extend it |
| Is this pattern used elsewhere? | Follow the existing pattern |
| Could this be a shared utility? | Create it in the right place |
| Am I copying code from another file? | **STOP** - extract to shared |

---

## Common Duplication Patterns

### Pattern 1: Copy-Paste Functions

**Bad**: Copying a validation function to another file

**Good**: Extract to shared utilities, import where needed

### Pattern 2: Similar Components

**Bad**: Creating a new component that's 80% similar to existing

**Good**: Extend existing component with props/variants

### Pattern 3: Repeated Constants

**Bad**: Defining the same constant in multiple files

**Good**: Single source of truth, import everywhere

---

## When to Abstract

**Abstract when**:
- Same code appears 3+ times
- Logic is complex enough to have bugs
- Multiple people might need this

**Don't abstract when**:
- Only used once
- Trivial one-liner
- Abstraction would be more complex than duplication

---

## After Batch Modifications

When you've made similar changes to multiple files:

1. **Review**: Did you catch all instances?
2. **Search**: Run grep to find any missed
3. **Consider**: Should this be abstracted?

---

## Gotcha: Asymmetric Mechanisms Producing Same Output

**Problem**: When two different mechanisms must produce the same file set (e.g., recursive directory copy for init vs. manual `files.set()` for update), structural changes (renaming, moving, adding subdirectories) only propagate through the automatic mechanism. The manual one silently drifts.

**Symptom**: Init works perfectly, but update creates files at wrong paths or misses files entirely.

**Prevention checklist**:
- [ ] When migrating directory structures, search for ALL code paths that reference the old structure
- [ ] If one path is auto-derived (glob/copy) and another is manually listed, the manual one needs updating
- [ ] Add a regression test that compares outputs from both mechanisms

---

## Checklist Before Commit

- [ ] Searched for existing similar code
- [ ] No copy-pasted logic that should be shared
- [ ] Constants defined in one place
- [ ] Similar patterns follow same structure

---

## 项目复用第一公民清单（First-Class Reuse Citizens）

下列模式在本项目已经被复用 2 次以上、有固定 spec 契约，**新增同类 feature 时必须照抄**，不要写第二份：

| 模式 | spec | 当前复用方 |
|---|---|---|
| Streaming fission pipeline（N 镜头 + 失败容忍 + 流式持久化 + 子集重跑） | [backend/streaming-fission-pipeline.md](../backend/streaming-fission-pipeline.md) | photo-fission / pose-fission |
| External image API 调用（重试 / 限流 / 错误分类 / traceId） | [backend/external-image-api-reliability.md](../backend/external-image-api-reliability.md) | ai-fashion-photo / photo-fission / pose-fission |
| Case Request 派发（一键做同款 → 切 feature + 回填 LeftPanel 表单） | [frontend/state-management.md](../frontend/state-management.md#case-request-dispatch-pattern-fission-features) | photo-fission / pose-fission |
| SSR 安全的 localStorage 状态 | [frontend/state-management.md](../frontend/state-management.md#critical-ssr-hydration-pattern) | companyModels / favorites |
| Upload 大小校验 | [frontend/component-guidelines.md](../frontend/component-guidelines.md#upload-size-validation) | 所有上传入口 |

**触发条件**：新增 feature 之前先 grep 这张表的 spec。若你的需求形态命中任何一行，**不允许**重写一份 pipeline / 派发逻辑 / 校验函数；必须复用既有实现或在 spec 注释里写明「为什么本次必须差异化」。
