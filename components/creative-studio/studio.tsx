'use client'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { CanvasNode } from '@/lib/creative-studio/model'
import { uid } from '@/lib/creative-studio/model'
import { exportNodes } from '@/lib/creative-studio/export'
import { useStudio } from './use-studio'
import { Canvas, type CanvasHandle } from './canvas'
import { AssistantPanel } from './panel'
import { StudioDrawer } from './drawers'
import { ExportDialog, MaskEditor, NoteDialog, PreviewDialog } from './editors'
import { ActionMenu, Button, Icon, IconButton, Modal, TooltipProvider } from './ui'
import s from './studio.module.css'

export default function CreativeStudio(){
  const studio=useStudio(),{doc}=studio,canvas=useRef<CanvasHandle>(null),fileInput=useRef<HTMLInputElement>(null)
  const {resolvedTheme,setTheme}=useTheme(),reduce=useReducedMotion()
  const [mode,setMode]=useState<'select'|'hand'>('select'),[panel,setPanel]=useState(true),[tab,setTab]=useState<'create'|'tasks'>('create')
  const [drawer,setDrawer]=useState<'tools'|'assets'|'layers'|null>(null),[preview,setPreview]=useState<CanvasNode|null>(null),[mask,setMask]=useState<CanvasNode|null>(null),[note,setNote]=useState<CanvasNode|null>(null)
  const [exportIds,setExportIds]=useState<string[]|null>(null),[help,setHelp]=useState(false),[resetOpen,setResetOpen]=useState(false),[partialDemo,setPartialDemo]=useState(false)
  useEffect(()=>{const stop=(e:DragEvent)=>{if(Array.from(e.dataTransfer?.types??[]).includes('Files'))e.preventDefault()};window.addEventListener('dragover',stop);window.addEventListener('drop',stop);return()=>{window.removeEventListener('dragover',stop);window.removeEventListener('drop',stop)}},[])
  const showDrawer=(kind:'tools'|'assets'|'layers')=>{setDrawer(drawer===kind?null:kind);if(window.innerWidth<1280)setPanel(false)}
  const showPanel=()=>{setPanel(true);if(window.innerWidth<1280)setDrawer(null)}
  const focus=(ids?:string[])=>{canvas.current?.fit(ids)}
  const openMask=(node:CanvasNode)=>{studio.activate(studio.doc.draft.tool==='erase'?'erase':'inpaint',[node.id]);setMask({...node});setDrawer(null)}
  const tool=(id:string)=>{
    if(id==='upload'){fileInput.current?.click();return}
    if(id==='tasks'){setTab('tasks');showPanel();return}
    studio.activate(id);setTab('create');showPanel();setDrawer(null)
    if(id==='inpaint'||id==='erase'){
      const node=doc.nodes.find(n=>studio.selected.includes(n.id)&&n.kind==='image'&&n.status==='ready')??doc.nodes.find(n=>doc.references.some(r=>r.nodeId===n.id)&&n.status==='ready')
      if(node){studio.activate(id,[node.id]);setMask({...node})}else studio.notify('先选一张图片，再涂抹需要修改的区域')
    }
  }
  const addAsset=(source:CanvasNode,asReference:boolean)=>{
    const existing=doc.nodes.find(n=>n.id===source.id)
    if(asReference&&existing){studio.reference([existing.id],source.url?.includes('/pose-')?'姿势':'参考');return}
    const p=canvas.current?.center()??{x:300,y:200}
    const node:CanvasNode={...source,id:uid('asset'),x:p.x-110,y:p.y-140,width:220,height:220*(source.height/source.width),taskId:undefined,slotId:undefined,group:undefined,status:'ready'}
    studio.editNodes(nodes=>[...nodes,node]);studio.select([node.id]);if(asReference)studio.reference([node.id],source.url?.includes('/pose-')?'姿势':'参考')
    studio.notify(asReference?'素材已加入画布并用于本次参考':'已放入画布，可拖动整理')
  }
  const openExport=()=>setExportIds((studio.selected.length?doc.nodes.filter(n=>studio.selected.includes(n.id)):doc.nodes).filter(n=>n.kind==='image'&&n.status==='ready').map(n=>n.id))
  const downloadOne=async(node:CanvasNode)=>{try{await exportNodes([node],'original',doc.title);studio.notify('图片已下载')}catch(e){studio.notify(e instanceof Error?e.message:'下载失败')}}
  const active=doc.tasks.filter(t=>t.status==='queued'||t.status==='running'),latest=doc.tasks[0]
  const savedLabels={loading:'恢复本地画布…',saving:'正在保存…',saved:'已保存到本机',error:'本地保存不可用'}
  return <TooltipProvider><main className={`${s.scope} ${s.studio}`} data-testid="creative-studio">
    <header className={s.projectHeader}>
      <a className={s.wordmark} href="/" aria-label="返回原工作台">v0<span>AI</span></a><span className={s.headerDivider}/>
      <div className={s.projectInfo}><div className={s.projectTitle}><Icon name="frame" size={15}/><input aria-label="项目名称" maxLength={70} value={doc.title} onChange={e=>studio.update(d=>({...d,title:e.target.value}))}/><Icon name="down" size={12}/></div><span className={s.saveStatus} data-error={studio.saved==='error'}><Icon name={studio.saved==='saved'?'checks':studio.saved==='error'?'warning':'clock'} size={12}/>{savedLabels[studio.saved]}</span></div>
      <span className={s.headerMode}>创作白板<span>预览版</span></span>
      <div className={s.headerActions}><IconButton label="撤销 · ⌘ / Ctrl Z" icon="undo" disabled={!studio.canUndo} onClick={studio.undo}/><IconButton label="重做 · ⌘ / Ctrl Shift Z" icon="redo" disabled={!studio.canRedo} onClick={studio.redo}/><span className={s.headerDivider}/><ActionMenu label="白板设置" items={[{label:partialDemo?'演示场景：部分失败':'演示场景：全部成功',icon:'controls',action:()=>{setPartialDemo(!partialDemo);studio.notify(partialDemo?'下一次演示将全部成功':'下一次演示将有一张失败，可验证单张重试')}},{label:resolvedTheme==='dark'?'切换为浅色':'切换为深色',icon:resolvedTheme==='dark'?'sun':'moon',action:()=>setTheme(resolvedTheme==='dark'?'light':'dark')},{label:'快捷键与原型说明',icon:'help',action:()=>setHelp(true)},{label:'恢复示范画布',icon:'rotate',action:()=>setResetOpen(true)}]}/><Button icon="download" onClick={openExport} className={s.headerExport}>导出</Button><IconButton label={panel?'收起创作面板':'展开创作面板'} icon={panel?'panelClose':'panelOpen'} onClick={()=>panel?setPanel(false):showPanel()}/><span className={s.avatar} aria-label="本机工作空间">我</span></div>
    </header>
    <div className={s.workspace}>
      <Canvas ref={canvas} studio={studio} mode={mode} onTool={tool} onExport={openExport} onPreview={setPreview} onNote={setNote}>
        <div className={s.canvasBreadcrumb} data-ui><span>项目空间</span><Icon name="next" size={11}/><strong>画布 01</strong><span className={s.demoBadge}>演示</span></div>
        <nav className={s.toolRail} data-ui aria-label="画布基础工具"><IconButton label="选择 · 单击 / 框选" icon="select" active={mode==='select'} onClick={()=>setMode('select')}/><IconButton label="平移 · 按住空格" icon="hand" active={mode==='hand'} onClick={()=>setMode('hand')}/><span className={s.railSeparator}/><IconButton label="上传图片" icon="upload" onClick={()=>fileInput.current?.click()}/><IconButton label="素材库" icon="images" active={drawer==='assets'} onClick={()=>showDrawer('assets')}/><IconButton label="添加创作笔记" icon="text" onClick={()=>studio.addText(canvas.current?.center())}/><IconButton label="将所选创建分组" icon="group" onClick={studio.group}/><span className={s.railSeparator}/><IconButton label="AI 工具箱" icon="sparkles" active={drawer==='tools'} className={s.aiTool} onClick={()=>showDrawer('tools')}/></nav>
        <div className={s.layersButton} data-ui><IconButton label="画布图层" icon="layers" active={drawer==='layers'} onClick={()=>showDrawer('layers')}/></div>
        {drawer&&<StudioDrawer key={drawer} kind={drawer} studio={studio} onClose={()=>setDrawer(null)} onTool={tool} onAsset={addAsset} onUpload={()=>fileInput.current?.click()} onFocus={focus}/>}
        <button type="button" className={s.taskDock} data-ui onClick={()=>{setTab('tasks');showPanel()}}><span className={active.length?s.pulseDot:s.dockDot}/><span>{active.length?`${active.length} 个任务生成中`:latest?'创作记录':'准备好下一组灵感'}</span><Icon name={active.length?'next':'sparkles'} size={14}/></button>
        {!studio.ready&&<div className={s.loadingCorner} role="status"><Icon name="loading" size={14}/>正在恢复本地空间</div>}
      </Canvas>
      {panel&&<AssistantPanel studio={studio} tab={tab} onTab={setTab} onClose={()=>setPanel(false)} onView={focus} onMask={openMask} partialDemo={partialDemo}/>}
    </div>
    <input type="file" ref={fileInput} accept="image/jpeg,image/png,image/webp" multiple className={s.hiddenInput} aria-label="上传素材文件" onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)void studio.upload(files,canvas.current?.center())}}/>
    <AnimatePresence>{studio.notice&&<motion.div className={s.toast} role="status" key={studio.notice} initial={{opacity:0,y:reduce?0:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reduce?0:.15}}><Icon name="checks" size={16}/><span>{studio.notice}</span>{latest&&studio.notice.includes('已就绪')&&<button type="button" onClick={()=>focus(latest.slots.map(slot=>slot.nodeId))}>查看结果</button>}</motion.div>}</AnimatePresence>
    {exportIds&&<ExportDialog nodes={doc.nodes.filter(n=>exportIds.includes(n.id)&&n.kind==='image'&&n.status==='ready')} title={doc.title} onClose={()=>setExportIds(null)} onDone={studio.notify}/>}
    {preview&&<PreviewDialog node={preview} source={doc.nodes.find(n=>n.id===preview.sourceId)} onClose={()=>setPreview(null)} onDownload={()=>void downloadOne(preview)}/>}
    {mask&&<MaskEditor node={mask} prompt={doc.draft.prompt} eraseMode={doc.draft.tool==='erase'} onPrompt={value=>studio.patchDraft({prompt:value})} onClose={()=>setMask(null)} onRun={data=>{studio.activate(doc.draft.tool==='erase'?'erase':'inpaint',[mask.id]);studio.submit(partialDemo,data);setMask(null);showPanel()}}/>}
    {note&&<NoteDialog node={note} onClose={()=>setNote(null)} onSave={text=>{studio.editNodes(nodes=>nodes.map(n=>n.id===note.id?{...n,text}:n));setNote(null)}}/>}
    <Modal open={resetOpen} onClose={()=>setResetOpen(false)} title="恢复示范画布？" description="会替换当前浏览器保存的这份白板，并停止演示任务。不影响原工作台和服务器上的任何数据。"><p className={s.quietText}>先导出需要保留的图片。此操作会清空这份原型的编辑记录。</p><footer className={s.modalFooter}><span className={s.flexSpacer}/><Button onClick={()=>setResetOpen(false)}>保留当前画布</Button><Button primary onClick={()=>{studio.reset();setResetOpen(false);setDrawer(null);setTimeout(()=>canvas.current?.fit(),50)}}>恢复示例</Button></footer></Modal>
    <Modal open={help} onClose={()=>setHelp(false)} title="让创作，少一点打断" description="这是独立的前端交互原型；不会调用真实模型、付费接口或生产任务。"><div className={s.shortcutList}>{[['多选图片','Shift + 单击'],['临时平移','按住空格'],['缩放画布','Ctrl / ⌘ + 滚轮'],['适配全部','Shift + 1'],['复制所选','Ctrl / ⌘ + D'],['撤销 / 重做','Ctrl / ⌘ + Z / Shift Z'],['查看完整图片','双击图片'],['准备下一条任务','生成期间仍可输入']].map(([a,b])=><div key={a}><span>{a}</span><kbd>{b}</kbd></div>)}</div><p className={s.quietText}>上传、选区、排布、本地保存、原图下载和格式转换是真实操作。AI 生图、换装、修图与分镜使用案例图演示；不会真的修改服装或人物。当前不支持多人协作或跨设备同步。</p><Button onClick={()=>setHelp(false)} className={s.fullButton}>开始创作<Icon name="arrow" size={15}/></Button></Modal>
  </main></TooltipProvider>
}
