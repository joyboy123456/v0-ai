'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { bounds, initialDocument, POSES, resultUrl, SHOTS, taskStatus, uid } from '@/lib/creative-studio/model'
import type { CanvasNode, Draft, StudioDocument, StudioTask, Viewport } from '@/lib/creative-studio/model'
import { applyEdit, diffNodes } from '@/lib/creative-studio/history'
import type { Edit } from '@/lib/creative-studio/history'
import { getTool } from '@/lib/creative-studio/tools'
import { loadDocument, putAsset, saveDocument } from '@/lib/creative-studio/storage'
import { MockRunner } from '@/lib/creative-studio/mock'
import type { MockEvent } from '@/lib/creative-studio/mock'

export function useStudio() {
  const [doc, setDoc] = useState<StudioDocument>(initialDocument)
  const current = useRef(doc)
  const [selected, setSelected] = useState<string[]>(['hero'])
  const selection = useRef(selected)
  const [ready, setReady] = useState(false)
  const [restored, setRestored] = useState(false)
  const [saved, setSaved] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [notice, setNotice] = useState('')
  const [historyVersion, setHistoryVersion] = useState(0)
  const past = useRef<Edit[]>([]), future = useRef<Edit[]>([])
  const runner = useRef<MockRunner | null>(null)
  if (!runner.current) runner.current = new MockRunner()
  const mounted = useRef(true), saveAllowed = useRef(false), urls = useRef(new Set<string>())
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = useCallback((text: string) => {
    setNotice(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { if (mounted.current) setNotice('') }, 4300)
  }, [])
  const update = useCallback((fn: (value: StudioDocument) => StudioDocument) => {
    const next = fn(current.current)
    current.current = next
    if (mounted.current) setDoc(next)
  }, [])
  const select = useCallback((ids: string[]) => { selection.current = ids; setSelected(ids) }, [])
  useEffect(() => {
    mounted.current = true
    let active = true
    void loadDocument().then(result => {
      if (!active) { result.urls.forEach(URL.revokeObjectURL); return }
      result.urls.forEach(url => urls.current.add(url))
      if (result.document) { update(() => result.document!); select([]); setRestored(true) }
      saveAllowed.current = true; setReady(true); setSaved('saved')
    }).catch(() => {
      if (!active) return
      setReady(true); setSaved('error')
      notify('无法恢复本地存档。本次可继续工作；重置示例后可重新启用保存。')
    })
    return () => {
      active = false; mounted.current = false; runner.current?.dispose()
      if (toastTimer.current) clearTimeout(toastTimer.current)
      urls.current.forEach(URL.revokeObjectURL); urls.current.clear()
    }
  }, [notify, select, update])
  useEffect(() => {
    if (!ready || !saveAllowed.current) return
    setSaved('saving')
    const snapshot = doc
    const timer = setTimeout(() => {
      saveChain.current = saveChain.current.catch(() => {}).then(() => saveDocument(snapshot)).then(() => {
        if (mounted.current && current.current === snapshot) setSaved('saved')
      }).catch(() => { if (mounted.current) setSaved('error') })
    }, 500)
    return () => clearTimeout(timer)
  }, [doc, ready])
  const editNodes = useCallback((fn: (nodes: CanvasNode[]) => CanvasNode[]) => {
    const before = current.current.nodes, after = fn(before), edit = diffNodes(before, after)
    if (!edit.length) return
    past.current.push(edit); if (past.current.length > 60) past.current.shift()
    future.current = []; setHistoryVersion(v => v + 1)
    update(d => ({ ...d, nodes: after }))
  }, [update])
  const undo = useCallback(() => {
    const edit = past.current.pop(); if (!edit) return
    future.current.push(edit); update(d => applyEdit(d, edit, 'before')); setHistoryVersion(v => v + 1)
    select(selection.current.filter(id => current.current.nodes.some(n => n.id === id)))
  }, [select, update])
  const redo = useCallback(() => {
    const edit = future.current.pop(); if (!edit) return
    past.current.push(edit); update(d => applyEdit(d, edit, 'after')); setHistoryVersion(v => v + 1)
  }, [update])
  const patchDraft = useCallback((patch: Partial<Draft>) => update(d => ({ ...d, draft: { ...d.draft, ...patch } })), [update])
  const setViewport = useCallback((viewport: Viewport) => update(d => ({ ...d, viewport })), [update])
  const reference = useCallback((ids: string[], role = '参考') => {
    const eligible = current.current.nodes.filter(n => ids.includes(n.id) && n.kind === 'image' && n.status === 'ready' && n.url)
    if (!eligible.length) { notify('请先选择一张已完成的图片'); return }
    update(d => ({ ...d, references: [...d.references.filter(r => !eligible.some(n => n.id === r.nodeId)), ...eligible.map(n => ({ nodeId: n.id, role }))].slice(-12) }))
    notify(`已添加 ${eligible.length} 张${role}图片`)
  }, [notify, update])
  const activate = useCallback((tool: string, ids = selection.current) => {
    const images = current.current.nodes.filter(n => ids.includes(n.id) && n.kind === 'image' && n.status === 'ready' && n.url)
    update(d => ({ ...d, ...(images.length ? { references: [{ nodeId: images[0].id, role: '主图' }, ...d.references.filter(r => r.nodeId !== images[0].id && r.role !== '主图')] } : {}), draft: { ...d.draft, tool } }))
  }, [update])
  const remove = useCallback(() => {
    const ids = selection.current
    editNodes(nodes => nodes.filter(n => !ids.includes(n.id)))
    // Task snapshots deliberately remain independent of deletion on the canvas.
    update(d => ({ ...d, references: d.references.filter(r => !ids.includes(r.nodeId)) })); select([])
  }, [editNodes, select, update])
  const duplicate = useCallback(() => {
    const copies = current.current.nodes.filter(n => selection.current.includes(n.id) && n.status === 'ready').map(n => ({ ...n, id: uid('copy'), x: n.x + 28, y: n.y + 28, name: `${n.name} · 副本`, taskId: undefined, slotId: undefined }))
    if (!copies.length) return
    editNodes(nodes => [...nodes, ...copies]); select(copies.map(n => n.id))
  }, [editNodes, select])
  const group = useCallback(() => {
    const members = current.current.nodes.filter(n => selection.current.includes(n.id))
    if (members.length < 2) { notify('按住 Shift 选择至少两张图片，再创建分组'); return }
    const name = `素材分组 ${current.current.nodes.filter(n => n.group?.startsWith('素材分组')).length + 1}`
    editNodes(nodes => nodes.map(n => selection.current.includes(n.id) ? { ...n, group: name } : n))
    notify('已创建分组；拖动分组标题可一起移动')
  }, [editNodes, notify])
  const align = useCallback((mode: 'left' | 'top' | 'distribute') => {
    const members = current.current.nodes.filter(n => selection.current.includes(n.id)).sort((a,b) => a.x - b.x)
    if (members.length < 2) return
    const b = bounds(members), total = members.reduce((sum,n) => sum+n.width,0)
    const gap = Math.max(20,(b.width-total)/(members.length-1)); let x=b.x
    const positions = new Map(members.map(n => { const p = { x: mode==='left'?b.x:mode==='distribute'?x:n.x, y: mode==='top'?b.y:n.y }; x+=n.width+gap; return [n.id,p] }))
    editNodes(nodes => nodes.map(n => positions.has(n.id) ? { ...n, ...positions.get(n.id) } : n))
  }, [editNodes])
  const receive = useCallback((event: MockEvent) => {
    if (!mounted.current) return
    let completed = ''
    update(d => {
      const task = d.tasks.find(t => t.id === event.taskId)
      if (!task || task.attempt !== event.attempt || task.status === 'cancelled') return d
      const slots = task.slots.map(s => s.id === event.slotId ? { ...s, status: event.status, error: event.error } : s)
      const status = taskStatus(slots), terminal = status !== 'running' && status !== 'queued'
      if (terminal && (task.status === 'running' || task.status === 'queued')) completed = status === 'success' ? '结果已就绪；点击任务卡的「查看这组」定位。' : '部分结果已保留，可单独重试未完成的镜头。'
      const slot = slots.find(s => s.id === event.slotId)!
      return { ...d, tasks: d.tasks.map(t => t.id === task.id ? { ...t, slots, status, ...(terminal ? { finishedAt: Date.now() } : {}) } : t), nodes: d.nodes.map(n => n.id === slot.nodeId && n.taskId === task.id ? { ...n, status: slot.status, ...(slot.status === 'ready' ? { url: slot.url } : {}) } : n) }
    })
    if (completed) notify(completed)
  }, [notify, update])
  const submit = useCallback((partialDemo = false, mask?: string) => {
    const d = current.current, draft = d.draft, tool = getTool(draft.tool)
    const refs = d.references.flatMap(r => { const n = d.nodes.find(n => n.id === r.nodeId && n.url && n.status === 'ready'); return n ? [{ ...n, role: r.role }] : [] })
    if (!refs.length) { notify('先选一张图片，点击「用作参考」'); return false }
    if (d.tasks.filter(t => t.status === 'queued' || t.status === 'running').length >= 4) { notify('已有 4 个演示任务在执行，可以先继续编辑草稿'); return false }
    const count = draft.tool === 'pose' ? draft.poses.length : draft.tool === 'video' ? 4 : tool.batch ? draft.count : 1
    if (!count) { notify('请至少选择一个姿势'); return false }
    if (d.nodes.length + count > 200) { notify('本地原型上限为 200 个对象，请先导出并整理画布'); return false }
    const id = uid('mock'), source = refs.find(r => r.role === '主图') ?? refs[0]
    const [rw,rh] = draft.ratio.split(':').map(Number), w = 190, h = w*(rh||4)/(rw||3)
    const x = source.x + source.width + 95, groupWidth = count > 1 ? w*2+28 : w
    let y = source.y
    for (let tries=0; tries<d.nodes.length+1; tries++) {
      const bottom = y + Math.ceil(count/2)*(h+55)
      const collisions = d.nodes.filter(n => n.x < x+groupWidth+30 && n.x+n.width > x-30 && n.y < bottom+30 && n.y+n.height > y-50)
      if (!collisions.length) break
      y = Math.max(...collisions.map(n=>n.y+n.height))+115
    }
    const groupName = `${tool.name} · ${d.tasks.length+1}`
    const slots = Array.from({length: count},(_,i) => ({id:uid('slot'),nodeId:uid('image'),title:draft.tool==='pose'?(POSES.find(p=>p.id===draft.poses[i])?.name??`姿势 ${i+1}`):draft.tool==='video'?`分镜 ${i+1}`:draft.shots[i]||SHOTS[i]||`画面 ${i+1}`,status:'queued' as const,url:resultUrl(source,i)}))
    const task: StudioTask = {id,title:tool.name,createdAt:Date.now(),attempt:0,status:'queued',snapshot:structuredClone({...draft,references:refs,...(mask?{mask}:{})}),slots,partialDemo}
    const added: CanvasNode[] = slots.map((slot,i)=>({id:slot.nodeId,name:slot.title,kind:'image',x:x+(i%2)*(w+28),y:y+Math.floor(i/2)*(h+55),width:w,height:h,status:'queued',group:groupName,taskId:id,slotId:slot.id,sourceId:source.id,demo:true,...(source.assetId?{assetId:source.assetId}:{})}))
    update(value=>({...value,nodes:[...value.nodes,...added],tasks:[task,...value.tasks]}))
    runner.current!.start(task,receive)
    notify('已创建演示任务。可继续操作，或点击「查看这组」查看生成区域。')
    return true
  }, [notify, receive, update])
  const cancel = useCallback((id: string) => {
    runner.current!.cancel(id)
    update(d=>({...d,tasks:d.tasks.map(t=>t.id===id?{...t,attempt:t.attempt+1,status:t.slots.some(s=>s.status==='ready')?'partial':'cancelled',finishedAt:Date.now(),slots:t.slots.map(s=>s.status==='running'||s.status==='queued'?{...s,status:'cancelled'}:s)}:t),nodes:d.nodes.map(n=>n.taskId===id&&(n.status==='running'||n.status==='queued')?{...n,status:'cancelled'}:n)}))
    notify('演示任务已停止，已完成的图片仍然保留')
  }, [notify, update])
  const retry = useCallback((taskId: string, slotId?: string) => {
    const task = current.current.tasks.find(t=>t.id===taskId)
    if (!task) return
    if (task.status==='running'||task.status==='queued') {notify('其他镜头还在执行，结束后可单独重试');return}
    const ids=task.slots.filter(s=>(!slotId||s.id===slotId)&&s.status!=='ready'&&current.current.nodes.some(n=>n.id===s.nodeId)).map(s=>s.id)
    if (!ids.length) {notify('没有可重试的图片；已移除的结果不会重新出现');return}
    const next: StudioTask={...task,status:'running',attempt:task.attempt+1,finishedAt:undefined,slots:task.slots.map(s=>ids.includes(s.id)?{...s,status:'queued',error:undefined}:s)}
    update(d=>({...d,tasks:d.tasks.map(t=>t.id===task.id?next:t),nodes:d.nodes.map(n=>n.taskId===task.id&&ids.includes(n.slotId??'')?{...n,status:'queued'}:n)}))
    runner.current!.start(next,receive,ids)
  }, [notify, receive, update])
  const upload = useCallback(async (files: File[], point={x:230,y:170}) => {
    const added: CanvasNode[]=[]
    for (const file of files.slice(0,12)) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>20*1024*1024) {notify('支持 20MB 内的 JPG、PNG 和 WebP');continue}
      try {
        const bitmap=await createImageBitmap(file), ratio=bitmap.height/bitmap.width
        if (bitmap.width*bitmap.height>50_000_000) {bitmap.close();notify('图片像素过大，请缩小后上传');continue}
        bitmap.close()
        const id=uid('upload')
        try {await putAsset(id,file)} catch {saveAllowed.current=false;setSaved('error');notify('图片暂存于本次会话；本地存储不可用，请及时导出')}
        if (!mounted.current) return
        const url=URL.createObjectURL(file);urls.current.add(url)
        added.push({id,assetId:id,url,name:file.name.replace(/\.[^.]+$/,''),kind:'image',status:'ready',width:230,height:230*ratio,x:point.x+added.length*32,y:point.y+added.length*32})
      } catch {notify(`无法读取图片：${file.name}`)}
    }
    if (added.length) {editNodes(nodes=>[...nodes,...added]);select(added.map(n=>n.id))}
  },[editNodes,notify,select])
  const addText = useCallback((point={x:300,y:220})=>{
    const node: CanvasNode={id:uid('note'),kind:'text',name:'创作笔记',text:'双击编辑创作笔记',status:'ready',...point,width:230,height:100}
    editNodes(nodes=>[...nodes,node]);select([node.id])
  },[editNodes,select])
  const reset = useCallback(()=>{
    runner.current!.dispose();past.current=[];future.current=[];saveAllowed.current=true
    update(()=>initialDocument());select(['hero']);setRestored(false);setHistoryVersion(v=>v+1)
    notify('已恢复示范画布；原工作台与服务器数据没有改变')
  },[notify,select,update])
  return {doc,selected,select,ready,restored,saved,notice,notify,update,editNodes,patchDraft,setViewport,reference,activate,remove,duplicate,group,align,submit,cancel,retry,upload,addText,reset,undo,redo,canUndo:!!past.current.length,canRedo:!!future.current.length,historyVersion}
}
export type Studio = ReturnType<typeof useStudio>
