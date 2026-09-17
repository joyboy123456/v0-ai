import type { CanvasNode, StudioDocument } from './model'
import { initialDocument, safeImageUrl, taskStatus } from './model'
const DB_NAME = 'v0-creative-studio-v1'
let connection: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents')
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
    request.onerror = () => { connection = undefined; reject(request.error ?? new Error('无法打开本地存储')) }
    request.onblocked = () => { connection = undefined; reject(new Error('请关闭其他旧版白板标签页后重试')) }
  })
  return connection
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly'), req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}
async function write(store: string, key: string, value: unknown): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('本地存储写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('本地存储写入已中止'))
  })
}
export const putAsset = (id: string, blob: Blob) => write('assets', id, blob)
export function persistedDocument(doc: StudioDocument): StudioDocument {
  const copy = structuredClone(doc)
  const strip = (node: CanvasNode) => { if (node.url?.startsWith('blob:')) delete node.url }
  copy.nodes.forEach(strip)
  copy.tasks.forEach(task => {
    task.snapshot.references.forEach(strip)
    task.slots.forEach(slot => { if (slot.url?.startsWith('blob:')) delete slot.url })
  })
  return copy
}
export const saveDocument = (doc: StudioDocument) => write('documents', 'main', persistedDocument(doc))
export function validateDocument(value: unknown): StudioDocument {
  const doc = value as StudioDocument
  if (!doc || doc.version !== 1 || !Array.isArray(doc.nodes) || doc.nodes.length > 500 || !Array.isArray(doc.tasks) || !doc.draft || !Array.isArray(doc.references)) throw new Error('本地画布格式无法识别；未覆盖原存档')
  const defaults = initialDocument()
  const ids = new Set<string>()
  doc.nodes.forEach(node => {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['image', 'text'].includes(node.kind) || !['x','y','width','height'].every(k => Number.isFinite(node[k as keyof CanvasNode])) || node.width < 1 || node.height < 1 || node.width > 20000 || node.height > 20000 || typeof node.name !== 'string') throw new Error('本地画布对象损坏；未覆盖原存档')
    ids.add(node.id)
    if (node.url && !safeImageUrl(node.url)) delete node.url
  })
  doc.title = typeof doc.title === 'string' ? doc.title.slice(0, 100) : defaults.title
  doc.viewport = doc.viewport && [doc.viewport.x, doc.viewport.y, doc.viewport.zoom].every(Number.isFinite) && doc.viewport.zoom >= .15 && doc.viewport.zoom <= 3 ? doc.viewport : defaults.viewport
  doc.draft = { ...defaults.draft, ...doc.draft, count: Math.min(9, Math.max(1, Number(doc.draft.count) || 4)) }
  if (typeof doc.draft.prompt !== 'string' || !Array.isArray(doc.draft.shots) || !doc.draft.shots.every(x => typeof x === 'string') || !Array.isArray(doc.draft.poses)) throw new Error('本地草稿格式异常')
  doc.references = doc.references.filter(r => r && ids.has(r.nodeId) && typeof r.role === 'string')
  doc.tasks.forEach(task => {
    if (!task || !Array.isArray(task.slots) || !Array.isArray(task.snapshot?.references) || typeof task.id !== 'string') throw new Error('任务存档格式异常')
    task.slots.forEach(slot => {
      if (slot.status === 'running' || slot.status === 'queued') slot.status = 'interrupted'
    })
    task.status = taskStatus(task.slots)
  })
  doc.nodes.forEach(node => { if (node.status === 'running' || node.status === 'queued') node.status = 'interrupted' })
  return doc
}
export async function loadDocument(): Promise<{ document: StudioDocument | null; urls: string[] }> {
  const saved = await read<StudioDocument>('documents', 'main')
  if (!saved) return { document: null, urls: [] }
  const doc = validateDocument(saved), cache = new Map<string, string>(), urls: string[] = []
  const hydrate = async (node: CanvasNode) => {
    if (!node.assetId) return
    if (cache.has(node.assetId)) { node.url = cache.get(node.assetId); return }
    const blob = await read<Blob>('assets', node.assetId)
    if (!blob || !(blob instanceof Blob)) { node.url = undefined; return }
    const url = URL.createObjectURL(blob)
    cache.set(node.assetId, url); urls.push(url); node.url = url
  }
  for (const node of doc.nodes) await hydrate(node)
  for (const task of doc.tasks) {
    for (const ref of task.snapshot.references) await hydrate(ref)
    task.slots.forEach(slot => {
      const node = doc.nodes.find(n => n.id === slot.nodeId)
      if (node?.url) slot.url = node.url
      else if (!slot.url && task.snapshot.references[0]?.assetId) slot.url = task.snapshot.references[0].url
    })
  }
  return { document: doc, urls }
}
