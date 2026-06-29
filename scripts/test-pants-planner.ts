/**
 * 裤子裂变 LLM 导演测试脚本
 * 只调 DeepSeek 生成 10 段分镜提示词，不生成图片。
 * 用法：npx tsx --env-file=.env.local scripts/test-pants-planner.ts
 */
import { invokeShotPlanner } from '../lib/server/photo-fission-shot-planner'
import {
  buildPantsPlannerSystemPrompt,
  buildPantsPlannerUserPrompt,
  getPantsPoseShapeGroupByCardId,
  getPantsShotBlueprintForCount,
} from '../lib/server/prompt-templates/pants-planner-system'

const resultCount = 10
const traceId = `test-pants-planner-${Date.now()}`

const detailAvailability = {
  hasFrontDetail: false,
  hasSideDetail: false,
  hasBackDetail: false,
}

const systemPrompt = buildPantsPlannerSystemPrompt(
  resultCount,
  [],
  detailAvailability,
)
const userPrompt = buildPantsPlannerUserPrompt(resultCount, [])

console.log('=== 裤子裂变 LLM 导演测试 ===')
console.log(`traceId: ${traceId}`)
console.log(`resultCount: ${resultCount}`)
console.log(`systemPrompt 长度: ${systemPrompt.length} 字`)
console.log(`userPrompt: ${userPrompt.slice(0, 120)}...`)
console.log('')

const startTime = Date.now()

async function main() {
  const output = await invokeShotPlanner({
    systemPrompt,
    userPrompt,
    shotCount: resultCount,
    traceId,
    reasoningEnabled: true,
    imagePromptMode: 'structured',
    retryOnSchemaFailure: true,
  })

  const elapsed = Date.now() - startTime
  console.log(`\n✅ LLM 返回成功，耗时 ${elapsed}ms`)
  console.log(`shots 数量: ${output.shots.length}`)
  console.log('')

  const blueprint = getPantsShotBlueprintForCount(resultCount)

  console.log('=== 逐张分析 ===')
  const silhouetteGroups = new Map<string, string[]>()
  const poseTexts: Array<{ shotId: string; pose: string }> = []

  for (const shot of output.shots) {
    const idx = parseInt(shot.shotId.replace('shot_', '')) - 1
    const view = blueprint[idx]?.view ?? 'front'
    const poseCardId = shot.poseCardId ?? '(missing)'
    const imagePrompt = shot.imagePrompt

    let pose = '(unknown)'
    let framing = '(unknown)'
    let isStructured = false

    if (typeof imagePrompt === 'string') {
      pose = '(STRING MODE - NOT STRUCTURED!)'
      framing = '(string mode)'
    } else {
      isStructured = true
      pose = imagePrompt.pose
      framing = imagePrompt.framing
    }

    const silhouetteGroup = getPantsPoseShapeGroupByCardId(view, poseCardId)
    const groupKey = silhouetteGroup ?? 'none'

    if (silhouetteGroup) {
      const existing = silhouetteGroups.get(groupKey)
      if (existing) {
        existing.push(shot.shotId)
      } else {
        silhouetteGroups.set(groupKey, [shot.shotId])
      }
    }

    poseTexts.push({ shotId: shot.shotId, pose })

    console.log(`\n--- ${shot.shotId} ---`)
    console.log(`  role: ${shot.role}`)
    console.log(`  view: ${view}`)
    console.log(`  poseCardId: ${poseCardId}`)
    console.log(`  silhouetteGroup: ${groupKey}`)
    console.log(`  isStructured: ${isStructured}`)
    console.log(`  pose: ${pose}`)
    console.log(`  framing: ${framing}`)
  }

  console.log('\n=== 轮廓组重复检查 ===')
  let hasDuplicates = false
  for (const [group, shotIds] of silhouetteGroups) {
    if (shotIds.length > 1) {
      hasDuplicates = true
      console.log(`⚠️  ${group}: ${shotIds.join(', ')} (${shotIds.length} 张重复)`)
    } else {
      console.log(`✅ ${group}: ${shotIds[0]}`)
    }
  }

  console.log('\n=== pose 字段文本重复检查 ===')
  const poseSet = new Set<string>()
  let hasPoseDup = false
  for (const item of poseTexts) {
    const normalized = item.pose.replace(/\s+/g, '').slice(0, 20)
    if (poseSet.has(normalized)) {
      hasPoseDup = true
      console.log(`⚠️  pose 重复: ${item.shotId} 与前一张前20字相同`)
    }
    poseSet.add(normalized)
  }
  if (!hasPoseDup) {
    console.log('✅ 所有 pose 字段前20字均不同')
  }

  console.log('\n=== 结构化输出检查 ===')
  const structuredCount = output.shots.filter(
    (s) => typeof s.imagePrompt !== 'string',
  ).length
  const stringCount = output.shots.length - structuredCount
  console.log(`结构化: ${structuredCount}/${output.shots.length}`)
  if (stringCount > 0) {
    console.log(`⚠️  有 ${stringCount} 张返回了 string 而非结构化对象！`)
  } else {
    console.log('✅ 全部返回结构化 JSON 对象')
  }

  console.log('\n=== 总结 ===')
  if (hasDuplicates) {
    console.log('⚠️  存在轮廓组重复，LLM 自检可能未完全生效')
  } else {
    console.log('✅ 无轮廓组重复')
  }
  if (!hasPoseDup && structuredCount === output.shots.length) {
    console.log('✅ 全部结构化 + pose 语义不重复')
  }

  console.log('\n=== 完整 LLM 输出 JSON ===')
  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  const elapsed = Date.now() - startTime
  console.error(`\n❌ LLM 调用失败，耗时 ${elapsed}ms`)
  console.error(error)
  process.exit(1)
})
