'use client'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { bounds, fitViewport, worldPoint, zoomAround } from '@/lib/creative-studio/model'
import type { CanvasNode, Point, Viewport } from '@/lib/creative-studio/model'
import type { Studio } from './use-studio'
import { ActionMenu, Button, Icon, Picture } from './ui'
import s from './studio.module.css'
export type CanvasHandle = { fit: (ids?:string[])=>void; center:()=>Point }
type Gesture={type:'move'|'pan'|'box'|'resize';start:Point;view:Viewport;ids:string[];original:CanvasNode[];delta:Point;shift:boolean}
type Props={studio:Studio;mode:'select'|'hand';onTool:(id:string)=>void;onExport:()=>void;onPreview:(node:CanvasNode)=>void;onNote:(node:CanvasNode)=>void;children?:React.ReactNode}
export const Canvas = forwardRef<CanvasHandle,Props>(function Canvas({studio,mode,onTool,onExport,onPreview,onNote,children},ref){
  const {doc,selected,select,setViewport}=studio
  const host=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null),fitted=useRef(false),space=useRef(false)
  const [size,setSize]=useState({width:1000,height:800}),[preview,setPreview]=useState<Gesture|null>(null)
  const [temporaryHand,setTemporaryHand]=useState(false)
  const [toolbarWidth,setToolbarWidth]=useState(505),toolbar=useRef<HTMLDivElement>(null)
  const reduce=useReducedMotion()
  const fit=useCallback((ids?:string[])=>{
    const visible=ids?doc.nodes.filter(n=>ids.includes(n.id)):doc.nodes
    if(visible.length)setViewport(fitViewport(visible,size.width,size.height))
  },[doc.nodes,setViewport,size])
  useImperativeHandle(ref,()=>({fit,center:()=>worldPoint({x:size.width/2,y:size.height/2},doc.viewport)}),[fit,doc.viewport,size])
  useLayoutEffect(()=>{
    const node=host.current;if(!node)return
    const observer=new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect;setSize({width,height})})
    observer.observe(node);return()=>observer.disconnect()
  },[])
  useEffect(()=>{
    if(studio.ready&&!fitted.current&&size.width>100){fitted.current=true;if(!studio.restored)fit()}
  },[studio.ready,studio.restored,size.width,fit])
  useLayoutEffect(()=>{
    if(!toolbar.current)return
    const observer=new ResizeObserver(entries=>setToolbarWidth(entries[0].borderBoxSize?.[0]?.inlineSize??entries[0].contentRect.width))
    observer.observe(toolbar.current);return()=>observer.disconnect()
  },[selected.join(',')])
  useEffect(()=>{
    const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
    const keydown=(e:KeyboardEvent)=>{
      if(editable(e.target)||document.querySelector('[role="dialog"][data-state="open"]'))return
      if(e.code==='Space'){e.preventDefault();space.current=true;setTemporaryHand(true)}
      const mod=e.ctrlKey||e.metaKey
      if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?studio.redo():studio.undo()}
      else if(mod&&e.key.toLowerCase()==='d'){e.preventDefault();studio.duplicate()}
      else if(mod&&e.key.toLowerCase()==='a'){e.preventDefault();select(doc.nodes.map(n=>n.id))}
      else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();studio.remove()}
      else if(e.key==='Escape'){select([]);gesture.current=null;setPreview(null)}
      else if(e.shiftKey&&e.key==='1'){e.preventDefault();fit()}
    }
    const release=()=>{space.current=false;setTemporaryHand(false)}
    const keyup=(e:KeyboardEvent)=>{if(e.code==='Space')release()}
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',release)
    return()=>{window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',release)}
  },[studio,doc.nodes,fit,select])
  useEffect(()=>{
    const el=host.current;if(!el)return
    const wheel=(e:WheelEvent)=>{
      if((e.target as HTMLElement).closest('[data-ui],[role="menu"],[role="dialog"]'))return
      e.preventDefault()
      const rect=el.getBoundingClientRect(),p={x:e.clientX-rect.left,y:e.clientY-rect.top}
      if(e.ctrlKey||e.metaKey)setViewport(zoomAround(doc.viewport,p,doc.viewport.zoom*Math.exp(-e.deltaY*.006)))
      else setViewport({...doc.viewport,x:doc.viewport.x-(e.shiftKey?e.deltaY:e.deltaX),y:doc.viewport.y-(e.shiftKey?0:e.deltaY)})
    }
    el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)
  },[doc.viewport,setViewport])
  const screen=(e:{clientX:number;clientY:number})=>{const b=host.current!.getBoundingClientRect();return{x:e.clientX-b.left,y:e.clientY-b.top}}
  const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
    if(e.button!==0&&e.button!==1)return
    if((e.target as HTMLElement).closest('[data-ui],[role="menu"],[role="dialog"]'))return
    const target=e.target as HTMLElement,p=screen(e),nodeId=target.closest<HTMLElement>('[data-node]')?.dataset.node,group=target.closest<HTMLElement>('[data-group]')?.dataset.group
    const pan=mode==='hand'||space.current||e.button===1
    let ids=[...selected],type:Gesture['type']='box'
    if(pan)type='pan'
    else if(group){ids=doc.nodes.filter(n=>n.group===group).map(n=>n.id);select(ids);type='move'}
    else if(nodeId){
      if(e.shiftKey){ids=selected.includes(nodeId)?selected.filter(id=>id!==nodeId):[...selected,nodeId];select(ids)}
      else if(!selected.includes(nodeId)){ids=[nodeId];select(ids)}
      type=target.closest('[data-resize]')?'resize':'move'
    } else if(!e.shiftKey){ids=[];select([])}
    gesture.current={type,start:p,view:doc.viewport,ids,original:doc.nodes.filter(n=>ids.includes(n.id)),delta:{x:0,y:0},shift:e.shiftKey}
    // Keep click/double-click targeted at the image instead of the canvas host.
    const captureTarget = target.closest<HTMLElement>('[data-node]') ?? e.currentTarget
    captureTarget.setPointerCapture(e.pointerId)
    if(pan)e.preventDefault()
  }
  const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;if(!g)return
    const p=screen(e),delta={x:p.x-g.start.x,y:p.y-g.start.y};g.delta=delta
    if(g.type==='pan'){setViewport({...g.view,x:g.view.x+delta.x,y:g.view.y+delta.y});return}
    setPreview({...g,delta})
    if(g.type==='box'){
      const a=worldPoint(g.start,g.view),b=worldPoint(p,g.view),left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),right=Math.max(a.x,b.x),bottom=Math.max(a.y,b.y)
      const hits=doc.nodes.filter(n=>n.x<right&&n.x+n.width>left&&n.y<bottom&&n.y+n.height>top).map(n=>n.id)
      select(g.shift?[...new Set([...g.ids,...hits])]:hits)
    }
  }
  const finish=(e:ReactPointerEvent<HTMLDivElement>)=>{
    const g=gesture.current;gesture.current=null;setPreview(null)
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)
    if(!g||Math.hypot(g.delta.x,g.delta.y)<3)return
    const dx=g.delta.x/g.view.zoom,dy=g.delta.y/g.view.zoom
    if(g.type==='move')studio.editNodes(nodes=>nodes.map(n=>{const original=g.original.find(o=>o.id===n.id);return original?{...n,x:original.x+dx,y:original.y+dy}:n}))
    if(g.type==='resize')studio.editNodes(nodes=>nodes.map(n=>{const original=g.original.find(o=>o.id===n.id);if(!original)return n;const width=Math.max(65,original.width+dx);return{...n,width,height:width*original.height/original.width}}))
  }
  const displayed=useMemo(()=>doc.nodes.map(n=>{
    const original=preview?.original.find(o=>o.id===n.id)
    if(!original||!preview)return n
    if(preview.type==='move')return{...n,x:original.x+preview.delta.x/preview.view.zoom,y:original.y+preview.delta.y/preview.view.zoom}
    if(preview.type==='resize'){const width=Math.max(65,original.width+preview.delta.x/preview.view.zoom);return{...n,width,height:width*original.height/original.width}}
    return n
  }),[doc.nodes,preview])
  const groupNames=[...new Set(displayed.map(n=>n.group).filter(Boolean))] as string[]
  const chosen=displayed.filter(n=>selected.includes(n.id)),box=bounds(chosen),v=doc.viewport
  const toolbarX=Math.max(82,Math.min(size.width-toolbarWidth-16,(box.x+box.width/2)*v.zoom+v.x-toolbarWidth/2))
  const top=box.y*v.zoom+v.y-62
  const toolbarY=top>=58?top:Math.max(64,Math.min(size.height-110,(box.y+box.height)*v.zoom+v.y+30))
  const onscreen=chosen.length&&box.x*v.zoom+v.x<size.width&&(box.x+box.width)*v.zoom+v.x>0&&box.y*v.zoom+v.y<size.height&&(box.y+box.height)*v.zoom+v.y>0
  const readyImages=chosen.filter(n=>n.kind==='image'&&n.status==='ready'),pending=chosen.length===1&&chosen[0].status!=='ready'
  return <div ref={host} className={s.canvas} data-testid="studio-canvas" data-hand={mode==='hand'||temporaryHand} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{gesture.current=null;setPreview(null)}} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()}} onDrop={e=>{e.preventDefault();void studio.upload(Array.from(e.dataTransfer.files),worldPoint(screen(e),v))}} style={{backgroundSize:`${24*v.zoom}px ${24*v.zoom}px`,backgroundPosition:`${v.x}px ${v.y}px`}}>
    <div className={s.canvasTop} data-ui><span><Icon name="layers" size={15}/> 主创画布 <Icon name="down" size={12}/></span><span className={s.subtle}>{doc.nodes.filter(n=>n.kind==='image').length} 张素材<span className={s.canvasSeparator}>/</span>自由创作空间</span></div>
    <div className={s.world} style={{transform:`translate(${v.x}px,${v.y}px) scale(${v.zoom})`}}>
      {groupNames.map(name=>{const members=displayed.filter(n=>n.group===name),b=bounds(members);return <div key={name} className={s.canvasGroup} style={{left:b.x-15,top:b.y-15,width:b.width+30,height:b.height+48}}><button type="button" className={s.groupLabel} data-group={name} aria-label={`选择分组 ${name}`}><span className={s.groupDot}/>{name}<span>{members.length.toString().padStart(2,'0')}</span></button></div>})}
      {displayed.map(node=><div key={node.id} role="button" tabIndex={0} data-node={node.id} data-status={node.status} aria-label={node.name} aria-pressed={selected.includes(node.id)} className={`${s.node} ${selected.includes(node.id)?s.nodeSelected:''} ${node.kind==='text'?s.textNode:''}`} style={{left:node.x,top:node.y,width:node.width,height:node.height,zIndex:node.z??1}} onKeyDown={e=>{if(e.key==='Enter'){e.stopPropagation();select([node.id])}}} onDoubleClick={()=>node.kind==='text'?onNote(node):node.status==='ready'&&onPreview(node)}>
        {node.kind==='text'?<div className={s.noteBody}><Icon name="edit" size={19}/><p>{node.text}</p></div>:node.status==='ready'?<Picture url={node.url} name={node.name}/>:<div className={s.placeholder} data-state={node.status}><span className={s.placeholderIcon}><Icon name={node.status==='running'?'sparkles':node.status==='queued'?'clock':'warning'} size={24}/></span><strong>{({queued:'等待开始',running:'正在生成',failed:'这张未完成',cancelled:'已停止',interrupted:'任务已中断',ready:'已完成'})[node.status]}</strong><small>{node.status==='running'?'演示任务 · 可以继续创作':node.status==='queued'?'将保留这个位置':'成功图片仍然保留'}</small>{['failed','cancelled','interrupted'].includes(node.status)&&<button type="button" data-ui className={s.retryButton} onClick={e=>{e.stopPropagation();studio.retry(node.taskId!,node.slotId)}}><Icon name="rotate" size={14}/>重试这张</button>}</div>}
        {node.demo&&node.status==='ready'&&<span className={s.demoBadge}>演示</span>}
        <div className={s.nodeLabel}><span>{node.name}</span><span>{node.favorite&&<Icon name="bookmark" size={12}/>}</span></div>
        {selected.includes(node.id)&&<><i className={s.handleTL}/><i className={s.handleTR}/><i className={s.handleBL}/><span data-resize className={s.handleBR} role="button" aria-label={`调整尺寸 ${node.name}`}/></>}
      </div>)}
    </div>
    {preview?.type==='box'&&<div className={s.selectionBox} style={{left:Math.min(preview.start.x,preview.start.x+preview.delta.x),top:Math.min(preview.start.y,preview.start.y+preview.delta.y),width:Math.abs(preview.delta.x),height:Math.abs(preview.delta.y)}}/>}
    {!!onscreen&&preview?.type!=='box'&&<motion.div ref={toolbar} data-ui role="toolbar" aria-label="图片快捷操作" className={s.selectionToolbar} style={{left:toolbarX,top:toolbarY,maxWidth:size.width-100}} initial={reduce?false:{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{duration:.14}}>
      {pending?<><span className={s.toolbarStatus}><Icon name="clock" size={15}/>镜头任务</span><Button icon="eye" onClick={()=>onTool('tasks')}>任务详情</Button></>:chosen[0]?.kind==='text'&&chosen.length===1?<Button icon="edit" onClick={()=>onNote(chosen[0])}>编辑文字</Button>:chosen.length>1?<><Button icon="image" onClick={()=>studio.reference(selected)}>引用所选</Button><Button icon="align" onClick={()=>studio.align('top')}>顶端对齐</Button><Button icon="group" onClick={studio.group}>分组</Button><Button icon="download" onClick={onExport}>批量导出</Button></>:<><Button icon="image" onClick={()=>studio.reference(selected,'主图')}>用作参考</Button><span className={s.toolbarDivider}/><Button icon="grid" className={s.toolbarPrimary} onClick={()=>onTool('fission')}>生成套图</Button><Button icon="person" onClick={()=>onTool('pose')}>换姿势</Button><ActionMenu items={[['局部重绘','brush','inpaint'],['智能擦除','eraser','erase'],['智能扩图','expand','expand'],['移除背景','scissors','cutout'],['高清增强','zoom','upscale']].map(([label,icon,id])=>({label,icon,action:()=>onTool(id)}))}><button type="button" className={s.toolbarButton}><Icon name="magic" size={16}/>编辑<Icon name="down" size={12}/></button></ActionMenu><button type="button" className={s.toolbarButton} aria-label="下载所选图片" onClick={onExport}><Icon name="download" size={17}/></button></>}
      <ActionMenu items={[{label:'预览图片',icon:'eye',disabled:readyImages.length!==1,action:()=>onPreview(readyImages[0])},{label:'复制 ⌘/Ctrl D',icon:'copy',action:studio.duplicate},{label:'等距排列',icon:'align',disabled:chosen.length<2,action:()=>studio.align('distribute')},{label:'取消分组',icon:'group',action:()=>studio.editNodes(ns=>ns.map(n=>selected.includes(n.id)?{...n,group:undefined}:n))},{label:'收藏 / 取消收藏',icon:'bookmark',action:()=>studio.editNodes(ns=>ns.map(n=>selected.includes(n.id)?{...n,favorite:!n.favorite}:n))},{label:'移到顶层',icon:'layers',action:()=>studio.editNodes(ns=>{const z=Math.max(1,...ns.map(n=>n.z??1))+1;return ns.map(n=>selected.includes(n.id)?{...n,z}:n)})},{label:'从画布移除',icon:'trash',danger:true,action:studio.remove}]}/>
    </motion.div>}
    {!doc.nodes.length&&<div className={s.emptyCanvas} data-ui><span className={s.emptyLogo}><Icon name="image" size={32}/></span><h2>从一张图，开始新的创作</h2><p>拖入服装或模特图片，再让创作助手接着做。</p><Button primary icon="upload" onClick={()=>onTool('upload')}>导入素材</Button></div>}
    <div className={s.zoomControls} data-ui><button type="button" aria-label="缩小画布" onClick={()=>setViewport(zoomAround(v,{x:size.width/2,y:size.height/2},v.zoom/1.2))}><Icon name="minus" size={15}/></button><button type="button" className={s.zoomValue} aria-label="重置为百分之百" onClick={()=>setViewport(zoomAround(v,{x:size.width/2,y:size.height/2},1))}>{Math.round(v.zoom*100)}%</button><button type="button" aria-label="放大画布" onClick={()=>setViewport(zoomAround(v,{x:size.width/2,y:size.height/2},v.zoom*1.2))}><Icon name="plus" size={15}/></button><span/><button type="button" aria-label="适配全部图片" onClick={()=>fit()}><Icon name="focus" size={17}/></button></div>
    <span className={s.canvasHint} data-ui>空格拖动平移<span>·</span>⌘ / Ctrl + 滚轮缩放</span>
    {children}
  </div>
})
