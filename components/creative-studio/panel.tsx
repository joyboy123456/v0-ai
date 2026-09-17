'use client'
import { useEffect, useState } from 'react'
import type { CanvasNode, StudioTask } from '@/lib/creative-studio/model'
import { POSES, SHOTS } from '@/lib/creative-studio/model'
import { getTool } from '@/lib/creative-studio/tools'
import type { Studio } from './use-studio'
import { Button, Icon, IconButton, Picture } from './ui'
import s from './studio.module.css'
const statusNames={queued:'等待开始',running:'正在生成',success:'已完成',partial:'部分完成',failed:'生成失败',cancelled:'已停止',interrupted:'已中断'}
export function TaskCard({task,studio,onView,compact=false}:{task:StudioTask;studio:Studio;onView:(ids:string[])=>void;compact?:boolean}){
  const [now,setNow]=useState(Date.now())
  const active=task.status==='running'||task.status==='queued',done=task.slots.filter(slot=>slot.status==='ready').length
  useEffect(()=>{if(!active)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id)},[active])
  return <article className={`${s.taskCard} ${compact?s.compactTask:''}`} data-testid="task-card">
    <div className={s.taskHeading}><span className={s.taskIcon}><Icon name={active?'sparkles':task.status==='success'?'checks':'clock'} size={17}/></span><div><strong>{task.title}</strong><span>演示任务 · {new Date(task.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span></div><span className={s.statusChip} data-active={active}>{statusNames[task.status]}</span></div>
    <div className={s.taskProgress}><span>{done}/{task.slots.length} 张已完成</span><span>{active?`已等待 ${Math.max(0,Math.floor((now-task.createdAt)/1000))} 秒`:'输入快照已保留'}</span></div>
    <div className={s.segmentProgress}>{task.slots.map(slot=><span key={slot.id} data-status={slot.status}/>)}</div>
    {!compact&&<><div className={s.taskThumbnails}>{task.slots.slice(0,6).map(slot=><div key={slot.id} data-status={slot.status}>{slot.status==='ready'?<Picture url={slot.url} name={slot.title}/>:<Icon name={slot.status==='failed'?'warning':'clock'} size={16}/>}</div>)}</div><details className={s.taskDetails}><summary>查看本次输入<Icon name="down" size={12}/></summary><p>{task.snapshot.prompt||'使用工具预设'}</p><span>{task.snapshot.references.map(r=>`${r.role} · ${r.name}`).join(' / ')}</span><small>{task.snapshot.ratio} · {task.snapshot.quality} · {task.snapshot.model}</small>{task.snapshot.mask&&<small>已冻结局部编辑选区</small>}</details></>}
    <div className={s.taskActions}><button type="button" onClick={()=>onView(task.slots.map(slot=>slot.nodeId))}>查看这组<Icon name="arrow" size={13}/></button>{active?<button type="button" onClick={()=>studio.cancel(task.id)}>停止</button>:done<task.slots.length&&<button type="button" onClick={()=>studio.retry(task.id)}>重试未完成</button>}</div>
  </article>
}
export function AssistantPanel({studio,tab,onTab,onClose,onView,onMask,partialDemo}:{studio:Studio;tab:'create'|'tasks';onTab:(value:'create'|'tasks')=>void;onClose:()=>void;onView:(ids:string[])=>void;onMask:(node:CanvasNode)=>void;partialDemo:boolean}){
  const {doc,patchDraft}=studio,draft=doc.draft,tool=getTool(draft.tool)
  const refs=doc.references.flatMap(r=>{const node=doc.nodes.find(n=>n.id===r.nodeId);return node?[{...r,node}]:[]})
  const active=doc.tasks.filter(t=>t.status==='running'||t.status==='queued')
  const count=draft.tool==='pose'?draft.poses.length:draft.tool==='video'?4:tool.batch?draft.count:1
  const isMask=draft.tool==='inpaint'||draft.tool==='erase'
  const setOption=(key:string,value:string)=>patchDraft({options:{...draft.options,[key]:value}})
  const run=()=>{if(isMask){const source=refs.find(r=>r.role==='主图')?.node??refs[0]?.node;if(source)onMask(source);else studio.notify('请先添加主图参考')}else studio.submit(partialDemo)}
  return <aside className={s.assistant} aria-label="Agent 创作面板">
    <header className={s.assistantHeader}><span className={s.agentMark}><Icon name="sparkles" size={21}/></span><div><strong>创作助手</strong><span>和你的想法，一起往前</span></div><span className={s.onlineDot}/><IconButton label="收起创作面板" icon="panelClose" onClick={onClose}/></header>
    <nav className={s.panelTabs} aria-label="创作面板标签"><button type="button" className={tab==='create'?s.tabActive:''} onClick={()=>onTab('create')}>创作</button><button type="button" className={tab==='tasks'?s.tabActive:''} onClick={()=>onTab('tasks')}>任务{doc.tasks.length>0&&<span>{doc.tasks.length}</span>}</button><span className={s.localPill}><i/>本地原型</span></nav>
    {tab==='tasks'?<div className={s.panelScroll}>
      <div className={s.sectionIntro}><span className={s.eyebrow}>创作记录</span><h2>每一次探索，都在这里。</h2><p>逐张交付，失败只重试需要的部分。</p></div>
      {doc.tasks.length?doc.tasks.map(task=><TaskCard key={task.id} task={task} studio={studio} onView={onView}/>):<div className={s.emptyTasks}><Icon name="clock" size={29}/><strong>还没有生成任务</strong><p>选一张主图，从第一组素材开始。</p><Button onClick={()=>onTab('create')}>开始创作<Icon name="right" size={14}/></Button></div>}
    </div>:<>
      <div className={s.panelScroll}>
        {active.length>0&&<button type="button" className={s.liveTask} onClick={()=>onTab('tasks')}><span className={s.pulseDot}/>{active.length} 个任务正在创作<span>查看进度<Icon name="next" size={13}/></span></button>}
        <div className={s.assistantCopy}><span className={s.eyebrow}>从这张图，继续创作</span><h2>{draft.tool==='fission'?'一张好主图，一组新可能。':tool.name}</h2><p>{draft.tool==='fission'?'主图已用于人物与服装参考。确认镜头后，就可以把它延展成一组商拍。':tool.description}</p></div>
        <section className={s.planCard} aria-label="创作方案">
          <div className={s.planHeading}><span className={s.planIcon}><Icon name={tool.icon} size={18}/></span><div><strong>{tool.name}{tool.batch?'方案':'设置'}</strong><span>{draft.tool==='video'?'静态分镜预览，不生成视频文件':'确认后执行 · Mock 演示'}</span></div><span className={s.planCount}>{count.toString().padStart(2,'0')}</span></div>
          {draft.tool==='pose'?<div className={s.poseGrid}>{POSES.map(pose=><button type="button" key={pose.id} className={`${s.poseOption} ${draft.poses.includes(pose.id)?s.poseSelected:''}`} aria-pressed={draft.poses.includes(pose.id)} onClick={()=>patchDraft({poses:draft.poses.includes(pose.id)?draft.poses.filter(id=>id!==pose.id):[...draft.poses,pose.id]})}><Picture url={pose.url} name={pose.name}/><span className={s.poseCheck}><Icon name={draft.poses.includes(pose.id)?'check':'plus'} size={12}/></span><strong>{pose.name}</strong></button>)}</div>:tool.batch||draft.tool==='video'?<div className={s.shotList}>{Array.from({length:count},(_,i)=><div className={s.shotRow} key={i}><span className={s.shotNumber}>{String(i+1).padStart(2,'0')}</span><div><input aria-label={`镜头 ${i+1} 名称`} maxLength={35} value={draft.shots[i]??SHOTS[i]} onChange={e=>{const shots=[...draft.shots];shots[i]=e.target.value;patchDraft({shots})}}/><span>{['清楚呈现版型与整体搭配','换一个角度，看见不同层次','补充商品的完整展示','拉近距离，关注细节'][i%4]}</span></div><Icon name="check" size={14}/></div>)}</div>:isMask?<div className={s.editPrompt}><Icon name="brush" size={29}/><strong>只改你选中的地方</strong><p>真实画笔选区，AI 处理使用演示结果。原图会一直保留。</p><Button icon="brush" onClick={run}>打开局部编辑器</Button></div>:<div className={s.toolPreview}>{refs[0]&&<Picture url={refs[0].node.url} name={refs[0].node.name}/>}<div><Icon name={tool.icon} size={24}/><strong>{tool.name}</strong><span>将在主图旁创建新版本</span><small>处理效果为演示，不会覆盖原图</small></div></div>}
          <div className={s.keepSettings}>{[['person','人物一致'],['garment','服装细节'],['background','保留背景']].map(([key,label])=><button type="button" key={key} aria-pressed={draft.options[key]!=='off'} onClick={()=>setOption(key,draft.options[key]==='off'?'on':'off')} className={draft.options[key]==='off'?s.keepOff:''}><Icon name={draft.options[key]==='off'?'circle':'checks'} size={13}/>{label}</button>)}</div>
        </section>
        {tool.fields.length>0&&<div className={s.toolFields}>{tool.fields.map(field=><label key={field.key}><span>{field.label}</span><select value={draft.options[field.key]??field.choices[0]} onChange={e=>setOption(field.key,e.target.value)}>{field.choices.map(choice=><option key={choice}>{choice}</option>)}</select></label>)}</div>}
        <div className={s.agentTip}><Icon name="sparkles" size={15}/><span>选中画布中的图片，就能接着换姿势、改背景或精修局部。</span></div>
      </div>
      <section className={s.composer} aria-label="创作输入">
        <div className={s.referenceHeader}><span>本次引用 <b>{refs.length}</b></span><button type="button" onClick={()=>studio.reference(studio.selected)}><Icon name="plus" size={13}/>添加所选</button></div>
        <div className={s.references} data-testid="references">{refs.length?refs.map(ref=><div className={s.referenceChip} key={ref.nodeId}><Picture url={ref.node.url} name={ref.node.name}/><div><select aria-label={`引用用途 ${ref.node.name}`} value={ref.role} onChange={e=>studio.update(d=>({...d,references:d.references.map(r=>r.nodeId===ref.nodeId?{...r,role:e.target.value}:r)}))}>{['主图','服装','模特','姿势','风格','参考'].map(role=><option key={role}>{role}</option>)}</select><span title={ref.node.name}>{ref.node.name}</span></div><button type="button" aria-label={`移除引用 ${ref.node.name}`} onClick={()=>studio.update(d=>({...d,references:d.references.filter(r=>r.nodeId!==ref.nodeId)}))}><Icon name="close" size={11}/></button></div>):<span className={s.noReferences}>选择图片后点击「用作参考」</span>}</div>
        <div className={s.promptBox}><textarea aria-label="描述创作需求" placeholder="描述想怎么拍，或想改哪里…" value={draft.prompt} maxLength={6000} onChange={e=>patchDraft({prompt:e.target.value})} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();run()}}}/><div className={s.composerMeta}><span><Icon name={tool.icon} size={12}/>{tool.name}</span><span>⌘ / Ctrl ↵</span></div></div>
        <div className={s.parameters}><select aria-label="画幅比例" value={draft.ratio} onChange={e=>patchDraft({ratio:e.target.value})}>{['3:4','1:1','4:3','9:16','16:9'].map(r=><option key={r}>{r}</option>)}</select><select aria-label="清晰度预设" value={draft.quality} onChange={e=>patchDraft({quality:e.target.value})}>{['2K','4K'].map(q=><option key={q}>{q}</option>)}</select>{tool.batch&&draft.tool!=='pose'&&<select aria-label="生成张数" value={draft.count} onChange={e=>patchDraft({count:Number(e.target.value)})}>{[2,4,6,9].map(n=><option key={n} value={n}>{n} 张</option>)}</select>}<select className={s.modelSelect} aria-label="模型预设（演示）" value={draft.model} onChange={e=>patchDraft({model:e.target.value})}>{['自动选择','GPT Image','Nano Banana','Seedream'].map(m=><option key={m}>{m}</option>)}</select></div>
        <Button primary className={s.generateButton} disabled={!refs.length||!studio.ready||!count} onClick={run} data-testid="generate"><Icon name={isMask?'brush':'sparkles'} size={16}/>{isMask?'涂抹局部并编辑':draft.tool==='video'?'预览 4 张静态分镜':`开始生成 · ${count} 张`}<Icon name="arrow" size={17}/></Button>
        <p className={s.demoFootnote}>AI 处理为演示 · 素材只保存在本机 · 不消耗额度</p>
      </section>
    </>}
  </aside>
}
