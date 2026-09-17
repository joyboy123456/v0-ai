/** Run with node scripts/test-creative-studio.mjs. Uses the existing TypeScript dependency. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const root=process.cwd(),tmp=await fs.mkdtemp(path.join(os.tmpdir(),'creative-studio-tests-'))
let passed=0
const check=(name,fn)=>{fn();passed++;console.log(`PASS ${name}`)}
try{
 for(const name of ['model','history','storage','mock','export']){
  const source=await fs.readFile(path.join(root,'lib/creative-studio',`${name}.ts`),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'")
  await fs.writeFile(path.join(tmp,`${name}.mjs`),output)
 }
 const mod=async(name)=>import(pathToFileURL(path.join(tmp,`${name}.mjs`)).href)
 const m=await mod('model'),h=await mod('history'),storage=await mod('storage'),{MockRunner}=await mod('mock'),{zipStored}=await mod('export')
 check('zoom preserves point under cursor',()=>{const v={x:42,y:-17,zoom:.7},p={x:411,y:239},w=m.worldPoint(p,v),next=m.zoomAround(v,p,1.9);assert(Math.abs(m.worldPoint(p,next).x-w.x)<1e-9);assert(Math.abs(m.worldPoint(p,next).y-w.y)<1e-9)})
 check('invalid and extreme zoom clamped',()=>{assert.equal(m.clampZoom(NaN),1);assert.equal(m.clampZoom(-4),.15);assert.equal(m.clampZoom(999),3)})
 check('fit keeps examples within desktop viewport',()=>{const d=m.initialDocument(),v=m.fitViewport(d.nodes,1050,839);for(const n of d.nodes){assert(n.x*v.zoom+v.x>=0);assert((n.x+n.width)*v.zoom+v.x<=1050);assert((n.y+n.height)*v.zoom+v.y<=839)}})
 check('undo movement retains late image result',()=>{const d=m.initialDocument(),n={...d.nodes[0],status:'running'},end={...n,x:n.x+80};const edit=h.diffNodes([n],[end]);const doc={...d,nodes:[{...end,status:'ready',url:'/cases/new.jpg'}]};const result=h.applyEdit(doc,edit,'before').nodes[0];assert.equal(result.x,n.x);assert.equal(result.status,'ready');assert.equal(result.url,'/cases/new.jpg')})
 check('undo restores deleted object with admitted mock state',()=>{const d=m.initialDocument(),n={...d.nodes[0],taskId:'j',slotId:'s',status:'running'};const edit=h.diffNodes([n],[]);const result=h.applyEdit({...d,nodes:[],tasks:[{id:'j',slots:[{id:'s',status:'ready',url:'/cases/done.jpg'}]}]},edit,'before').nodes[0];assert.equal(result.status,'ready');assert.equal(result.url,'/cases/done.jpg')})
 check('z-order changes are undoable',()=>{const n=m.initialDocument().nodes[0];const edit=h.diffNodes([n],[{...n,z:5}]);assert.equal(edit.length,1);assert(edit[0].keys.includes('z'))})
 check('selection is not stored as generation reference',()=>{const d=m.initialDocument();assert.deepEqual(d.references,[{nodeId:'hero',role:'主图'}]);assert(!('selected' in d))})
 check('unsafe remote image URLs rejected',()=>{assert(m.safeImageUrl('/cases/example.jpg'));assert(!m.safeImageUrl('https://untrusted.invalid/img.png'));assert(!m.safeImageUrl('javascript:alert(1)'))})
 check('storage removes ephemeral blob URLs but retains asset IDs',()=>{const d=m.initialDocument();d.nodes[0].url='blob:temporary';d.nodes[0].assetId='a';const saved=storage.persistedDocument(d);assert.equal(saved.nodes[0].url,undefined);assert.equal(saved.nodes[0].assetId,'a');assert.equal(d.nodes[0].url,'blob:temporary')})
 check('restored in-flight jobs are interrupted, not replayed',()=>{const d=m.initialDocument();d.nodes[0].status='running';d.tasks=[{id:'j',status:'running',snapshot:{references:[]},slots:[{id:'s',status:'queued'}]}];const restored=storage.validateDocument(d);assert.equal(restored.nodes[0].status,'interrupted');assert.equal(restored.tasks[0].status,'interrupted')})
 check('malformed local state does not replace example silently',()=>assert.throws(()=>storage.validateDocument({version:1,nodes:[{}]})))
 check('mixed results retain partial success',()=>assert.equal(m.taskStatus([{status:'ready'},{status:'failed'}]),'partial'))
 check('ZIP contains UTF-8 filename, matching file length and CRC',()=>{const bytes=new TextEncoder().encode('hello'),zip=zipStored([{name:'商拍.txt',bytes}]),view=new DataView(zip.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(6,true),0x0800);assert.equal(view.getUint32(14,true),0x3610a686);assert.equal(view.getUint32(18,true),5);assert.equal(view.getUint32(zip.length-22,true),0x06054b50)})
 const task={id:'job',attempt:0,partialDemo:true,slots:[0,1,2,3].map(i=>({id:`slot-${i}`,nodeId:`node-${i}`,title:`镜头${i}`,status:'queued'}))}
 const runner=new MockRunner(4),events=[]
 runner.start(task,e=>events.push(e))
 await new Promise(r=>setTimeout(r,1500))
 check('deterministic mock returns one failure and three successes',()=>{assert.equal(events.filter(e=>e.status==='failed').length,1);assert.equal(events.filter(e=>e.status==='ready').length,3)})
 const retried=[];runner.start({...task,attempt:1},e=>retried.push(e),['slot-2']);await new Promise(r=>setTimeout(r,1200))
 check('single retry only emits for selected stable slot',()=>{assert.equal(retried.filter(e=>e.status==='ready').length,1);assert(retried.every(e=>e.slotId==='slot-2'&&e.attempt===1))})
 const cancelled=[];runner.start({...task,id:'cancel'},e=>cancelled.push(e));runner.cancel('cancel');await new Promise(r=>setTimeout(r,1100))
 check('cancel prevents all late callbacks',()=>assert.equal(cancelled.length,0))
 runner.dispose();console.log(`\n${passed} creative-studio tests passed.`)
}finally{await fs.rm(tmp,{recursive:true,force:true})}
