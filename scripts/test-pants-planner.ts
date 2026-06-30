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
  'hidden',
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
    imagePromptMode: 'pants-final-prompt',
    pantsFinalPromptContract: { handMode: 'hidden' },
    retryOnSchemaFailure: true,
  })

  const elapsed = Date.now() - startTime
  console.log(`\n✅ LLM 返回成功，耗时 ${elapsed}ms`)
  console.log(`shots 数量: ${output.shots.length}`)
  console.log('')

  const blueprint = getPantsShotBlueprintForCount(resultCount)

  console.log('=== 逐张分析 ===')
  const silhouetteGroups = new Map<string, string[]>()
  const promptTexts: Array<{ shotId: string; prompt: string }> = []

  for (const shot of output.shots) {
    const idx = parseInt(shot.shotId.replace('shot_', '')) - 1
    const view = blueprint[idx]?.view ?? 'front'
    const poseCardId = shot.poseCardId ?? '(missing)'
    const finalPrompt = shot.finalPrompt ?? ''

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

    promptTexts.push({ shotId: shot.shotId, prompt: finalPrompt })

    console.log(`\n--- ${shot.shotId} ---`)
    console.log(`  role: ${shot.role}`)
    console.log(`  view: ${shot.view ?? view}`)
    console.log(`  angle: ${shot.angle ?? '(missing)'}`)
    console.log(`  poseCardId: ${poseCardId}`)
    console.log(`  silhouetteGroup: ${groupKey}`)
    console.log(`  selfCheck: ${shot.selfCheck ?? '(missing)'}`)
    console.log(`  finalPrompt: ${finalPrompt.slice(0, 240)}...`)
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

  console.log('\n=== finalPrompt 文本重复检查 ===')
  const promptSet = new Set<string>()
  let hasPromptDup = false
  for (const item of promptTexts) {
    const normalized = item.prompt.replace(/\s+/g, '').slice(0, 60)
    if (promptSet.has(normalized)) {
      hasPromptDup = true
      console.log(`⚠️  finalPrompt 重复: ${item.shotId} 与前一张前60字相同`)
    }
    promptSet.add(normalized)
  }
  if (!hasPromptDup) {
    console.log('✅ 所有 finalPrompt 前60字均不同')
  }

  console.log('\n=== finalPrompt 输出检查 ===')
  const finalPromptCount = output.shots.filter(
    (s) => typeof s.finalPrompt === 'string' && s.finalPrompt.includes('POSITIVE PROMPT:'),
  ).length
  const missingFinalPromptCount = output.shots.length - finalPromptCount
  console.log(`finalPrompt: ${finalPromptCount}/${output.shots.length}`)
  if (missingFinalPromptCount > 0) {
    console.log(`⚠️  有 ${missingFinalPromptCount} 张缺少标准 finalPrompt！`)
  } else {
    console.log('✅ 全部返回 finalPrompt + 元数据')
  }

  console.log('\n=== 总结 ===')
  if (hasDuplicates) {
    console.log('⚠️  存在轮廓组重复，LLM 自检可能未完全生效')
  } else {
    console.log('✅ 无轮廓组重复')
  }
  if (!hasPromptDup && finalPromptCount === output.shots.length) {
    console.log('✅ 全部 finalPrompt + 元数据输出正常')
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
