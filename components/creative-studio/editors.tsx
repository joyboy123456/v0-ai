'use client'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { CanvasNode } from '@/lib/creative-studio/model'
import { exportNodes } from '@/lib/creative-studio/export'
import { Button, Icon, IconButton, Modal, Picture } from './ui'
import s from './studio.module.css'

export function ExportDialog({nodes,title,onClose,onDone}:{nodes:CanvasNode[];title:string;onClose:()=>void;onDone:(message:string)=>void}){
  const [ids,setIds]=useState(nodes.map(n=>n.id)),[format,setFormat]=useState<'original'|'png'|'jpeg'>('original'),[prefix,setPrefix]=useState(title),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const chosen=nodes.filter(n=>ids.includes(n.id))
  const run=async()=>{setBusy(true);setError('');try{const count=await exportNodes(chosen,format,prefix);onDone(`已导出 ${count} 张图片${count>1?'，文件已打包为 ZIP':''}`);onClose()}catch(e){setError(e instanceof Error?e.message:'导出失败，请重试')}finally{setBusy(false)}}
  return <Modal open onClose={()=>{if(!busy)onClose()}} title="导出创作素材" description="下载选中的完整图片。多张图片将自动打包，原始素材不会改变。">
    <div className={s.exportGrid}>{nodes.map(node=><button type="button" key={node.id} aria-label={`导出选择 ${node.name}`} aria-pressed={ids.includes(node.id)} onClick={()=>setIds(ids.includes(node.id)?ids.filter(id=>id!==node.id):[...ids,node.id])} className={ids.includes(node.id)?s.exportSelected:''}><Picture url={node.url} name={node.name}/><span><Icon name={ids.includes(node.id)?'check':'plus'} size={13}/></span><strong>{node.name}</strong></button>)}</div>
    {!nodes.length&&<p className={s.emptyList}>先选择已完成的图片，或关闭此窗口后重新选择。</p>}
    <div className={s.exportFields}><label><span>文件格式</span><select value={format} onChange={e=>setFormat(e.target.value as typeof format)}><option value="original">原始格式 · 保留源文件</option><option value="png">PNG · 实际转换</option><option value="jpeg">JPG · 实际转换</option></select></label><label><span>文件名前缀</span><input value={prefix} maxLength={45} onChange={e=>setPrefix(e.target.value)}/></label></div>
    <p className={s.quietText}>导出的是原始图片，不是画布截图。2K / 4K 是任务演示参数，不代表示例图片的实际像素。</p>{error&&<p role="alert" className={s.inlineError}>{error}</p>}
    <footer className={s.modalFooter}><span>已选择 {chosen.length} 张</span><Button onClick={onClose} disabled={busy}>取消</Button><Button primary icon={busy?'loading':'download'} disabled={busy||!chosen.length} onClick={()=>void run()}>{busy?'正在准备文件…':chosen.length>1?'打包下载 ZIP':'下载图片'}</Button></footer>
  </Modal>
}

export function PreviewDialog({node,source,onClose,onDownload}:{node:CanvasNode;source?:CanvasNode;onClose:()=>void;onDownload:()=>void}){
  const [compare,setCompare]=useState(!!source)
  return <Modal open wide onClose={onClose} title={node.name} description={node.demo?'这是 Mock 演示结果；图像未经过真实 AI 处理。':'查看完整素材，保留图片原始比例。'}>
    <div className={`${s.previewImages} ${compare&&source?s.compareImages:''}`}>{compare&&source&&<figure><Picture url={source.url} name={source.name}/><figcaption>参考原图</figcaption></figure>}<figure><Picture url={node.url} name={node.name}/><figcaption>{node.demo?'新版本 · 演示':node.name}</figcaption></figure></div>
    <footer className={s.modalFooter}>{source&&<Button icon="layers" onClick={()=>setCompare(!compare)}>{compare?'仅看当前图片':'与原图对比'}</Button>}<span className={s.flexSpacer}/><Button icon="download" onClick={onDownload}>下载原图</Button></footer>
  </Modal>
}

export function MaskEditor({node,prompt,eraseMode=false,onPrompt,onClose,onRun}:{node:CanvasNode;prompt:string;eraseMode?:boolean;onPrompt:(value:string)=>void;onClose:()=>void;onRun:(mask:string)=>void}){
  const canvas=useRef<HTMLCanvasElement>(null),painting=useRef(false),last=useRef({x:0,y:0}),history=useRef<ImageData[]>([])
  const [brush,setBrush]=useState(42),[eraser,setEraser]=useState(false),[hasMask,setHasMask]=useState(false),[count,setCount]=useState(0),[dimensions,setDimensions]=useState({width:750,height:1000})
  useEffect(()=>{let active=true;const img=new Image();img.onload=()=>{if(active){const z=Math.min(1,1200/Math.max(img.naturalWidth,img.naturalHeight));setDimensions({width:Math.round(img.naturalWidth*z),height:Math.round(img.naturalHeight*z)})}};if(node.url)img.src=node.url;return()=>{active=false}},[node.url])
  const point=(event:PointerEvent<HTMLCanvasElement>)=>{const r=event.currentTarget.getBoundingClientRect();return{x:(event.clientX-r.left)*event.currentTarget.width/r.width,y:(event.clientY-r.top)*event.currentTarget.height/r.height}}
  const paint=(p:{x:number;y:number})=>{const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;ctx.globalCompositeOperation=eraser?'destination-out':'source-over';ctx.strokeStyle='rgba(72,122,244,.60)';ctx.fillStyle=ctx.strokeStyle;ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=brush;ctx.beginPath();ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.beginPath();ctx.arc(p.x,p.y,brush/2,0,Math.PI*2);ctx.fill();last.current=p;setHasMask(true)}
  const start=(event:PointerEvent<HTMLCanvasElement>)=>{const el=canvas.current,ctx=el?.getContext('2d');if(!ctx||!el)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);history.current.push(ctx.getImageData(0,0,el.width,el.height));if(history.current.length>15)history.current.shift();setCount(history.current.length);painting.current=true;last.current=point(event);paint(last.current)}
  const clear=()=>{const el=canvas.current;if(!el)return;el.getContext('2d')?.clearRect(0,0,el.width,el.height);history.current=[];setCount(0);setHasMask(false)}
  const undo=()=>{const ctx=canvas.current?.getContext('2d'),old=history.current.pop();if(ctx&&old){ctx.putImageData(old,0,0);setCount(history.current.length);setHasMask(old.data.some((v,i)=>i%4===3&&v>0))}}
  const run=()=>{const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;const image=ctx.getImageData(0,0,el.width,el.height);let any=false;for(let i=0;i<image.data.length;i+=4){const v=image.data[i+3]>0?255:0;any ||= v>0;image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255}if(!any){setHasMask(false);return}const out=document.createElement('canvas');out.width=el.width;out.height=el.height;out.getContext('2d')!.putImageData(image,0,0);onRun(out.toDataURL('image/png'))}
  return <Modal open wide onClose={onClose} title={eraseMode?'智能擦除 · 标记要移除的区域':'局部重绘 · 只改选中的地方'} description="画笔和选区真实可用，AI 处理为演示。提交时冻结这张原图与黑白选区，原图不会被覆盖。">
    <div className={s.maskLayout}><div className={s.maskStage}><div style={{aspectRatio:`${dimensions.width}/${dimensions.height}`}}><img src={node.url} alt={node.name} draggable={false}/><canvas ref={canvas} width={dimensions.width} height={dimensions.height} aria-label="局部编辑选区画布" onPointerDown={start} onPointerMove={e=>{if(painting.current)paint(point(e))}} onPointerUp={()=>painting.current=false} onPointerCancel={()=>painting.current=false}/></div></div><div className={s.maskControls}><span className={s.eyebrow}>选区工具</span><div className={s.brushButtons}><IconButton label="画笔" icon="brush" active={!eraser} onClick={()=>setEraser(false)}/><IconButton label="橡皮" icon="eraser" active={eraser} onClick={()=>setEraser(true)}/><IconButton label="撤销选区笔画" icon="undo" disabled={!count} onClick={undo}/><IconButton label="清除选区" icon="trash" onClick={clear}/></div><label className={s.rangeLabel}>笔刷大小 <b>{brush}px</b><input aria-label="笔刷大小" type="range" min={6} max={180} value={brush} onChange={e=>setBrush(Number(e.target.value))}/></label><label className={s.maskPrompt}>描述修改需求<textarea aria-label="局部修改需求" value={prompt} onChange={e=>onPrompt(e.target.value)} placeholder="例如：把选中的背景改为浅灰色，保持人物不变"/></label><p className={s.quietText}>蓝色区域是本次修改范围。编辑结果会作为一个新版本出现在主图附近。</p><Button primary icon="sparkles" disabled={!hasMask} onClick={run}>提交局部编辑演示</Button><Button onClick={onClose}>取消并返回白板</Button></div></div>
  </Modal>
}

export function NoteDialog({node,onClose,onSave}:{node:CanvasNode;onClose:()=>void;onSave:(text:string)=>void}){
  const [text,setText]=useState(node.text??'')
  return <Modal open onClose={onClose} title="创作笔记" description="记录拍摄要求、选片意见或下一步想法。"><textarea className={s.noteInput} autoFocus value={text} maxLength={1200} onChange={e=>setText(e.target.value)} aria-label="创作笔记内容"/><footer className={s.modalFooter}><span className={s.flexSpacer}/><Button onClick={onClose}>取消</Button><Button primary onClick={()=>onSave(text)}>保存笔记</Button></footer></Modal>
}
