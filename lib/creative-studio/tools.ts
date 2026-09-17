export type ToolField = { key: string; label: string; choices: string[] }
export type StudioTool = { id: string; name: string; category: string; icon: string; description: string; fields: ToolField[]; batch?: boolean }
const field = (key: string, label: string, choices: string[]): ToolField => ({ key, label, choices })
export const TOOLS: StudioTool[] = [
  { id: 'fission', name: '生成套图', category: '商业生图', icon: 'grid', description: '从一张主图，延展一组完整商拍。', batch: true, fields: [field('scene', '场景延续', ['保持原场景', '自然户外', '干净影棚'])] },
  { id: 'fashion', name: '服装商拍', category: '商业生图', icon: 'camera', description: '组合服装与模特参考，规划商业摄影。', fields: [field('crop', '景别', ['全身', '半身', '细节']), field('light', '光线', ['柔和日光', '影棚柔光', '逆光'])] },
  { id: 'pose', name: '换姿势', category: '商业生图', icon: 'person', description: '保持人物与服装，选择新的姿势。', batch: true, fields: [] },
  { id: 'angle', name: '多角度', category: '商业生图', icon: 'rotate', description: '围绕同一件商品，补齐不同视角。', batch: true, fields: [field('angle', '观察角度', ['正面', '左侧 45°', '右侧 45°', '背面'])] },
  { id: 'model', name: '更换模特', category: '模特与服装', icon: 'person', description: '使用指定人物参考演示模特替换流程。', fields: [field('identity', '人物来源', ['当前引用的模特图', '本项目人物素材'])] },
  { id: 'outfit', name: '智能换装', category: '模特与服装', icon: 'shirt', description: '保留人物，将服装参考用于穿搭。', fields: [field('garment', '替换范围', ['整套服装', '上装', '下装'])] },
  { id: 'color', name: '服装换色', category: '模特与服装', icon: 'palette', description: '规划同版型不同颜色的商品素材。', fields: [field('color', '目标颜色', ['奶油白', '海军蓝', '浅灰', '自定义描述'])] },
  { id: 'face', name: '面部精修', category: '模特与服装', icon: 'person', description: '在保留人物特征的基础上改善细节。', fields: [field('strength', '调整程度', ['自然轻修', '细节增强'])] },
  { id: 'background', name: '更换背景', category: '图片编辑', icon: 'image', description: '保留主体，探索新的拍摄环境。', fields: [field('scene', '目标场景', ['纯色影棚', '林间自然光', '城市街角', '自定义描述'])] },
  { id: 'inpaint', name: '局部重绘', category: '图片编辑', icon: 'brush', description: '涂抹需要修改的位置，其余区域保留。', fields: [field('strength', '修改幅度', ['轻微调整', '替换选区内容'])] },
  { id: 'erase', name: '智能擦除', category: '图片编辑', icon: 'eraser', description: '标记需要移除的区域，保留原图版本。', fields: [] },
  { id: 'expand', name: '智能扩图', category: '图片编辑', icon: 'expand', description: '保留画面，扩展适配新的构图。', fields: [field('direction', '扩展方向', ['四周', '向上', '向下', '两侧'])] },
  { id: 'cutout', name: '移除背景', category: '图片编辑', icon: 'scissors', description: '演示主体提取与透明背景输出流程。', fields: [field('subject', '保留主体', ['人物与服装', '服装'])] },
  { id: 'upscale', name: '高清增强', category: '图片编辑', icon: 'expand', description: '规划服装面料与边缘细节增强。', fields: [field('scale', '增强倍率', ['2×', '4×'])] },
  { id: 'style', name: '风格参考', category: '图片编辑', icon: 'palette', description: '用参考图引导色调、光线与整体氛围。', fields: [field('strength', '参考强度', ['轻度', '中度', '强'])] },
  { id: 'detail', name: '详情页素材', category: '电商交付', icon: 'layout', description: '规划卖点、细节与穿搭展示的素材组合。', batch: true, fields: [field('focus', '内容重点', ['版型与面料', '穿搭与场景', '核心卖点'])] },
  { id: 'resize', name: '多尺寸适配', category: '电商交付', icon: 'layout', description: '为不同渠道准备画幅与素材版本。', fields: [field('platform', '投放渠道', ['商品主图', '小红书', '竖版详情'])] },
  { id: 'video', name: '图生视频', category: '动态内容', icon: 'video', description: '设计镜头方案。本版仅预览分镜，不生成视频。', fields: [field('motion', '镜头运动', ['缓慢推进', '横向移动', '轻微环绕']), field('duration', '目标时长', ['5 秒', '10 秒'])] },
]
export const getTool = (id: string) => TOOLS.find(t => t.id === id) ?? TOOLS[0]
export const CATEGORIES = ['全部', '商业生图', '模特与服装', '图片编辑', '电商交付', '动态内容']
