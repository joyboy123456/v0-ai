/** 新 Agent 的服务端策略常量；模型和客户端只能读取，不能提高限额。 */
export const PREVIEW_TTL_MS = 30 * 60_000
export const OBSERVATION_TTL_MS = 24 * 60 * 60_000
export const UNKNOWN_MANUAL_REVIEW_AFTER_MS = 60 * 60_000

/** 本轮预算；付费任务只能由人工确认释放，v2 并行/迭代额度尚不启用。 */
export const AGENT_BUDGET = Object.freeze({
  maxModelCallsPerTurn: 3,
  maxReadToolCallsPerTurn: 6,
  maxLatencyMsPerTurn: 15_000,
  maxClassificationsPerTurn: 2,
  maxCutoutPreparationsPerTurn: 1,
  maxPaidTasksPerApproval: 1,
  maxResultsPerApproval: 1,
  maxPaidApprovalsPerUserPerDay: 20,
  maxGlobalActiveTasks: 1,
  maxTextParallelPathsV2: 2,
  maxResultReviewsPerImage: 1,
  maxTextRevisionsPerGoalV2: 5,
  maxPaidGenerationsPerGoalV2: 3,
  maxStagnantRoundsV2: 2,
  maxAddedStepsPerPatchV2: 1,
})
