import { AgentBetaRepository } from './repository'
import { AgentBetaService } from './service'
import { resolveAgentBetaLlmConfig } from './llm-config'
import { plannerOutputSchema } from './validation'

const globalBeta = globalThis as typeof globalThis & { agentBetaService?: Promise<AgentBetaService> }

/** 在服务端门禁通过后加载业务依赖，默认关闭时不初始化任务仓库或调度器。 */
export function getAgentBetaService(): Promise<AgentBetaService> {
  globalBeta.agentBetaService ??= (async () => {
    const [tasks, scheduler, planner] = await Promise.all([
      import('@/lib/server/task-store'),
      import('@/lib/server/image-work-scheduler'),
      import('@/lib/server/fission-prompt-planner'),
    ])
    return new AgentBetaService(new AgentBetaRepository(), {
      getAsset: tasks.getAsset,
      getTask: tasks.getTask,
      createTask: tasks.createTask,
      cancelTask: tasks.cancelTask,
      getTaskId: tasks.getIdempotentTaskId,
      isTaskExecutionActive: tasks.isTaskExecutionActive,
      assertQueueCapacity: () => scheduler.assertImageQueueCapacity(1),
      plan: (input) => planner.invokeFissionPromptPlanner({
        ...input, outputSchema: plannerOutputSchema, feature: 'agent-beta',
        plannerName: '服饰创作助手', temperature: 0.4, reasoningEnabled: false,
        retryOnSchemaFailure: false,
        // 画布专属 LLM：按用户选择解析目录（AGENT_LLM_* / AGENT_LLM_ANTHROPIC_*），未配置时回退 TEXT_LLM_*；生图仍走供应商池
        llm: resolveAgentBetaLlmConfig(input.plannerLlm),
      }),
    })
  })()
  return globalBeta.agentBetaService
}
