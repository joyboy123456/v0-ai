import { buildPantsPlannerSystemPrompt, buildPantsPlannerUserPrompt } from '../lib/server/prompt-templates/pants-planner-system'

const systemPrompt = buildPantsPlannerSystemPrompt(10, [], {
  hasFrontDetail: false,
  hasSideDetail: false,
  hasBackDetail: false,
})

const userPrompt = buildPantsPlannerUserPrompt(10, [])

console.log('===== SYSTEM PROMPT =====')
console.log(systemPrompt)
console.log('\n===== USER PROMPT =====')
console.log(userPrompt)
