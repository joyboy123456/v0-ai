import type { CanvasNode, StudioDocument } from './model'
type Change = { id: string; before: CanvasNode | null; after: CanvasNode | null; keys: (keyof CanvasNode)[] }
export type Edit = Change[]
/** Field-level edits: undoing a move never rolls back a late-arriving AI result. */
export function diffNodes(before: CanvasNode[], after: CanvasNode[]): Edit {
  const old = new Map(before.map(n => [n.id, n])), next = new Map(after.map(n => [n.id, n]))
  const changes: Edit = []
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id) ?? null, b = next.get(id) ?? null
    const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])] as (keyof CanvasNode)[]
    const changed = keys.filter(key => a?.[key] !== b?.[key])
    if (changed.length) changes.push({ id, before: a, after: b, keys: changed })
  }
  return changes
}
export function applyEdit(doc: StudioDocument, edit: Edit, direction: 'before' | 'after'): StudioDocument {
  const nodes = [...doc.nodes]
  for (const change of edit) {
    const target = change[direction], opposite = change[direction === 'before' ? 'after' : 'before']
    const index = nodes.findIndex(n => n.id === change.id)
    if (!target) { if (index >= 0) nodes.splice(index, 1); continue }
    if (!opposite) {
      if (index < 0) {
        const slot = doc.tasks.find(t => t.id === target.taskId)?.slots.find(s => s.id === target.slotId)
        nodes.push({ ...target, ...(slot ? { status: slot.status, url: slot.url ?? target.url } : {}) })
      }
    } else if (index >= 0) {
      const updated = { ...nodes[index] }
      for (const key of change.keys) Object.assign(updated, { [key]: target[key] })
      nodes[index] = updated
    }
  }
  return { ...doc, nodes }
}
