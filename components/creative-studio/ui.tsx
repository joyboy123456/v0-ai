'use client'
import { useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowUpRight, ArrowUp, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, X, Plus, Minus, Sparkles, MousePointer2, Hand, Upload, Images, Square, Type, Group, Layers, Download, Undo2, Redo2, PanelRightClose, PanelRightOpen, Scissors, ImagePlus, WandSparkles, Trash2, Copy, AlignLeft, RotateCcw, Eye, SlidersHorizontal, Paintbrush, Eraser, Maximize2, Search, Shirt, UserRound, Sun, Moon, Film, LayoutTemplate, Palette, MoreHorizontal, CheckCircle2, Circle, Loader2, Clock3, TriangleAlert, Play, SquarePen, Settings2, Camera, Grid2X2, Focus, HelpCircle, Bookmark, StopCircle, ZoomIn } from 'lucide-react'
import s from './studio.module.css'
const icons = { back: ArrowLeft, arrow: ArrowUpRight, up: ArrowUp, right: ArrowRight, check: Check, checks: CheckCheck, down: ChevronDown, next: ChevronRight, close: X, plus: Plus, minus: Minus, sparkles: Sparkles, select: MousePointer2, hand: Hand, upload: Upload, images: Images, frame: Square, text: Type, group: Group, layers: Layers, download: Download, undo: Undo2, redo: Redo2, panelClose: PanelRightClose, panelOpen: PanelRightOpen, scissors: Scissors, image: ImagePlus, magic: WandSparkles, trash: Trash2, copy: Copy, align: AlignLeft, rotate: RotateCcw, eye: Eye, settings: SlidersHorizontal, brush: Paintbrush, eraser: Eraser, expand: Maximize2, search: Search, shirt: Shirt, person: UserRound, sun: Sun, moon: Moon, video: Film, layout: LayoutTemplate, palette: Palette, more: MoreHorizontal, success: CheckCircle2, circle: Circle, loading: Loader2, clock: Clock3, warning: TriangleAlert, play: Play, edit: SquarePen, controls: Settings2, camera: Camera, grid: Grid2X2, focus: Focus, help: HelpCircle, bookmark: Bookmark, stop: StopCircle, zoom: ZoomIn }
export function Icon({ name, size = 17, className = '' }: { name: string; size?: number; className?: string }) {
  const Component = icons[name as keyof typeof icons] ?? Sparkles
  return <Component size={size} strokeWidth={1.65} aria-hidden="true" className={className} />
}
export function Button({ icon, children, primary, className='', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; primary?: boolean }) {
  return <button type="button" {...props} className={`${s.button} ${primary?s.primary:''} ${className}`}>{icon&&<Icon name={icon}/>} {children}</button>
}
export function IconButton({ label, icon, active, className='', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: string; active?: boolean }) {
  return <Tooltip.Root><Tooltip.Trigger asChild><button type="button" {...props} aria-label={label} aria-pressed={active} className={`${s.iconButton} ${active?s.active:''} ${className}`}><Icon name={icon}/></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className={`${s.scope} ${s.tooltip}`} side="right" sideOffset={9}>{label}<Tooltip.Arrow className={s.tooltipArrow}/></Tooltip.Content></Tooltip.Portal></Tooltip.Root>
}
export function TooltipProvider({ children }: { children: ReactNode }) {return <Tooltip.Provider delayDuration={260} skipDelayDuration={60}>{children}</Tooltip.Provider>}
export function ActionMenu({ children, items, label='更多操作' }: { children?: ReactNode; label?: string; items: {label:string;icon?:string;action:()=>void;danger?:boolean;disabled?:boolean}[] }) {
  return <Dropdown.Root><Dropdown.Trigger asChild>{children??<button type="button" className={s.iconButton} aria-label={label}><Icon name="more"/></button>}</Dropdown.Trigger><Dropdown.Portal><Dropdown.Content className={`${s.scope} ${s.menu}`} sideOffset={7} align="end">{items.map(item=><Dropdown.Item key={item.label} className={`${s.menuItem} ${item.danger?s.danger:''}`} disabled={item.disabled} onSelect={item.action}>{item.icon&&<Icon name={item.icon} size={16}/>}<span>{item.label}</span></Dropdown.Item>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root>
}
export function Modal({ open, onClose, title, description, children, wide=false }: {open:boolean;onClose:()=>void;title:string;description:string;children:ReactNode;wide?:boolean}) {
  return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onClose()}}><Dialog.Portal><Dialog.Overlay className={s.overlay}/><Dialog.Content className={`${s.scope} ${s.dialog} ${wide?s.wideDialog:''}`}><div className={s.modalHeading}><div><Dialog.Title className={s.modalTitle}>{title}</Dialog.Title><Dialog.Description className={s.modalDescription}>{description}</Dialog.Description></div><Dialog.Close asChild><button type="button" className={s.iconButton} aria-label="关闭对话框"><Icon name="close"/></button></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>
}
export function Picture({ url, name, className='' }: {url?:string;name:string;className?:string}) {
  const [failedUrl,setFailedUrl]=useState<string>(),[loadedUrl,setLoadedUrl]=useState<string>()
  const loaded=loadedUrl===url
  if(!url||failedUrl===url) return <div className={`${s.imageError} ${className}`}><Icon name="image" size={23}/><span>图片暂不可用</span><small>请重新上传素材</small></div>
  return <div className={`${s.picture} ${className}`} data-loaded={loaded}><img key={url} src={url} alt={name} draggable={false} decoding="async" onLoad={()=>setLoadedUrl(url)} onError={()=>setFailedUrl(url)} ref={node=>{if(node?.complete&&node.naturalWidth>0)setLoadedUrl(url)}}/></div>
}
