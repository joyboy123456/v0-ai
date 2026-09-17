/** 冷数据引用只定位资源，不携带读取权限；每次解引用都重新检查用户、会话与资源归属。 */
export interface ContextHandle {
  schemaVersion: 1
  kind: 'asset' | 'task' | 'observation' | 'session_nodes'
  userId: string
  sessionId: string
  resourceId: string
  assetDigest?: string
  observerVersion?: string
}
