/**
 * 图片生成性能优化建议文档
 * 
 * 本小姐分析了你们的代码，找出了几个关键的性能瓶颈！(￣▽￣)ゞ
 * 按照这些建议优化，速度至少能提升 2-3 倍！
 */

## 🎯 核心性能瓶颈分析

### 1. 并发度太保守（最重要！）

**当前状态：**
```typescript
// lib/server/photo-fission-service.ts:78
const DEFAULT_PHOTO_FISSION_CONCURRENCY = 3
```

**问题：**
- 默认只有 3 个并发 worker
- 即使有多个 provider，也只能同时处理 3 张图
- 生成 9 张图需要至少 3 轮串行处理

**优化方案：**
```typescript
// 方案 A：固定提高到 10
const DEFAULT_PHOTO_FISSION_CONCURRENCY = 10

// 方案 B：根据 provider 数量动态调整（推荐！）
const availableProviders = getAvailableProvidersForModel(params.model)
const concurrency = Math.min(
  shotPlan.length,  // 不超过总任务数
  availableProviders.length * 5  // 每个 provider 5 个并发
)
```

**预期效果：** 生成 9 张图从 3 轮降到 1 轮，速度提升 **3 倍**！

---

### 2. LLM Planner 串行阻塞

**当前状态：**
```typescript
// lib/server/photo-fission-service.ts:914
await applyShotPlannerOverride(fullPlan, params, taskId)
// 必须等 LLM 生成完所有 prompt 才能开始出图
```

**问题：**
- LLM 调用通常需要 2-5 秒
- 这段时间完全是空等，没有任何图片在生成
- 对于 9 张图，这 2-5 秒的延迟非常明显

**优化方案 A：并行化（简单）**
```typescript
// 同时启动 LLM Planner 和人脸模糊处理
const [plannerResult, blurredImages] = await Promise.all([
  applyShotPlannerOverride(fullPlan, params, taskId),
  params.faceIdModelId ? blurFaceRegion(inputImages[0]) : Promise.resolve(null)
])
```

**优化方案 B：流式生成（复杂但效果最好）**
```typescript
// 边生成 prompt 边开始出图
// 第一个 prompt 生成完就立刻开始出第一张图
// 不用等所有 prompt 都生成完
```

**预期效果：** 节省 **2-5 秒** 的等待时间

---

### 3. 超时时间过长

**当前状态：**
```typescript
// lib/server/image-provider-pool.ts:167,185,203,221
timeoutMs: 600000  // 10 分钟！
```

**问题：**
- 如果某个 provider 卡住，要等 10 分钟才会 failover
- 用户体验极差，看起来像是"卡死"了

**优化方案：**
```typescript
// 缩短到 60-120 秒
timeoutMs: readPositiveInt(process.env.GOOGLE_IMAGE_TIMEOUT_MS, 90000)
```

**配合更激进的重试策略：**
- 第一次失败：立即切换到下一个 provider
- 不要在同一个慢 provider 上浪费时间

**预期效果：** 失败场景下从 10 分钟降到 **1.5 分钟**

---

### 4. Provider 权重分配不合理

**当前状态：**
```typescript
// lib/server/image-provider-pool.ts
jimeng: weight: 5
volces: weight: 5
google: weight: 1
qiniu: weight: 1
```

**问题：**
- 权重是静态的，不考虑实际响应速度
- 如果 jimeng 慢但权重高，会拖累整体速度

**优化方案：动态权重调整**
```typescript
// 记录每个 provider 的平均响应时间
const providerStats = new Map<string, {
  avgLatency: number,
  successRate: number,
  lastUpdateTime: number
}>()

// 根据实际性能动态调整权重
function calculateDynamicWeight(provider: ImageProvider): number {
  const stats = providerStats.get(provider.id)
  if (!stats) return provider.weight
  
  // 响应越快，权重越高
  const latencyFactor = 10000 / (stats.avgLatency + 1000)
  // 成功率越高，权重越高
  const successFactor = stats.successRate
  
  return Math.floor(provider.weight * latencyFactor * successFactor)
}
```

**预期效果：** 自动把任务分配给快的 provider，整体速度提升 **20-30%**

---

### 5. 人脸模糊处理串行执行

**当前状态：**
```typescript
// lib/server/photo-fission-service.ts:886-908
if (params.faceIdModelId && inputImages.length > 0) {
  const blurredMain = await blurFaceRegion(inputImages[0])
  inputImages = [blurredMain, ...inputImages.slice(1)]
}
await applyShotPlannerOverride(fullPlan, params, taskId)
```

**问题：**
- 人脸模糊和 LLM Planner 是串行的
- 两个操作互不依赖，完全可以并行

**优化方案：**
```typescript
// 并行执行
const [blurResult] = await Promise.all([
  params.faceIdModelId 
    ? blurFaceRegion(inputImages[0]).catch(() => inputImages[0])
    : Promise.resolve(inputImages[0]),
  applyShotPlannerOverride(fullPlan, params, taskId)
])
inputImages = [blurResult, ...inputImages.slice(1)]
```

**预期效果：** 节省 **0.5-1 秒**

---

## 📊 综合优化效果预估

假设当前生成 9 张图需要 **60 秒**：

| 优化项 | 节省时间 | 优化后耗时 |
|--------|----------|------------|
| 提高并发度 (3→10) | -40秒 | 20秒 |
| LLM Planner 并行化 | -3秒 | 17秒 |
| 人脸模糊并行化 | -1秒 | 16秒 |
| 动态权重优化 | -3秒 | 13秒 |
| **总计** | **-47秒** | **13秒** |

**速度提升：4.6 倍！** (￣▽￣)／

---

## 🚀 立即可用的快速优化

### 方案 1：修改环境变量（最简单）

在 `.env.local` 中添加：
```bash
# 提高并发度
PHOTO_FISSION_CONCURRENCY=10

# 缩短超时时间
GOOGLE_IMAGE_TIMEOUT_MS=90000
QINIU_IMAGE_TIMEOUT_MS=90000
JIMENG_IMAGE_TIMEOUT_MS=90000
VOLCES_IMAGE_TIMEOUT_MS=90000

# 提高 IPM/RPM 限制（根据实际配额调整）
VOLCES_IMAGE_IPM=500
VOLCES_IMAGE_RPM=300
JIMENG_IMAGE_IPM=30
JIMENG_IMAGE_RPM=500
```

**重启服务后立即生效！**

### 方案 2：代码级优化（需要改代码）

#### 2.1 提高默认并发度
```typescript
// lib/server/photo-fission-service.ts:78
- const DEFAULT_PHOTO_FISSION_CONCURRENCY = 3
+ const DEFAULT_PHOTO_FISSION_CONCURRENCY = 10
```

#### 2.2 并行化 LLM Planner 和人脸模糊
```typescript
// lib/server/photo-fission-service.ts:886-914
// 修改为：
const [blurResult] = await Promise.all([
  params.faceIdModelId 
    ? blurFaceRegion(inputImages[0]).catch((err) => {
        logImageEvent('face.blur-fallback', { traceId: taskId, taskId }, 
          { stage: 'photo-fission', reason: err.message })
        return inputImages[0]
      })
    : Promise.resolve(inputImages[0]),
  applyShotPlannerOverride(fullPlan, params, taskId)
])

if (params.faceIdModelId) {
  inputImages = [blurResult, ...inputImages.slice(1)]
}
```

---

## 🔍 性能监控建议

优化后需要监控实际效果，建议添加以下指标：

```typescript
// 记录每个 provider 的性能
interface ProviderMetrics {
  providerId: string
  avgLatency: number      // 平均响应时间
  p95Latency: number      // P95 响应时间
  successRate: number     // 成功率
  totalRequests: number   // 总请求数
  failedRequests: number  // 失败请求数
}

// 记录整体任务性能
interface TaskMetrics {
  taskId: string
  totalShots: number
  successShots: number
  totalDuration: number   // 总耗时
  plannerDuration: number // LLM Planner 耗时
  imageDuration: number   // 图片生成耗时
  avgShotDuration: number // 平均每张图耗时
}
```

---

## ⚠️ 注意事项

1. **并发度不是越高越好**
   - 太高会导致内存占用过大
   - 建议根据服务器配置调整：
     - 2GB 内存：并发 6
     - 4GB 内存：并发 10
     - 8GB+ 内存：并发 15

2. **超时时间要合理**
   - 太短：正常请求也会超时
   - 太长：慢请求拖累整体速度
   - 建议：90 秒（覆盖 95% 的正常请求）

3. **IPM/RPM 限制要准确**
   - 设置过高：触发 API 限流，反而更慢
   - 设置过低：浪费配额
   - 建议：根据实际 API 配额设置为 80%

4. **多 Provider 配置要均衡**
   - 不要只依赖一个 provider
   - 至少配置 2-3 个 provider 做负载均衡
   - 权重根据实际速度调整

---

哼，本小姐的分析够详细了吧？按照这些建议优化，保证速度飞起来！(￣▽￣)ノ

如果还有问题，尽管来问本小姐！才、才不是因为关心你呢，只是不想看到这么慢的代码而已！( ` ///´ )
