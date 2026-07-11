import path from 'node:path'
import {
  loadJsonFileWithRecovery,
  writeJsonFileAtomic,
} from '@/lib/server/json-file-store'
import type { PoseBodyPart, SavedPose } from '@/lib/types'

interface PersistedState {
  [userId: string]: SavedPose[]
}

const globalStore = globalThis as typeof globalThis & {
  savedPoseStore?: {
    posesByUserId: Map<string, SavedPose[]>
  }
}

const store = globalStore.savedPoseStore ?? {
  posesByUserId: new Map<string, SavedPose[]>(),
}

globalStore.savedPoseStore = store

const workspaceRoot = process.cwd()
const dataDir = path.join(workspaceRoot, 'data')
const stateFilePath = path.join(dataDir, 'saved-poses.json')

let stateLoaded = false
const stateReady = loadState().finally(() => {
  stateLoaded = true
})

async function loadState() {
  const parsed = await loadJsonFileWithRecovery({
    filePath: stateFilePath,
    label: 'saved-pose-store',
    parse: parsePersistedState,
  })
  if (!parsed) return

  const next = new Map<string, SavedPose[]>()
  for (const [userId, poses] of Object.entries(parsed)) {
    if (poses.length) {
      next.set(userId, poses)
    }
  }
  store.posesByUserId = next
}

let persistChain: Promise<void> = Promise.resolve()

function persistState(): Promise<void> {
  const next = persistChain
    .catch(() => undefined)
    .then(() => writeStateFile())
  persistChain = next.catch(() => undefined)
  return next
}

async function writeStateFile() {
  const payload: PersistedState = Object.fromEntries(
    Array.from(store.posesByUserId.entries()).map(([userId, poses]) => [
      userId,
      poses,
    ]),
  )
  await writeJsonFileAtomic(stateFilePath, payload, 'saved-pose-store')
}

async function ensureReady() {
  if (!stateLoaded) await stateReady
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function clonePoses(poses: SavedPose[]): SavedPose[] {
  return poses.map((pose) => ({
    ...pose,
    bodyPart: readPoseBodyPart(pose.bodyPart),
  }))
}

function getUserPoses(userId: string): SavedPose[] {
  return store.posesByUserId.get(userId) ?? []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePersistedState(value: unknown): PersistedState {
  if (!isRecord(value)) {
    throw new Error('姿势库 JSON 根节点必须是对象')
  }

  const parsed: PersistedState = {}
  for (const [userId, poses] of Object.entries(value)) {
    if (!Array.isArray(poses)) continue
    const validPoses = poses.filter(isSavedPose)
    if (validPoses.length) {
      parsed[userId] = validPoses
    }
  }
  return parsed
}

function readPoseBodyPart(value: unknown): PoseBodyPart {
  if (value === 'upper' || value === 'lower') {
    return value
  }
  return 'full'
}

function isSavedPose(value: unknown): value is SavedPose {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.assetId !== 'string' ||
    typeof value.url !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    typeof value.createdAt !== 'string'
  ) {
    return false
  }

  value.bodyPart = readPoseBodyPart(value.bodyPart)
  return true
}

export async function listPoses(userId: string): Promise<SavedPose[]> {
  await ensureReady()
  return clonePoses(getUserPoses(userId))
}

export async function addPose(
  userId: string,
  input: {
    assetId: string
    url: string
    name: string
    width: number
    height: number
    bodyPart: PoseBodyPart
  },
): Promise<SavedPose> {
  await ensureReady()

  const pose: SavedPose = {
    id: createId('pose'),
    userId,
    assetId: input.assetId,
    url: input.url,
    name: input.name,
    width: input.width,
    height: input.height,
    bodyPart: input.bodyPart,
    createdAt: new Date().toISOString(),
  }

  const next = [pose, ...getUserPoses(userId)]
  store.posesByUserId.set(userId, next)
  await persistState()
  return { ...pose }
}

export async function renamePose(
  userId: string,
  id: string,
  name: string,
): Promise<boolean> {
  await ensureReady()

  const poses = getUserPoses(userId)
  const index = poses.findIndex((pose) => pose.id === id)
  if (index < 0) return false

  const next = poses.map((pose, poseIndex) =>
    poseIndex === index ? { ...pose, name } : pose,
  )
  store.posesByUserId.set(userId, next)
  await persistState()
  return true
}

export async function deletePose(
  userId: string,
  id: string,
): Promise<boolean> {
  await ensureReady()

  const poses = getUserPoses(userId)
  if (!poses.length) return false

  const next = poses.filter((pose) => pose.id !== id)
  if (next.length === poses.length) return false

  if (next.length) {
    store.posesByUserId.set(userId, next)
  } else {
    store.posesByUserId.delete(userId)
  }
  await persistState()
  return true
}
