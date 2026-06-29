export type PantsPoseView = 'front' | 'side' | 'left' | 'right' | 'back'
export type PantsMainHandVisibility = 'hidden' | 'visible'

export type PantsPoseCondition =
  | 'pocket'
  | 'main-prop'
  | 'head-visible'
  | 'scene-support'

export type PantsPoseVisualFamily =
  | 'arms-crossed'
  | 'chair-knee-bend'
  | 'cross-step'
  | 'front-foot-lift'
  | 'hands-hidden'
  | 'heel-touch-toe-up'
  | 'knee-bend'
  | 'open-triangle'
  | 'parallel'
  | 'side-reach'
  | 'staggered'
  | 'staggered-v'
  | 'step-height'
  | 'toe-in'
  | 'toe-out'
  | 'toe-point'
  | 'v-toe'
  | 'walking'
  | 'wide-stance'
  | 'weight-shift'

export type PantsPoseSupportHandMode = 'hidden-ok' | 'visible-only'

export interface PantsPoseSupport {
  type: 'white-step' | 'white-rail' | 'transparent-metal-chair' | 'white-table'
  label: string
  prompt: string
  handMode: PantsPoseSupportHandMode
}

export interface PantsPoseCard {
  id: string
  view: PantsPoseView
  label: string
  noHandLabel?: string
  hand: string
  legs: string
  support?: PantsPoseSupport
  /** 肉眼可见的腿部/重心动作族，用于同批去重。未填时由 id 规则推导。 */
  visualFamily?: PantsPoseVisualFamily
  /** 当前姿势必须在成图里看得出的差异点。未填时由 id 规则推导。 */
  mustShow?: string
  /** 当前姿势禁止退化成的相似动作。未填时由 id 规则推导。 */
  mustNotLookLike?: string[]
  condition?: PantsPoseCondition
}

const FRONT_POSES: ReadonlyArray<PantsPoseCard> = [
  {
    id: 'front-arms-crossed-parallel',
    view: 'front',
    label: '正面交叉抱臂平行站姿',
    hand: '双臂自然交叉叠放在胸前，手肘微向外打开，手腕放松',
    legs: '双脚与肩同宽平行踩实，脚后跟落地，膝盖自然放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-hands-folded-staggered',
    view: 'front',
    label: '正面双手分别搭腰前后脚站姿',
    hand: '双手分别自然搭在左右腰侧，双肘向两侧舒展，手腕保持中立',
    legs: '双脚前后错开约20cm呈小八字，脚后跟落地，重心均匀，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-waistband-lift-parallel',
    view: 'front',
    label: '正面双手轻捏腰头站姿',
    hand: '双手轻捏腰头边缘，只形成轻微动作，不拉扯变形',
    legs: '双脚并排平放，脚后跟落地，脚尖外分约15°，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-one-hand-waist-one-down',
    view: 'front',
    label: '正面单手搭腰站姿',
    hand: '一手轻搭腰胯，另一手自然收在身体后方并不露出手掌，手臂不贴裤缝',
    legs: '双脚前后错开约20cm，全脚掌落地，重心自然，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-one-hand-raised-one-down',
    view: 'front',
    label: '正面单手侧抬站姿',
    hand: '一手在主图上边界允许的身侧范围内小幅抬起，另一手自然收在身体后方并不露出手掌',
    legs: '双脚平行踩实地面，脚后跟落地，膝盖放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-hands-down-shoulder-width',
    view: 'front',
    label: '正面双手自然搭腰站姿',
    hand: '双手分别自然搭在腰间两侧，手腕保持中立，手指自然展开，不拉扯腰头',
    legs: '双脚平行分开与肩同宽，全脚掌踩实，脚后跟落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-one-hand-waistband-staggered',
    view: 'front',
    label: '正面单手轻捏腰头站姿',
    hand: '一手轻捏腰头边缘，另一手自然收在身体后方并不露出手掌',
    legs: '双脚前后错开约25cm，全脚掌落地，重心分摊双腿，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-weight-back-front-step',
    view: 'front',
    label: '正面重心后移小迈步',
    hand: '双手分别自然搭在左右腰侧，双肘向两侧舒展，双腕保持中立，不拉扯腰头',
    legs: '重心明显落在后脚，前腿向前约25cm迈出，前后脚脚后跟均落地，重心转移具有真实物理惯性感',
  },
  {
    id: 'front-relaxed-wide-stance',
    view: 'front',
    label: '正面自然分腿站姿',
    hand: '一手轻搭胯侧，另一手自然收在身体后方并不露出手掌，手臂不贴裤身',
    legs: '双腿分开约40cm，膝盖微松不锁死，双脚完整落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-waistband-outward-narrow',
    view: 'front',
    label: '正面双手轻展腰头窄站姿',
    hand: '双手轻捏腰头两侧并向外展开极小幅度，保持腰头原有宽度和形态，不拉扯变形',
    legs: '双脚平行并排且窄于肩宽约15cm，全脚掌落地，脚尖朝前，双腿放松直立，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-low-arms-folded-narrow',
    view: 'front',
    label: '正面胸前交叉抱臂窄站姿',
    hand: '双臂自然交叉叠放在胸前，双腕远离小腹和裆部，不遮挡腰头和裤身主要细节',
    legs: '双脚平行窄站约15cm，全脚掌平稳落地，脚尖朝前，重心居中，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-reverse-waist-hand-staggered',
    view: 'front',
    label: '正面微侧双手自然搭腰站姿',
    hand: '双手分别自然搭在腰间两侧，双腕保持中立，手指放松，不牵扯裤腰',
    legs: '双脚前后错开约20cm并完整落地，膝盖自然放松，重心均匀，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-side-reach-one-waist',
    view: 'front',
    label: '正面单臂侧展搭腰站姿',
    hand: '一手在主图边界允许的范围内向画面侧边自然伸展，另一手轻搭腰侧',
    legs: '双脚前后错开约25cm，全脚掌落地，前脚脚尖内收约10°，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-hands-behind-stable',
    view: 'front',
    label: '正面双手收于身后站姿',
    hand: '双臂自然置于躯干后方，两只手掌和全部手指都被身体完全遮挡，肩肘放松，不出现身后额外手掌',
    legs: '双脚与肩同宽平行落地，脚尖外分约15°，膝盖自然放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-soft-toe-out',
    view: 'front',
    label: '正面轻外八站姿',
    hand: '双手自然收在躯干后方并被身体遮挡，不出现低位手掌或贴裤手臂',
    legs: '双脚全脚掌落地，脚后跟完整贴地，两脚脚尖向外打开约10°-15°，膝盖自然微弯，重心居中；不要变成大宽站或前后迈步',
  },
  {
    id: 'front-soft-toe-in',
    view: 'front',
    label: '正面轻内八站姿',
    hand: '双手自然收在躯干后方并被身体遮挡，不出现低位手掌或贴裤手臂',
    legs: '双脚全脚掌落地，两脚脚尖向内扣约8°-10°，两膝自然靠近但不夹腿，脚后跟完整贴地，重心居中；不要变成交叉腿',
  },
  {
    id: 'front-shallow-v-toe',
    view: 'front',
    label: '正面浅V脚尖站姿',
    hand: '双手分别自然搭在腰间两侧，双肘弯曲离开裤缝，手腕保持中立',
    legs: '两脚脚跟距离约8-12cm，两个脚尖向外打开成浅V形，双脚全脚掌落地，裤腿自然垂直；不要变成大外八宽站',
  },
  {
    id: 'front-staggered-v-toe',
    view: 'front',
    label: '正面前后V形脚位站姿',
    hand: '一手轻搭腰侧，另一手自然收在身体后方并不露出手掌，手臂不贴裤缝',
    legs: '一脚在前约15cm，前脚脚尖向外打开约15°，后脚脚尖朝前或微外八，两脚形成前后V形，双脚脚后跟都贴地；不要变成普通前后错步',
  },
  {
    id: 'front-heel-touch-toe-up',
    view: 'front',
    label: '正面脚尖翘起脚后跟点地站姿',
    hand: '双手自然收在躯干后方并被身体遮挡，不出现低位手掌或贴裤手臂',
    legs: '一脚全脚掌落地承重，另一脚脚后跟点地，脚尖翘起约5-8cm，脚踝上抬角度可见，膝盖自然微弯；不要变成脚尖点地或前脚掌点地',
  },
  {
    id: 'front-light-thigh-touch-toe-point',
    view: 'front',
    label: '正面侧手悬停脚尖点地站姿',
    hand: '一手在大腿外侧旁自然悬停并与裤面保留清晰空隙，另一手自然搭在腰间；两只手都不贴压、不抓起、不遮挡裤腿',
    legs: '支撑脚全脚掌落地，另一腿膝盖明显弯曲约30°，脚后跟明显离地约10cm，仅脚尖点地，小腿向内倾斜可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-low-hands-away-staggered',
    view: 'front',
    label: '正面低位双手离裤前后脚站姿',
    hand: '双前臂在身前低位自然靠近，双手松散轻叠但与腰头、裆部和裤面保留明显可见空隙，手掌与手指不接触也不遮挡裤子',
    legs: '双脚前后错开约25cm，后脚稳定承重，前脚全脚掌自然落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-double-waist-light-wide',
    view: 'front',
    label: '正面双手轻扶腰侧宽站姿',
    hand: '双手分别轻扶腰头两侧边缘，手肘向内自然收拢，只做轻触不提拉、不改变腰头宽度和裤身版型',
    legs: '双脚与肩同宽平行落地，全脚掌踩实，脚后跟完整压实地面，脚尖外分约15°，重心均匀，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-single-waist-inner-toe-point',
    view: 'front',
    label: '正面单手扶腰内收脚尖点地站姿',
    hand: '一手轻扶单侧腰头边缘，另一手自然收在身体后方并不露出手掌；手臂不贴裤缝、不压裤面',
    legs: '支撑脚全脚掌落地承重，另一腿膝盖明显弯曲约30°，脚后跟明显离地约10cm，仅脚尖点地，小腿向内倾斜可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-hands-hidden-narrow-parallel',
    view: 'front',
    label: '正面双手隐藏窄距平行站姿',
    hand: '双臂自然置于躯干后方，两只手掌和全部手指都被身体完全遮挡，不出现低位手掌或贴裤手臂',
    legs: '双脚平行窄距约15cm并排站立，脚后跟完全贴地，脚尖正对镜头，双腿自然直立但膝盖不锁死，姿势有物理重量和惯性，动态符合真实物理规律',
  },
]

interface SidePoseSeed {
  id: string
  label: string
  angle: '45' | '90'
  hand: string
  legs: string
}

const SIDE_POSE_SEEDS: ReadonlyArray<SidePoseSeed> = [
  {
    id: 'basic-weight-back',
    label: '斜侧重心后移基础站姿',
    angle: '45',
    hand: '一手轻搭腰胯，另一手自然收在身体后方并不露出手掌，手臂不贴裤缝',
    legs: '重心明显落在后支撑脚，前脚向前约25cm，前后脚脚后跟均落地，重心转移具有真实物理惯性感',
  },
  {
    id: 'pure-side-staggered',
    label: '纯侧面前后脚站姿',
    angle: '90',
    hand: '双手都必须分别搭在左右腰侧，双肘弯曲离开裤缝；不能有任何一条手臂竖直贴着裤缝或手掌贴在大腿外侧',
    legs: '双脚一前一后纵向侧面站立，前后错开约30cm，脚后跟完整贴地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-foot-lift',
    label: '侧面前脚掌微抬站姿',
    angle: '45',
    hand: '双手分别自然搭在左右腰侧，双肘弯曲离开裤缝，双腕保持中立，不拉扯腰头',
    legs: '后脚承重，前脚掌抬起约5cm，脚后跟仍贴地，脚踝角度变化在画面中部可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'heel-touch-toe-up',
    label: '侧面脚尖翘起脚后跟点地站姿',
    angle: '45',
    hand: '双手分别自然搭在左右腰侧，双肘弯曲离开裤缝，双腕保持中立，不拉扯腰头',
    legs: '后脚全脚掌落地承重，前脚在身体前方约15-20cm，前脚脚后跟点地，前脚脚尖翘起约5-8cm，脚踝上抬角度可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'compact-toe-out',
    label: '侧面紧凑外八站姿',
    angle: '90',
    hand: '双手自然收在躯干后方并被身体遮挡，不出现低位手掌或贴裤手臂',
    legs: '双脚都在身体正下方全脚掌落地，脚尖轻微向画面外侧打开约10°-12°，前后距离不超过12cm，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'compact-staggered-v',
    label: '侧面前后小V脚位站姿',
    angle: '45',
    hand: '一手轻搭腰侧，另一手自然收在身体后方并不露出手掌，手臂不贴裤缝',
    legs: '一脚在前约15cm，前脚脚尖向外侧打开约12°，后脚全脚掌落地，双脚脚后跟都贴地，两腿保持紧凑小V脚位，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'arms-crossed',
    label: '斜侧交叉抱臂站姿',
    angle: '45',
    hand: '双臂自然交叉抱于胸前，手肘微向外',
    legs: '前后脚平行错开约20cm，双脚脚后跟落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'waistband-one-hand',
    label: '斜侧单手轻捏腰头站姿',
    angle: '45',
    hand: '一手轻捏腰头边缘，另一手自然收在身体后方并不露出手掌，手臂不贴裤缝',
    legs: '双脚前后错开约25cm，全脚掌落地，重心分摊双腿，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'toe-point-back',
    label: '斜侧后撤脚尖点地站姿',
    angle: '45',
    hand: '双手分别自然搭在腰间两侧，手肘方向一致，手腕保持中立，不拉扯腰头',
    legs: '前腿全脚掌落地承重，后腿向后撤约25cm，膝盖明显弯曲约30°，仅脚尖点地，脚后跟明显离地约10cm，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'knee-lift-toe-touch',
    label: '斜侧动态屈膝站姿',
    angle: '45',
    hand: '若当前侧面参考清楚显示可用侧袋，则一手自然插入该侧袋、另一手搭在腰间；若没有明确侧袋证据，则双手分别搭在左右腰侧。禁止任何手掌贴着大腿外侧或沿裤缝下垂',
    legs: '支撑脚全脚掌落地，另一腿膝盖明显弯曲约30°，膝盖位置明显低于站立状态，仅脚尖点地，脚后跟明显离地约10cm，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'low-hands-away-cross-step',
    label: '斜侧低位双手离裤交叉步站姿',
    angle: '45',
    hand: '双前臂在身前低位自然靠近，双手松散轻叠但与腰头、裆部和裤面保留明显可见空隙，手掌与手指不接触裤子，也不遮挡侧面轮廓',
    legs: '支撑脚全脚掌落地，另一腿向前内侧跨出约25cm并以脚尖点地，膝盖明显弯曲约30°，大腿越过支撑腿中线形成可见交叉关系，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'walking-pause',
    label: '斜侧行走停顿姿势',
    angle: '45',
    hand: '一手搭腰胯，另一手自然收在身体后方并不露出手掌，避免手臂摆动贴到裤缝',
    legs: '前脚全脚掌落地，后脚脚尖蹬地，脚后跟抬起约8cm，两腿形成明显步幅差约30cm，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'pure-side-walk',
    label: '纯侧面自然行走姿势',
    angle: '90',
    hand: '若当前侧面参考清楚显示可用侧袋，则一手自然插入该侧袋、另一手搭在腰间；若没有明确侧袋证据，则双手分别搭在左右腰侧。双臂不能沿裤缝竖直下垂',
    legs: '前脚全脚掌落地，后脚脚尖蹬地，脚后跟抬起约8cm，两腿步幅差约30cm，保持清楚侧面轮廓，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'hands-down-stable',
    label: '侧面一手搭腰一手收后稳定站姿',
    angle: '90',
    hand: '一手轻搭腰侧，另一只手自然收在身后，双手不能同时垂在大腿外侧',
    legs: '双脚前后错开约20cm，全脚掌落地，脚后跟贴地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'reverse-hand-rear-waist',
    label: '斜侧双手分别搭腰站姿',
    angle: '45',
    hand: '双手分别自然搭在左右腰侧，双肘弯曲离开裤缝，双腕保持中立，不拉扯腰头',
    legs: '双脚前后错开约20cm并完整落地，膝盖放松，重心均匀，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'one-waist-one-behind',
    label: '斜侧双手完全隐藏站姿',
    angle: '45',
    hand: '双臂自然置于躯干后方，两只手掌和全部手指都被身体完全遮挡，不出现身后额外手掌',
    legs: '后脚全脚掌承重，前脚向侧前方伸出约30cm并全掌落地，双腿形成开放三角轮廓，大腿前后错开关系在画面中部可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'both-hands-waistband-staggered',
    label: '侧面双手轻扶腰头站姿',
    angle: '90',
    hand: '双手分别轻扶腰头两侧，动作极轻，不向上提拉也不改变腰头形态',
    legs: '双脚一前一后纵向站立，前后错开约25cm，全脚掌落地，保持清楚侧面轮廓，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'side-reach-one-waist',
    label: '斜侧单臂侧展搭腰站姿',
    angle: '45',
    hand: '一手在主图边界允许范围内向侧边舒展，另一手轻搭腰胯，不遮挡裤身',
    legs: '双脚前后错开约20cm，后脚稳定承重，前脚全脚掌落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'hands-behind-pure-side',
    label: '纯侧面双手收后站姿',
    angle: '90',
    hand: '双臂自然置于躯干后方，两只手掌和全部手指都被身体完全遮挡，画面中只保留两条结构正常的手臂，不出现身后额外手掌',
    legs: '前腿全脚掌承重并屈膝约20°，后腿向后半步约20cm且脚跟抬起约10cm，仅后脚前脚掌落地，形成静态弓步轮廓，膝盖弯曲角度在画面中部可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'front-toe-point-long-line',
    label: '斜侧后腿承重前脚点地站姿',
    angle: '45',
    hand: '一手轻扶单侧腰头边缘，另一手自然收在身体后方并不露出手掌；手肘离开裤缝，不遮挡侧面裁线',
    legs: '后腿全脚掌落地承担主要重心，前腿向侧前方伸出约30cm并膝盖明显弯曲约30°，仅前脚掌和脚尖点地，脚后跟完全悬空约10cm，小腿向前倾斜可见，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'all-heels-staggered',
    label: '斜侧双脚全掌错步站姿',
    angle: '45',
    hand: '双手分别轻搭左右腰侧，双腕保持中立，不牵扯腰头，也不沿裤缝下垂',
    legs: '双脚前后错开约25cm并全部全脚掌落地，双脚脚后跟都压实地面，膝盖自然放松，重心均分双腿，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'hands-hidden-open-step',
    label: '斜侧双手隐藏开放错步站姿',
    angle: '45',
    hand: '双臂自然收至躯干后方，双手、手掌和手指完全被身体遮挡，避免身后多余手掌',
    legs: '前脚全脚掌完整落地，后脚向后错开约25cm并以前脚掌轻点地，脚后跟抬起约8cm，双腿形成开放侧向轮廓，姿势有物理重量和惯性，动态符合真实物理规律',
  },
]

function buildSidePoses(view: 'left' | 'right'): PantsPoseCard[] {
  const direction = view === 'left' ? '左侧' : '右侧'
  return SIDE_POSE_SEEDS.map((seed) => ({
    id: `${view}-${seed.id}`,
    view,
    label: `${direction}${seed.label}`,
    hand: seed.hand,
    legs: seed.legs,
  }))
}

const BACK_POSES: ReadonlyArray<PantsPoseCard> = [
  {
    id: 'back-both-hands-waist-toe-point',
    view: 'back',
    label: '背面双手分别搭腰脚尖点地站姿',
    hand: '双手分别自然搭在左右腰侧，双肘向身体两侧展开，左右前臂不在后腰中间交叉，双腕不相碰，不遮挡裤子后片主要区域',
    legs: '支撑脚全脚掌落地，另一脚向后半步约25cm仅以前脚掌点地，脚跟抬起约10cm，膝盖明显弯曲约30°，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-hands-down-parallel',
    view: 'back',
    label: '标准背面一手扶后腰一手收后站姿',
    hand: '一手轻扶后腰单侧，另一只手自然收在身后，双手不能同时垂在大腿两侧',
    legs: '双脚与肩同宽平行落地，脚后跟贴地，膝盖放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-soft-toe-out',
    view: 'back',
    label: '背面轻外八站姿',
    hand: '双手分别自然搭在左右腰侧，双肘向身体两侧展开，双腕不在后腰中间相碰，不遮挡裤子后片主要区域',
    legs: '双脚与胯同宽全脚掌落地，脚后跟完整贴地，脚尖轻微外八约10°-15°，裤腿后片自然垂直，重心居中；不要变成大宽站',
  },
  {
    id: 'back-soft-toe-in',
    view: 'back',
    label: '背面轻内扣站姿',
    hand: '双手自然收在躯干后方并被身体遮挡，不牵扯后腰，不新增手部遮挡，也不出现身后额外手掌',
    legs: '双脚全脚掌落地，脚后跟完整贴地，脚尖轻微向内扣约8°，膝盖自然放松，重心居中；不要变成交叉腿',
  },
  {
    id: 'back-slight-left-staggered',
    view: 'back',
    label: '背面微左侧前后脚站姿',
    hand: '一手轻搭后腰侧，另一手自然收在躯干后方并被身体遮挡，不垂落到腿侧',
    legs: '重心在后脚，前后脚错开约20cm，双脚脚后跟落地，重心转移具有真实物理惯性感',
  },
  {
    id: 'back-slight-right-staggered',
    view: 'back',
    label: '背面微右侧前后脚站姿',
    hand: '一手轻搭腰侧，另一手自然收在躯干后方并被身体遮挡，不垂落到腿侧',
    legs: '双脚前后错开约20cm排布，双脚脚后跟平稳落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-straight-relaxed',
    view: 'back',
    label: '纯背面双手分别搭腰站姿',
    hand: '双手分别自然搭在左右腰侧，双肘向两侧展开，双腕不在后腰中间相碰，不牵扯裤腰',
    legs: '双脚平行分开与肩同宽，全脚掌踩实，脚后跟落地，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-toe-point',
    view: 'back',
    label: '背面微侧脚尖点地站姿',
    hand: '单手轻搭后腰，另一手自然收在躯干后方并被身体遮挡，不垂落到腿侧',
    legs: '主力脚全脚掌落地，另一只脚仅前脚掌触地，脚后跟抬起约10cm，膝盖弯曲约30°，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-weight-shift',
    view: 'back',
    label: '背面重心侧移站姿',
    hand: '一手轻扶后腰侧边，另一只前臂向身体外侧小幅打开，不遮挡裤身后片',
    legs: '重心明显落在一侧支撑腿，另一腿放松错开约20cm，髋部和膝部状态能看出重心变化，重心转移具有真实物理惯性感',
  },
  {
    id: 'back-double-waistband-light-spread',
    view: 'back',
    label: '背面双手轻展后腰站姿',
    hand: '双手轻捏后腰两侧边缘并向外展开极小幅度，保持后腰原有形态，不展示或臆造额外松紧结构',
    legs: '双脚平行分开与肩同宽，全脚掌落地，脚尖朝画面深处，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-single-waistband-one-down',
    view: 'back',
    label: '背面单手轻扶后腰站姿',
    hand: '一手轻扶后腰单侧边缘，另一手自然收在躯干后方并被身体遮挡，不垂落到腿侧',
    legs: '双脚前后错开约20cm并完整落地，膝盖自然放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-hands-hidden-behind',
    view: 'back',
    label: '背面双手藏于身后站姿',
    hand: '双手自然背在身后并被身体遮挡，不新增手部遮挡，也不牵扯裤腰',
    legs: '双脚平行分开与肩同宽，全脚掌踩实，双腿自然直立，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-one-raised-one-waist',
    view: 'back',
    label: '背面单臂轻抬扶后腰站姿',
    hand: '一手在主图上边界允许范围内小幅抬起，另一手轻扶后腰侧边',
    legs: '支撑脚全脚掌落地，另一脚向前约25cm并以前脚掌轻点地面，脚后跟离地约8cm，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-double-waist-parallel-heels',
    view: 'back',
    label: '背面双手轻扶后腰平行站姿',
    hand: '双手分别轻扶后腰左右两侧，双肘小幅向外打开，双腕不在后腰中间相碰，不遮挡后片中线和主要商品区域',
    legs: '双脚平行分开与胯同宽，全脚掌完整踩实地面，脚后跟完全落地，脚尖朝画面深处，重心均匀，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-hands-hidden-staggered',
    view: 'back',
    label: '背面双手隐藏前后脚站姿',
    hand: '双手自然收在躯干后方并被身体遮挡，不牵扯后腰，不新增手部遮挡，也不出现身后额外手掌',
    legs: '双脚前后错开约20cm站立，两只脚脚后跟全部落地踩实，脚尖轻微向内侧收拢，膝盖放松，姿势有物理重量和惯性，动态符合真实物理规律',
  },
  {
    id: 'back-single-waist-toe-point',
    view: 'back',
    label: '背面单手扶后腰脚尖点地站姿',
    hand: '一手轻扶后腰单侧边缘，另一手自然收在躯干后方并被身体遮挡，不垂落到腿侧',
    legs: '支撑脚全脚掌落地承重，另一脚向后半步约25cm仅脚尖轻点地面，脚后跟明显离地约10cm，膝盖弯曲约30°，姿势有物理重量和惯性，动态符合真实物理规律',
  },
]

const SUPPORT_POSES: ReadonlyArray<PantsPoseCard> = [
  {
    id: 'left-white-step-staggered',
    view: 'left',
    label: '左侧白色台阶错步站姿',
    noHandLabel: '左侧白色台阶错步站姿',
    hand: '双手分别轻搭腰侧或自然收在身后，手臂不贴裤缝',
    legs: '前脚踩在白色极简低台阶上全脚掌落地，后脚在地面向后错开约25cm，脚后跟完整落地，双腿高低差约15cm形成清楚高低层次，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-step',
      label: '白色极简低台阶',
      prompt:
        '只允许新增一个白色极简低台阶作为脚部支撑；背景、光线和相机距离仍与图1主图一致，不新增其它道具、家具、街景或复杂场景',
      handMode: 'hidden-ok',
    },
    visualFamily: 'step-height',
    mustShow:
      '一只脚在白色低台阶上全脚掌踩实，另一脚在地面错开，膝盖弯曲角度和大腿高低差在画面中部可见，腿脚必须形成清楚高低层次',
    mustNotLookLike: ['普通地面前后脚站姿', '双脚同一平面', '行走停顿'],
  },
  {
    id: 'right-white-step-staggered',
    view: 'right',
    label: '右侧白色台阶错步站姿',
    noHandLabel: '右侧白色台阶错步站姿',
    hand: '双手分别轻搭腰侧或自然收在身后，手臂不贴裤缝',
    legs: '前脚踩在白色极简低台阶上全脚掌落地，后脚在地面向后错开约25cm，脚后跟完整落地，双腿高低差约15cm形成清楚高低层次，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-step',
      label: '白色极简低台阶',
      prompt:
        '只允许新增一个白色极简低台阶作为脚部支撑；背景、光线和相机距离仍与图1主图一致，不新增其它道具、家具、街景或复杂场景',
      handMode: 'hidden-ok',
    },
    visualFamily: 'step-height',
    mustShow:
      '一只脚在白色低台阶上全脚掌踩实，另一脚在地面错开，膝盖弯曲角度和大腿高低差在画面中部可见，腿脚必须形成清楚高低层次',
    mustNotLookLike: ['普通地面前后脚站姿', '双脚同一平面', '行走停顿'],
  },
  {
    id: 'left-transparent-chair-knee-bend',
    view: 'left',
    label: '左侧透明金属椅子屈膝支撑姿势',
    noHandLabel: '左侧透明金属椅子屈膝支撑姿势',
    hand: '一手轻搭腰侧，另一手自然收在身后或轻扶透明金属椅背边缘，不遮挡裤身',
    legs: '支撑脚全脚掌落地，另一腿膝盖明显弯曲约45°，小腿或脚掌必须与透明金属椅子的低横杆发生清楚接触，仅脚尖点地，脚后跟离地约12cm，膝盖位置明显低于站立状态，裤身主体不被椅子遮挡，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'transparent-metal-chair',
      label: '透明金属椅子',
      prompt:
        '只允许新增一把透明金属椅子作为腿脚真实接触支撑；椅子必须与脚掌、小腿或膝部有明确接触关系，只露低横杆、细金属腿或必要边缘，不能孤立摆放在人物旁边；背景、光线和相机距离仍与图1主图一致，不新增其它家具、装饰或复杂场景',
      handMode: 'hidden-ok',
    },
    visualFamily: 'chair-knee-bend',
    mustShow:
      '非支撑腿膝盖明显弯曲约45°，脚掌、小腿或膝部必须与透明金属椅子低横杆或边缘发生清楚接触，膝盖位置在画面中部可见，椅子不能遮挡裤身主体',
    mustNotLookLike: ['普通侧面直立', '坐在椅子上', '椅子孤立摆放在旁边', '椅子遮住裤腿'],
  },
  {
    id: 'right-transparent-chair-knee-bend',
    view: 'right',
    label: '右侧透明金属椅子屈膝支撑姿势',
    noHandLabel: '右侧透明金属椅子屈膝支撑姿势',
    hand: '一手轻搭腰侧，另一手自然收在身后或轻扶透明金属椅背边缘，不遮挡裤身',
    legs: '支撑脚全脚掌落地，另一腿膝盖明显弯曲约45°，小腿或脚掌必须与透明金属椅子的低横杆发生清楚接触，仅脚尖点地，脚后跟离地约12cm，膝盖位置明显低于站立状态，裤身主体不被椅子遮挡，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'transparent-metal-chair',
      label: '透明金属椅子',
      prompt:
        '只允许新增一把透明金属椅子作为腿脚真实接触支撑；椅子必须与脚掌、小腿或膝部有明确接触关系，只露低横杆、细金属腿或必要边缘，不能孤立摆放在人物旁边；背景、光线和相机距离仍与图1主图一致，不新增其它家具、装饰或复杂场景',
      handMode: 'hidden-ok',
    },
    visualFamily: 'chair-knee-bend',
    mustShow:
      '非支撑腿膝盖明显弯曲约45°，脚掌、小腿或膝部必须与透明金属椅子低横杆或边缘发生清楚接触，膝盖位置在画面中部可见，椅子不能遮挡裤身主体',
    mustNotLookLike: ['普通侧面直立', '坐在椅子上', '椅子孤立摆放在旁边', '椅子遮住裤腿'],
  },
  {
    id: 'left-white-rail-toe-point',
    view: 'left',
    label: '左侧白色栏杆扶手脚尖点地姿势',
    hand: '一手轻扶白色极简细栏杆或扶手边缘，另一手轻搭腰侧；手臂不遮挡裤身',
    legs: '支撑脚全脚掌落地，另一脚向侧前方伸出约25cm并膝盖弯曲约30°，仅脚尖轻点地面，脚后跟明显离地约10cm，小腿向前倾斜可见，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-rail',
      label: '白色极简细栏杆',
      prompt:
        '只允许新增一个白色极简细栏杆或扶手，作为手部轻扶支撑；背景、光线和相机距离仍与图1主图一致，不新增其它道具、人群、街景或复杂场景',
      handMode: 'visible-only',
    },
    visualFamily: 'toe-point',
    mustShow:
      '一只手轻扶白色细栏杆，另一脚脚尖点地且脚后跟明显离地约10cm，膝盖弯曲角度在画面中部可见',
    mustNotLookLike: ['无支撑普通站姿', '双脚全掌落地', '栏杆遮挡裤身'],
  },
  {
    id: 'right-white-rail-toe-point',
    view: 'right',
    label: '右侧白色栏杆扶手脚尖点地姿势',
    hand: '一手轻扶白色极简细栏杆或扶手边缘，另一手轻搭腰侧；手臂不遮挡裤身',
    legs: '支撑脚全脚掌落地，另一脚向侧前方伸出约25cm并膝盖弯曲约30°，仅脚尖轻点地面，脚后跟明显离地约10cm，小腿向前倾斜可见，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-rail',
      label: '白色极简细栏杆',
      prompt:
        '只允许新增一个白色极简细栏杆或扶手，作为手部轻扶支撑；背景、光线和相机距离仍与图1主图一致，不新增其它道具、人群、街景或复杂场景',
      handMode: 'visible-only',
    },
    visualFamily: 'toe-point',
    mustShow:
      '一只手轻扶白色细栏杆，另一脚脚尖点地且脚后跟明显离地约10cm，膝盖弯曲角度在画面中部可见',
    mustNotLookLike: ['无支撑普通站姿', '双脚全掌落地', '栏杆遮挡裤身'],
  },
  {
    id: 'left-white-table-staggered',
    view: 'left',
    label: '左侧白色台面轻扶错步站姿',
    hand: '一手轻搭白色极简台面边缘，另一手轻搭腰侧或收在身后；手掌和台面都不遮挡裤腰、裤身和裤脚',
    legs: '双脚前后错开约25cm，全脚掌落地，后脚稳定承重，前脚自然放松，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-table',
      label: '白色极简台面',
      prompt:
        '只允许新增一个白色极简台面边缘，台面只在画面边侧低存在感出现；背景、光线和相机距离仍与图1主图一致，不新增其它家具、摆件或复杂场景',
      handMode: 'visible-only',
    },
    visualFamily: 'staggered',
    mustShow:
      '一只手轻搭白色台面边缘，双脚前后错开约25cm且台面不能遮挡裤子主体，膝盖状态在画面中部可见',
    mustNotLookLike: ['无支撑普通站姿', '台面遮挡裤腰', '双脚平行直立'],
  },
  {
    id: 'right-white-table-staggered',
    view: 'right',
    label: '右侧白色台面轻扶错步站姿',
    hand: '一手轻搭白色极简台面边缘，另一手轻搭腰侧或收在身后；手掌和台面都不遮挡裤腰、裤身和裤脚',
    legs: '双脚前后错开约25cm，全脚掌落地，后脚稳定承重，前脚自然放松，姿势有物理重量和惯性，动态符合真实物理规律',
    support: {
      type: 'white-table',
      label: '白色极简台面',
      prompt:
        '只允许新增一个白色极简台面边缘，台面只在画面边侧低存在感出现；背景、光线和相机距离仍与图1主图一致，不新增其它家具、摆件或复杂场景',
      handMode: 'visible-only',
    },
    visualFamily: 'staggered',
    mustShow:
      '一只手轻搭白色台面边缘，双脚前后错开约25cm且台面不能遮挡裤子主体，膝盖状态在画面中部可见',
    mustNotLookLike: ['无支撑普通站姿', '台面遮挡裤腰', '双脚平行直立'],
  },
]

const CONDITIONAL_POSES: ReadonlyArray<PantsPoseCard> = [
  {
    id: 'conditional-side-pocket',
    view: 'side',
    label: '条件动作：单手插侧袋',
    hand: '只有主图或对应角度裤子参考清楚存在可用侧袋时才允许插袋；否则改为双手分别自然搭在腰间两侧',
    legs: '采用当前方向的稳定站姿，不为插袋改变裤型',
    condition: 'pocket',
  },
  {
    id: 'conditional-back-pocket',
    view: 'back',
    label: '条件动作：单手插后袋',
    hand: '只有背面参考清楚存在后袋时才允许插后袋；没有后袋必须改为一手轻扶后腰、另一手收在身后',
    legs: '双脚平行或前后小幅错开，保持背面为主要可见面',
    condition: 'pocket',
  },
  {
    id: 'conditional-main-prop',
    view: 'front',
    label: '条件动作：托举或手持主图物件',
    hand: '只有图1主图清楚存在对应物件时才可保持同一物件；主图没有则不得新增',
    legs: '采用正面稳定站姿，裤长和裤脚状态按主图',
    condition: 'main-prop',
  },
  {
    id: 'conditional-scene-support',
    view: 'side',
    label: '条件动作：手搭已有台面',
    hand: '只有图1场景本来存在可倚靠台面时才可使用；否则只学习手肘方向，不新增台面',
    legs: '双脚前后小幅错开并稳定落地',
    condition: 'scene-support',
  },
  {
    id: 'conditional-head-action',
    view: 'front',
    label: '条件动作：撩发、扶额或扶头',
    hand: '裤子模式默认不输出头脸发型，只能学习手臂抬起方向；不得补出头发、发饰或更高上半身范围',
    legs: '采用正面稳定站姿，画面上下边界按主图',
    condition: 'head-visible',
  },
  {
    id: 'conditional-double-front-pocket',
    view: 'front',
    label: '条件动作：双手插正面两侧口袋',
    hand: '只有正面参考清楚存在左右可用口袋时才允许双手插袋；任一侧证据不足都改为双臂低位交叉或双手收在身后，禁止双手同时自然下垂',
    legs: '双脚平行窄站或与肩同宽站立，不为插袋动作改变裤型',
    condition: 'pocket',
  },
  {
    id: 'conditional-pocket-one-raised',
    view: 'side',
    label: '条件动作：单手插袋另一手轻抬',
    hand: '只有当前可见面清楚存在可用口袋时才允许单手插袋；另一手只能在主图边界内轻抬，口袋证据不足时双手都改为安全低位动作',
    legs: '采用当前方向前后脚小幅错开的稳定站姿',
    condition: 'pocket',
  },
  {
    id: 'conditional-main-accessory-interaction',
    view: 'front',
    label: '条件动作：保持并互动主图已有随身物',
    hand: '只有图1已有水杯、包带或其它随身物时才可保持同一物件和原数量进行低幅度互动；图1没有时不得新增',
    legs: '采用正面或正面微侧稳定站姿，不让随身物遮挡裤身',
    condition: 'main-prop',
  },
  {
    id: 'conditional-elevated-foot-support',
    view: 'side',
    label: '条件动作：脚踩已有台阶或低位支撑',
    hand: '手部使用当前方向的安全低位动作，不为腿部姿势新增栏杆、椅子或台面',
    legs: '只有图1场景已有台阶或低位支撑且不改变构图时，才允许一脚踩原有支撑、另一脚稳定落地；否则改为普通前后脚站姿',
    condition: 'scene-support',
  },
]

export const PANTS_POSE_LIBRARY: ReadonlyArray<PantsPoseCard> = [
  ...FRONT_POSES,
  ...buildSidePoses('left'),
  ...buildSidePoses('right'),
  ...BACK_POSES,
  ...SUPPORT_POSES,
  ...CONDITIONAL_POSES,
]

export const PANTS_MAIN_EVIDENCE_RULE =
  '主图证据规则：图1中的上衣、鞋子、包、花束、帽子、首饰、手表、发饰、其它随身物和主图边界内已有发丝都属于条件保留内容。图1清楚存在时保持同款、同数量并随人物转向合理呈现；图1没有时不新增。上衣款式、颜色、图案、袖长、袖口和实际可见范围始终严格跟随图1，不因露手姿势改变。图1是否露出手部也属于构图硬证据：默认按图1不露手处理，只有图1清楚露出手部时才允许生成手部；图1完全不露手时所有镜头都必须让双手、手掌和手指完全不出现在画面。角度变化造成的自然部分遮挡可以接受，但不能换款、凭空增加或让裤子细节图污染这些内容。主图边界内若只有少量发丝，只保持原发色和相近可见范围，不扩展成完整发型，不新增挑染。'

export const PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN =
  '禁止双臂伸直贴近身体两侧、两只手同时垂在大腿外侧；也禁止手臂或手掌贴着裤缝、贴着大腿外侧、贴压裤面；单手自然下垂只允许与另一只手的明确动作组合，并且必须远离裤缝和裤面。'

export const PANTS_FORBIDDEN_SIDE_HAND_SEAM =
  '侧面镜头禁止手臂竖直贴着裤缝、手掌贴在大腿外侧或手指沿侧缝向下；侧面可使用真实侧袋互动并由另一手搭腰、单手搭腰且另一手完全隐藏、双手分别搭腰、双手完全不出现，或双手在身前低位自然靠近但与裤面保留明显空隙且不遮挡商品。'

export const PANTS_FORBIDDEN_BACK_HANDS_CLASPED =
  '背面镜头禁止双手在后腰低位交握、双腕靠拢或两只前臂从身体两侧斜插到后腰中间；背面改用双手分别搭在左右腰侧，或双臂与双手都被躯干完整遮挡。'

export const PANTS_FORBIDDEN_LOW_FRONT_HANDS =
  '双手在身前低位轻叠、轻靠或松散相扣可以出现，但必须与腰头、裆部和裤面保留明显可见空隙，不能贴压、覆盖或遮挡裤子；只禁止双手低位紧贴裤面或挡住商品结构。'

export const PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN_PATTERN =
  /双手(?:自然)?垂落|双臂(?:自然)?垂落|双手同时(?:自然)?下垂|两只手同时(?:自然)?下垂|手臂.*贴(?:着)?裤|手掌.*贴(?:着)?裤|贴(?:着)?裤缝/

export function getPantsPoseCardById(id: string): PantsPoseCard {
  const card = PANTS_POSE_LIBRARY.find((candidate) => candidate.id === id)
  if (!card) {
    throw new Error(`未知裤子姿势卡：${id}`)
  }
  return card
}

/**
 * 返回指定方向的所有非条件姿势卡。
 * 后端确定性去重闸门使用：当 LLM 选了重复轮廓的卡时，从这里找替代卡。
 * 条件姿势（需要口袋/道具/头发等证据）不纳入自动替换池。
 */
export function getPantsPoseLibraryForView(
  view: PantsPoseView,
): ReadonlyArray<PantsPoseCard> {
  return PANTS_POSE_LIBRARY.filter(
    (card) =>
      (card.view === view ||
        (view === 'left' && card.view === 'side') ||
        (view === 'right' && card.view === 'side')) &&
      !card.condition,
  )
}

export interface PantsPoseVisibility {
  visualFamily: PantsPoseVisualFamily
  mustShow: string
  mustNotLookLike: string[]
}

export function getPantsPoseVisibility(card: PantsPoseCard): PantsPoseVisibility {
  const fallback = inferPantsPoseVisibility(card)
  return {
    visualFamily: card.visualFamily ?? fallback.visualFamily,
    mustShow: card.mustShow ?? fallback.mustShow,
    mustNotLookLike: card.mustNotLookLike ?? fallback.mustNotLookLike,
  }
}

export function getPantsPoseVisualFamily(card: PantsPoseCard): PantsPoseVisualFamily {
  return getPantsPoseVisibility(card).visualFamily
}

export type PantsPoseTier = 'strong' | 'weak'

const STRONG_PANTS_VISUAL_FAMILIES: ReadonlySet<PantsPoseVisualFamily> =
  new Set<PantsPoseVisualFamily>([
    'cross-step',
    'chair-knee-bend',
    'knee-bend',
    'walking',
    'toe-point',
    'arms-crossed',
    'hands-hidden',
    'side-reach',
    'step-height',
    'toe-in',
    'toe-out',
    'v-toe',
    'staggered-v',
    'heel-touch-toe-up',
  ])

const HAND_DEPENDENT_FAMILIES: ReadonlySet<PantsPoseVisualFamily> =
  new Set<PantsPoseVisualFamily>([
    'arms-crossed',
    'hands-hidden',
    'side-reach',
  ])

export function isPantsHandDependentVisualFamily(
  visualFamily: PantsPoseVisualFamily,
): boolean {
  return HAND_DEPENDENT_FAMILIES.has(visualFamily)
}

/**
 * 姿势强弱分级：强族一眼可辨、不易塌缩；弱族（staggered/weight-shift/parallel/
 * open-triangle/front-foot-lift/wide-stance）容易被模型渲染成普通站姿。所有受控
 * 支撑物姿势一律视为强族。抽卡时同方向优先强族，强族不足才用弱族兜底。
 *
 * 主图不露手模式下，arms-crossed/hands-hidden/side-reach 的核心差异依赖手部动作，
 * 手被隐藏后退化成站立，因此降为弱族。
 */
export function getPantsPoseTier(
  card: PantsPoseCard,
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
): PantsPoseTier {
  if (card.support) return 'strong'
  const family = getPantsPoseVisualFamily(card)
  if (!STRONG_PANTS_VISUAL_FAMILIES.has(family)) return 'weak'
  if (
    mainHandVisibility === 'hidden' &&
    isPantsHandDependentVisualFamily(family)
  ) {
    return 'weak'
  }
  return 'strong'
}

function inferPantsPoseVisibility(card: PantsPoseCard): PantsPoseVisibility {
  const id = card.id
  if (/heel-touch-toe-up/.test(id)) {
    return {
      visualFamily: 'heel-touch-toe-up',
      mustShow:
        '一脚脚后跟点地，脚尖翘起约5-8cm，脚踝上抬角度清楚可见，必须和脚尖点地相反',
      mustNotLookLike: ['脚尖点地', '前脚掌点地', '普通全脚掌落地'],
    }
  }
  if (/staggered-v/.test(id)) {
    return {
      visualFamily: 'staggered-v',
      mustShow:
        '一脚在前约15cm，前脚脚尖向外打开，后脚脚尖朝前或微外八，两脚形成前后V形而不是普通前后错步',
      mustNotLookLike: ['普通前后脚错开', '双脚平行站立', '大步斜伸腿'],
    }
  }
  if (/v-toe/.test(id)) {
    return {
      visualFamily: 'v-toe',
      mustShow:
        '两脚脚跟距离较近，两个脚尖向外打开成浅V形，双脚全脚掌落地且重心居中',
      mustNotLookLike: ['大外八宽站', '前后脚错步', '脚尖点地'],
    }
  }
  if (/toe-in/.test(id)) {
    return {
      visualFamily: 'toe-in',
      mustShow:
        '两脚脚尖轻微向内扣约8°-10°，双脚全脚掌落地，膝盖自然靠近但不交叉',
      mustNotLookLike: ['交叉腿', '脚尖外八', '普通脚尖朝前站立'],
    }
  }
  if (/toe-out/.test(id)) {
    return {
      visualFamily: 'toe-out',
      mustShow:
        '两脚脚尖轻微向外打开约10°-15°，双脚全脚掌落地，脚后跟完整贴地',
      mustNotLookLike: ['大宽站', '脚尖内扣', '普通脚尖朝前站立'],
    }
  }
  if (/cross-step/.test(id)) {
    return {
      visualFamily: 'cross-step',
      mustShow:
        '交叉腿大腿必须清楚越过支撑腿中线，膝盖弯曲角度在画面中部可见，前后两腿形成可见交叉关系，而不是普通前后脚站立',
      mustNotLookLike: [
        '普通侧面行走停顿',
        '双脚平行前后站',
        '轻微错步但没有交叉',
      ],
    }
  }
  if (/knee-lift|knee|屈膝/.test(id)) {
    const view = card.view
    const mustShow =
      view === 'front'
        ? '从正面看，非支撑腿膝盖明显弯曲约30°，膝盖位置低于站立状态，弯曲角度从正面画面中部可见，点地腿向画面前方伸出'
        : view === 'back'
          ? '从背面看，非支撑腿膝盖明显弯曲约30°，弯曲腿向画面后方伸出，膝盖高低差从背面轮廓可见'
          : '从侧面看，非支撑腿膝盖明显弯曲约30°，膝盖位置低于站立状态，弯曲角度从侧面轮廓中部可见，点地腿向画面侧方伸出'
    return {
      visualFamily: 'knee-bend',
      mustShow,
      mustNotLookLike: ['普通侧面行走', '双腿直立', '仅前后脚轻微错开'],
    }
  }
  if (/front-foot-lift/.test(id)) {
    return {
      visualFamily: 'front-foot-lift',
      mustShow:
        '前脚脚掌抬起约5cm，脚踝角度变化在画面中部可见，脚后跟仍贴地，和普通迈步停顿区分开',
      mustNotLookLike: ['普通前后脚站立', '行走后脚蹬地', '脚尖点地'],
    }
  }
  if (/walking|walk/.test(id)) {
    const view = card.view
    const mustShow =
      view === 'front'
        ? '从正面看，一脚明显抬起离地约8cm，另一脚全掌承重，两腿步幅差约30cm，行走停顿瞬间从正面可见'
        : view === 'back'
          ? '从背面看，一脚明显抬起离地约8cm，另一脚全掌承重，两腿步幅差约30cm，行走停顿瞬间从背面轮廓可见'
          : '从侧面看，一脚明显抬起离地约8cm，另一脚全掌承重，两腿步幅差约30cm，行走停顿瞬间从侧面轮廓清楚可见'
    return {
      visualFamily: 'walking',
      mustShow,
      mustNotLookLike: ['静态前后脚站姿', '双脚都完整贴地', '交叉步'],
    }
  }
  if (/toe-point|light-thigh-touch|one-raised-one-waist/.test(id)) {
    const view = card.view
    const mustShow =
      view === 'front'
        ? '从正面看，一脚脚尖向画面前方点地，膝盖弯曲约30°，支撑腿与点地腿的高低差从正面可见，脚后跟离地约10cm'
        : view === 'back'
          ? '从背面看，一脚脚尖向画面后方点地，脚后跟离地约10cm从背面可见，支撑腿承重关系从背面轮廓能看出'
          : '从侧面看，小腿向前倾斜角度从侧面轮廓可见，膝盖弯曲约30°，支撑腿与点地腿形成明显高低差，脚后跟离地约10cm'
    return {
      visualFamily: 'toe-point',
      mustShow,
      mustNotLookLike: ['双脚都完整落地', '普通前后脚错开', '行走后脚蹬地'],
    }
  }
  if (/one-waist-one-behind/.test(id)) {
    return {
      visualFamily: 'open-triangle',
      mustShow:
        '前脚向侧前方伸出约30cm，大腿前后错开关系在画面中部可见，双腿形成开放三角轮廓，不能缩成普通前后脚站位',
      mustNotLookLike: ['纯侧面直立', '普通前后脚错开', '交叉步'],
    }
  }
  if (/side-reach/.test(id)) {
    return {
      visualFamily: 'side-reach',
      mustShow:
        '双脚前后错开且重心稳定，若手部允许出现则一臂向画面侧边舒展，整体轮廓比普通侧站更打开',
      mustNotLookLike: ['普通纯侧站', '行走停顿', '双手搭腰前后脚站'],
    }
  }
  if (/arms-crossed|low-arms-folded/.test(id)) {
    return {
      visualFamily: 'arms-crossed',
      mustShow:
        '腿部保持稳定平行或前后错开，同时上半身轮廓应呈现交叉抱臂或收紧的肩肘关系；主图不露手时至少保持稳定平行腿型',
      mustNotLookLike: ['低位双手离裤动作', '侧面行走', '脚尖点地'],
    }
  }
  if (/hands-behind|hands-hidden/.test(id)) {
    return {
      visualFamily: 'hands-hidden',
      mustShow:
        '双手完全被躯干遮挡，腿部保持平行或稳定错步，画面不能出现低位手掌或贴裤手臂',
      mustNotLookLike: ['双手低位叠放', '手掌贴裤缝', '交叉抱臂'],
    }
  }
  if (/wide|shoulder-width/.test(id)) {
    return {
      visualFamily: 'wide-stance',
      mustShow:
        '双脚距离约40cm明显宽于窄站，左右脚稳定分开，重心居中',
      mustNotLookLike: ['窄站', '交叉步', '前后脚迈步'],
    }
  }
  if (/weight|front-step/.test(id)) {
    return {
      visualFamily: 'weight-shift',
      mustShow:
        '重心明显落在后脚或一侧支撑腿，髋部和膝部状态在画面中部能看出重心变化，另一腿轻松错开',
      mustNotLookLike: ['双脚平均承重', '平行直立', '普通侧面行走'],
    }
  }
  if (/parallel|pure-side-staggered|both-hands-waistband/.test(id)) {
    return {
      visualFamily: 'parallel',
      mustShow:
        '双腿保持清楚的平行或纵向纯侧面站位，膝盖状态在画面中部可见，不能像正在行走',
      mustNotLookLike: ['行走停顿', '脚尖点地', '交叉步'],
    }
  }
  return {
    visualFamily: 'staggered',
    mustShow:
      '前后脚关系必须清楚可见，至少在站距、膝部状态、脚掌落点或重心里呈现两项差异，膝盖弯曲角度在画面中部可见',
    mustNotLookLike: ['双脚平行直立', '普通侧面行走', '同款前后脚站位'],
  }
}

export interface PantsPoseInstructionOptions {
  mainHandVisibility?: PantsMainHandVisibility
}

const PANTS_LOWER_BODY_PRODUCT_FRAME_RULE =
  '下半身商品图模式：图1如果只上传腰胯以下或下半身局部，输出必须保持同类下半身裁切；主体限定为腰胯、裤身、膝盖、小腿、脚踝、鞋子和图1边界内已有上衣局部；不要扩展成完整人像，不要根据人体常识补齐画面外身体结构。'

function getPantsNoHandVisibility(
  visibility: PantsPoseVisibility,
): PantsPoseVisibility {
  if (visibility.visualFamily === 'side-reach') {
    return {
      ...visibility,
      mustShow:
        '双脚前后错开且重心稳定，膝盖状态和脚掌落点清楚可见，整体腿部轮廓比普通侧站更打开',
      mustNotLookLike: ['普通纯侧站', '行走停顿', '普通前后脚站'],
    }
  }
  if (visibility.visualFamily === 'arms-crossed') {
    return {
      ...visibility,
      mustShow:
        '腿部保持稳定平行或前后错开，膝盖状态和脚掌落点清楚可见',
      mustNotLookLike: ['普通侧面行走', '脚尖点地', '低位杂乱站姿'],
    }
  }
  if (visibility.visualFamily === 'hands-hidden') {
    return {
      ...visibility,
      mustShow:
        '腿部保持平行或稳定错步，脚掌落点和膝盖状态清楚可见',
      mustNotLookLike: ['普通前后脚站', '交叉步', '双脚杂乱错位'],
    }
  }
  return visibility
}

export function buildPantsAssignedPoseInstruction(
  card: PantsPoseCard,
  options: PantsPoseInstructionOptions = {},
): string {
  const visibility = getPantsPoseVisibility(card)
  const mainHandVisibility = options.mainHandVisibility ?? 'hidden'
  const supportText = card.support
    ? `支撑物：${card.support.prompt}。`
    : ''
  const sideLegInstruction = buildPantsSideFootBindingRule(card, visibility.visualFamily)
  const legInstruction = sideLegInstruction || card.legs
  const sideLegSourceRule = sideLegInstruction
    ? '侧面腿脚以上述左脚/右脚句为唯一脚位，不再按姿势卡原文里的前腿、后腿或支撑脚另作相反解释。'
    : ''
  const directionHandRule =
    card.view === 'back'
      ? '背面手部采用本卡候选里的左右腰侧搭放或躯干遮挡方案，后片商品区域保持清楚。'
      : card.view === 'left' || card.view === 'right' || card.view === 'side'
        ? '侧面手部采用本卡候选里的搭腰、隐藏、真实口袋证据互动或离裤低位方案，手臂与裤面保持自然可见间距。'
        : '正面手部采用本卡候选里的抱臂、搭腰、隐藏或离裤低位方案，腰头、裆部和裤身主要区域保持清楚。'
  if (mainHandVisibility === 'hidden') {
    const label = card.noHandLabel ?? derivePantsNoHandLabel(card)
    const noHandVisibility = getPantsNoHandVisibility(visibility)
    return `指定姿势：${label}。腿部必须是“${legInstruction}”。${sideLegSourceRule}${supportText}肉眼可见差异点：${noHandVisibility.mustShow}。禁止退化为：${noHandVisibility.mustNotLookLike.join('、')}。${PANTS_LOWER_BODY_PRODUCT_FRAME_RULE}`
  }
  return `指定姿势卡 ${card.id}（${card.label}）：手部候选是“${card.hand}”；腿部必须是“${legInstruction}”。${sideLegSourceRule}${supportText}视觉动作族：${visibility.visualFamily}。肉眼可见差异点：${visibility.mustShow}。禁止退化为：${visibility.mustNotLookLike.join('、')}。主图露手模式：图1露出的手部数量、手臂可见范围、上衣袖长、袖口和上衣款式必须保持一致，只在不改变上衣和商品结构的前提下执行本卡手部候选。${directionHandRule}同一人物保持两条手臂、两只手的真实人体结构，肩膀、手肘、手腕和手掌连接自然。`
}

function buildPantsSideFootBindingRule(
  card: PantsPoseCard,
  visualFamily: PantsPoseVisualFamily,
): string {
  if (card.view !== 'left' && card.view !== 'right') return ''

  const isLeft = card.view === 'left'
  const leftText = (text: string) => `身体保持左侧镜头；${text}两腿结构自然、不穿模、不多腿，禁止生成与任何右侧镜头左右翻转的同款腿型、同脚位和同步幅。`
  const rightText = (text: string) => `身体保持右侧镜头；${text}两腿结构自然、不穿模、不多腿，禁止生成与任何左侧镜头左右翻转的同款腿型、同脚位和同步幅。`

  if (visualFamily === 'walking') {
    return isLeft
      ? leftText('左脚在画面前方全脚掌落地承重，右脚在画面后方脚尖蹬地，右脚跟抬起约8cm，两脚前后距离约30cm。')
      : rightText('右脚在画面前方全脚掌落地承重，左脚在画面后方脚尖蹬地，左脚跟抬起约8cm，两脚前后距离约30cm。')
  }

  if (visualFamily === 'toe-point') {
    if (/front-toe-point-long-line/.test(card.id)) {
      return isLeft
        ? leftText('右脚全脚掌落地承担主要重心，左腿向画面侧前方伸出约30cm，左膝弯曲约30°，仅左脚前脚掌和脚尖点地，左脚跟离地约10cm。')
        : rightText('左脚全脚掌落地承担主要重心，右腿向画面侧前方伸出约30cm，右膝弯曲约30°，仅右脚前脚掌和脚尖点地，右脚跟离地约10cm。')
    }
    return isLeft
      ? leftText('右脚全脚掌落地承重且右脚跟贴地，左腿向后撤约25cm，仅左脚脚尖点地，左脚跟离地约10cm，左膝弯曲约30°。')
      : rightText('左脚全脚掌落地承重且左脚跟贴地，右腿向前迈出约25cm，仅右脚脚尖点地，右脚跟离地约10cm，右膝弯曲约30°。')
  }

  if (visualFamily === 'knee-bend') {
    return isLeft
      ? leftText('右脚全脚掌落地承重，左腿在身体前侧小幅屈膝，左膝弯曲约30°，仅左脚脚尖点地，左脚跟离地约10cm。')
      : rightText('左脚全脚掌落地承重，右腿在身体后侧小幅屈膝，右膝弯曲约30°，仅右脚脚尖点地，右脚跟离地约10cm。')
  }

  if (visualFamily === 'front-foot-lift') {
    return isLeft
      ? leftText('右脚在身体正下方全脚掌落地承重，左脚位于画面前方约22cm，左脚后跟贴地，左前脚掌抬离地面约5cm，左膝只微弯约10°，不要形成脚尖点地或大步斜伸。')
      : rightText('左脚在身体正下方全脚掌落地承重，右脚位于画面前方约22cm，右脚后跟贴地，右前脚掌抬离地面约5cm，右膝只微弯约10°，不要形成脚尖点地或大步斜伸。')
  }

  if (visualFamily === 'heel-touch-toe-up') {
    return isLeft
      ? leftText('右脚全脚掌落地承重，左脚位于画面前方约15-20cm，左脚脚后跟点地，左脚脚尖翘起约5-8cm，左脚踝上抬角度清楚可见；不要画成脚尖点地或前脚掌点地。')
      : rightText('左脚全脚掌落地承重，右脚位于画面前方约15-20cm，右脚脚后跟点地，右脚脚尖翘起约5-8cm，右脚踝上抬角度清楚可见；不要画成脚尖点地或前脚掌点地。')
  }

  if (visualFamily === 'toe-out') {
    return isLeft
      ? leftText('左脚和右脚都在身体正下方全脚掌落地，双脚前后距离不超过12cm，左脚和右脚脚尖都轻微向画面外侧打开约10°-12°，脚后跟完整贴地；不要画成一条腿向外斜伸。')
      : rightText('右脚和左脚都在身体正下方全脚掌落地，双脚前后距离不超过12cm，右脚和左脚脚尖都轻微向画面外侧打开约10°-12°，脚后跟完整贴地；不要画成一条腿向外斜伸。')
  }

  if (visualFamily === 'staggered-v') {
    return isLeft
      ? leftText('右脚在身体重心下方全脚掌落地，左脚在画面前方约15cm，左脚脚尖向画面外侧打开约12°，两只脚后跟都贴地，双腿保持紧凑小V脚位；不要变成大步斜伸。')
      : rightText('左脚在身体重心下方全脚掌落地，右脚在画面前方约15cm，右脚脚尖向画面外侧打开约12°，两只脚后跟都贴地，双腿保持紧凑小V脚位；不要变成大步斜伸。')
  }

  if (visualFamily === 'chair-knee-bend') {
    return isLeft
      ? leftText('右脚全脚掌落地承重，左腿靠近透明金属椅子低横杆屈膝约45°，左脚脚尖或左小腿必须与椅子低横杆清楚接触，左脚跟离地约12cm，椅子只露必要边缘且不遮挡裤身主体。')
      : rightText('左脚全脚掌落地承重，右腿靠近透明金属椅子低横杆屈膝约45°，右脚脚尖或右小腿必须与椅子低横杆清楚接触，右脚跟离地约12cm，椅子只露必要边缘且不遮挡裤身主体。')
  }

  if (visualFamily === 'cross-step') {
    return isLeft
      ? leftText('右脚全脚掌落地承重，左腿向画面前内侧跨出约25cm，左膝弯曲约30°，仅左脚脚尖点地，左大腿清楚越过右腿中线但不扭曲。')
      : rightText('左脚全脚掌落地承重，右腿向画面前内侧跨出约25cm，右膝弯曲约30°，仅右脚脚尖点地，右大腿清楚越过左腿中线但不扭曲。')
  }

  if (visualFamily === 'step-height') {
    return isLeft
      ? leftText('左脚踩在白色极简低台阶上并全脚掌落地，右脚在地面向后错开约25cm，右脚跟完整落地，双腿高低差约15cm。')
      : rightText('右脚踩在白色极简低台阶上并全脚掌落地，左脚在地面向后错开约25cm，左脚跟完整落地，双腿高低差约15cm。')
  }

  if (visualFamily === 'open-triangle') {
    return isLeft
      ? leftText('右脚在身体重心下方全脚掌落地承重，左脚向画面侧前方打开约35cm并全脚掌落地，左膝微弯约15°，两膝之间保留清楚空隙，双腿形成稳定开放三角；禁止缩成普通小错步。')
      : rightText('左脚在身体重心下方全脚掌落地承重，右脚向画面侧前方打开约35cm并全脚掌落地，右膝微弯约15°，两膝之间保留清楚空隙，双腿形成稳定开放三角；禁止缩成普通小错步。')
  }

  if (visualFamily === 'arms-crossed') {
    return isLeft
      ? leftText('左脚和右脚都在身体正下方全脚掌落地，双脚前后距离不超过10cm，左右脚脚跟都贴地，双膝基本伸直仅自然放松；画面里不能出现一条腿向外斜伸。')
      : rightText('右脚和左脚都在身体正下方全脚掌落地，双脚前后距离不超过10cm，左右脚脚跟都贴地，双膝基本伸直仅自然放松；画面里不能出现一条腿向外斜伸。')
  }

  if (visualFamily === 'hands-hidden') {
    return isLeft
      ? leftText('右脚全脚掌稳稳落在身体重心下方，左脚在画面前方约18cm全脚掌落地，左右脚脚后跟都贴地，双膝自然微弯约10°；保持紧凑站姿，不要形成大幅斜伸腿。')
      : rightText('左脚全脚掌稳稳落在身体重心下方，右脚在画面前方约18cm全脚掌落地，左右脚脚后跟都贴地，双膝自然微弯约10°；保持紧凑站姿，不要形成大幅斜伸腿。')
  }

  if (visualFamily === 'side-reach') {
    return isLeft
      ? leftText('右脚在身体重心下方全脚掌落地，左脚向画面前方错开约20cm并全脚掌落地，双脚脚后跟都贴地，双膝微弯约10°，站距中等且不要变成一腿长线斜伸。')
      : rightText('左脚在身体重心下方全脚掌落地，右脚向画面前方错开约20cm并全脚掌落地，双脚脚后跟都贴地，双膝微弯约10°，站距中等且不要变成一腿长线斜伸。')
  }

  if (visualFamily === 'parallel') {
    return isLeft
      ? leftText('左脚和右脚都在身体正下方全脚掌落地，双脚前后距离不超过12cm，左右脚脚后跟完整贴地，膝盖自然微弯不锁死；不要画成一条腿向外斜伸。')
      : rightText('右脚和左脚都在身体正下方全脚掌落地，双脚前后距离不超过12cm，左右脚脚后跟完整贴地，膝盖自然微弯不锁死；不要画成一条腿向外斜伸。')
  }

  if (visualFamily === 'staggered') {
    return isLeft
      ? leftText('右脚稳定承重，左脚向画面前方或侧前方错开约25cm并全脚掌落地，左右脚脚后跟都贴地，膝盖自然微弯。')
      : rightText('左脚稳定承重，右脚向画面后方或侧后方错开约25cm并全脚掌落地，左右脚脚后跟都贴地，膝盖自然微弯。')
  }

  return isLeft
    ? leftText('左脚和右脚必须明确区分前后位置、承重关系、脚掌落点和膝盖状态，至少写实呈现两项可见差异。')
    : rightText('右脚和左脚必须明确区分前后位置、承重关系、脚掌落点和膝盖状态，至少写实呈现两项可见差异。')
}

function derivePantsNoHandLabel(card: PantsPoseCard): string {
  return card.label
    .replace(/交叉抱臂|抱臂|双手分别搭腰|双手搭腰|单手搭腰|单臂侧展搭腰|双手轻扶腰头|双手轻展腰头|单手轻捏腰头|双手自然搭腰|双手收于身后|一手扶后腰一手收后|单臂轻抬扶后腰|双手轻扶后腰|单手扶后腰|手扶|轻扶|插袋|搭腰|手/g, '')
    .replace(/姿势卡/g, '姿势')
    .replace(/站姿$/, '站姿')
    .replace(/^\s+|\s+$/g, '') || `${getPantsPoseViewLabel(card.view)}腿脚姿势`
}

export const PANTS_POSE_HISTORY_PATTERNS: ReadonlyArray<
  readonly [RegExp, string]
> = [
  [/交叉抱臂|双臂交叉|交叉抱胸/, '交叉抱臂'],
  [/双手自然垂落|双手垂落|双臂垂落/, '双手自然垂落'],
  [/单手.*(?:搭腰|叉腰|腰胯|后腰)/, '单手搭腰'],
  [/双手.*(?:捏|扶|提).*腰头|双手.*裤腰/, '双手轻扶腰头'],
  [/单手.*(?:捏|扯|扶|提).*腰头/, '单手轻扶腰头'],
  [/轻扶.*腰侧|轻扶.*后腰|腰头.*两侧|后腰.*两侧/, '轻扶腰侧/后腰'],
  [/环抱.*小腹|双手环抱/, '双手环抱小腹'],
  [/插.*(?:口袋|裤袋|侧袋|后袋)|插袋/, '条件式插袋动作'],
  [/双手.*(?:身后|背后)|双手背于身后|双手收在身后/, '双手收于身后'],
  [/反手.*后腰|反向.*后腰/, '反手搭后腰'],
  [/向.*侧边.*伸展|单臂侧展|五指.*张开/, '单臂侧展'],
  [/轻触.*裤腿|轻触.*大腿外侧|悬停.*裤|裤.*悬停/, '侧手悬停/轻触裤腿'],
  [/双脚.*平行|平行站姿|并排平放/, '双脚平行站姿'],
  [/前后脚.*错开|双脚前后|前腿.*前伸/, '前后脚错开站姿'],
  [/重心.*后脚|后脚承重|后腿.*承重/, '重心后移'],
  [/脚尖点地|前脚掌触地|脚后跟.*抬起/, '脚尖点地'],
  [/行走|迈步|蹬地|手臂.*摆动/, '行走动态'],
  [/屈膝|抬腿/, '小幅屈膝抬腿'],
]

export function getPantsPoseViewLabel(view: PantsPoseView): string {
  if (view === 'front') return '正面'
  if (view === 'left') return '左侧'
  if (view === 'right') return '右侧'
  if (view === 'back') return '背面'
  return '侧面'
}

export function getPantsPoseDirectionRule(view: PantsPoseView): string {
  if (view === 'front') {
    return '正面是主要可见面；允许正面微左或正面微右0°-15°，但不能变成明确侧面或背面。'
  }
  if (view === 'left') {
    return '左侧是主要可见面；允许左侧30°、60°、90°角度族及15°范围内变化，最高不超过95°，但不能变成右侧、纯正面或纯背面。鞋尖、膝盖、裤侧缝和裤腿外轮廓整体朝画面左侧；不能靠把正面或右腿 logo 换到左侧来制造差异，没有左侧证据的图案应不可见或仅在边缘窄幅出现。'
  }
  if (view === 'right') {
    return '右侧是主要可见面；允许右侧30°、60°、90°角度族及15°范围内变化，最高不超过95°，但不能变成左侧、纯正面或纯背面。鞋尖、膝盖、裤侧缝和裤腿外轮廓整体朝画面右侧；不能靠把正面或左腿 logo 换到右侧来制造差异，没有右侧证据的图案应不可见或仅在边缘窄幅出现。'
  }
  if (view === 'back') {
    return '背面是主要可见面；允许背面微左或背面微右0°-15°，但不能变成正面，侧面只能作为少量边缘。'
  }
  return '必须是明确侧面；可选择左侧或右侧约60°，允许45°-75°，但不能变成纯正面或纯背面。'
}

export function buildPantsPoseLibraryPrompt(): string {
  const viewOrder: PantsPoseView[] = ['front', 'left', 'right', 'back']
  const sections = viewOrder.map((view) => {
    const cards = PANTS_POSE_LIBRARY.filter(
      (card) => card.view === view && !card.condition,
    )
    return [
      `## ${getPantsPoseViewLabel(view)}姿势`,
      ...cards.map((card) => {
        const visibility = getPantsPoseVisibility(card)
        const support = card.support ? `；支撑物：${card.support.prompt}` : ''
        return `- ${card.id}｜${card.label}｜视觉族：${visibility.visualFamily}｜手部：${card.hand}；腿部：${card.legs}${support}；必须看出：${visibility.mustShow}`
      }),
    ].join('\n')
  })
  const conditional = CONDITIONAL_POSES.map(
    (card) =>
      `- ${card.id}｜${card.label}｜${card.hand}；${card.legs}`,
  ).join('\n')
  return [
    '# 裤子受控姿势卡库',
    PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN,
    '使用方式：每个 shotId 最终只能执行后端注入的一张唯一指定姿势卡；Planner 可阅读卡库理解方向和动作边界，但不能输出第二套动作，也不能把“相似姿势”写成替代方案。',
    '组合原则：不得在最终 imagePrompt 里混用其它姿势卡；差异必须来自当前姿势卡的视觉族、肉眼可见差异点、腿部动作、重心和脚掌落点，不能为了差异化改变主图裤长、裤型、裤脚宽度、人物比例或画面边界。',
    '受控支撑物：只有 10 张模式允许低频使用，整批最多 1-2 张；台阶、栏杆、台面必须是白色极简，椅子必须是透明金属椅子；背景、光线和相机距离仍跟随图1，只能出现一个指定支撑物，不能新增其它道具、家具、街景或复杂场景。',
    ...sections,
    '## 条件姿势',
    conditional,
    'Planner 不看图片，因此不得自行断言口袋、道具、头发或台面存在。条件姿势只能按其中的证据条件执行；无法确认时使用该卡写明的安全替代动作。不得把“工装口袋、阔腿裤、花边、后袋”等样例词当成商品事实。',
  ].join('\n')
}
