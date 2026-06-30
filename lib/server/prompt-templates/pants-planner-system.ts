import type { PhotoFissionResultCount } from '@/lib/types'
import {
  getPantsAngleLabel,
  getPantsReferenceAngleForView,
  getPantsShotReferenceSlots,
  type PantsDetailAvailability,
} from '@/lib/server/pants-reference-policy'
import {
  buildPantsPoseLibraryPrompt,
  getPantsPoseDirectionRule,
  getPantsPoseCardById,
  getPantsPoseLibraryForView,
  getPantsPoseTier,
  getPantsPoseVisibility,
  getPantsPoseVisualFamily,
  getPantsPoseViewLabel,
  hasPantsDangerousVisibleHandPlanText,
  isPantsHandDependentVisualFamily,
  PANTS_FORBIDDEN_BACK_HANDS_CLASPED,
  PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN,
  PANTS_FORBIDDEN_LOW_FRONT_HANDS,
  PANTS_FORBIDDEN_SIDE_HAND_SEAM,
  PANTS_MAIN_EVIDENCE_RULE,
  type PantsPoseCard,
  type PantsMainHandVisibility,
  type PantsPoseTier,
  type PantsPoseView,
  type PantsPoseVisualFamily,
} from './pants-pose-library'

export interface PantsShotBlueprint {
  label: string
  description: string
  view: PantsPoseView
  scene?: 'reference' | 'outdoor'
}

export const PANTS_CATEGORY_REQUIREMENT =
  `裤子品类规则：裤子是画面第一主体；画面上边缘、相机距离、人物大小、实际露出的上衣范围、背景和光线以图1主图为准，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐。裤子的穿着版型、宽松度、裤长基准、裤脚宽度和整体廓形以图1为准，不得为了展示脚或鞋而拉短裤长、提起裤腿或改造版型；最终腿脚站法由你从姿势卡库选择并写入 finalPrompt 的 POSITIVE PROMPT 段。【严禁复刻任何参考图姿势】用户上传的所有图片（主图、正面细节图、侧面细节图、背面细节图）都是同一个原始站姿的商品展示图，这些图只提供裤子外观、颜色、材质、图案、logo 等商品证据，绝不作为动作参考；你生成的每一张图都必须与这些参考图里的站姿有可见差异，生成一张和参考图姿势一模一样的图毫无意义。明确腿部动作可以带来符合真实物理规律的自然褶皱、裤脚高度投影、鞋子露出程度和鞋脚遮挡变化。正面、侧面和背面每个角度可上传0至2张商品细节图，每张都可能是完整角度图或局部放大图；细节图只锁定图中清楚可见的颜色、材质、纹理、logo、刺绣、贴布、拼接、口袋、裤脚或侧缝等商品证据，不控制腿脚姿势、身体朝向、构图边界、人物大小或完整裤身轮廓。右腿可见的 logo / 图案只能在右腿对应可见区域出现，左侧或背面没有证据就不生成；不得把任何 logo、刺绣、贴布、图案、拼接或口袋迁移到另一条腿、另一侧、背面或镜像位置。局部放大图只证明拍到的局部存在，不能扩展成其它面、另一条腿或整条裤子的结构。缺失图片直接跳过并重新编号，提示词不得提及。参考图中没有的商品元素不要新增。不能改成裙装、连衣裙、随机套装、紧身瑜伽裤或其它裤型。人物身体比例和腿长只按图1，不按品类标签改写。${PANTS_MAIN_EVIDENCE_RULE}`

export const PANTS_ACTION_CONTROL = [
  '【动作差异化铁律｜裤子】',
  `- ${PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN}`,
  `- ${PANTS_FORBIDDEN_BACK_HANDS_CLASPED}`,
  `- ${PANTS_FORBIDDEN_SIDE_HAND_SEAM}`,
  `- ${PANTS_FORBIDDEN_LOW_FRONT_HANDS}`,
  '- 主图不露手时（默认模式）：你不得在任何 shotId 的 pose 或其它字段中写任何手部、手臂、手掌、手指相关的描述词；pose 字段只写腿脚动作（站距、脚位、重心、膝盖弯曲、脚尖方向等），完全不提手；后端会自动注入 no hands 负向提示词确保生图模型不画手',
  '- 主图清楚露手时：才可按姿势卡使用自然手势，在 pose 字段中写入手部动作；上衣款式、颜色、图案、袖长、袖口和可见范围都必须与图1一致',
  '- 禁止一只前臂横停腰前同时另一只手绕到身后，也禁止反手绕后腰同时另一臂横穿身前；人物最多两条手臂、两只手，肩膀—手肘—手腕链条必须符合人体结构，不得出现身后幽灵手、多余手掌、手臂穿模或反关节',
  '- 每张图都要服务裤子商品展示，动作幅度克制自然，不遮挡裤身主要可见区域；腿脚姿势由你从姿势卡库选择并写入 finalPrompt 的 POSITIVE PROMPT 段；【严禁复刻任何参考图姿势】用户上传的主图、正面细节图、侧面细节图、背面细节图全部都是同一个原始站姿，这些图只提供商品证据不提供动作参考；你生成的每一张图都必须与所有参考图里的站姿有可见差异（如前后脚错开、脚尖外八内八、脚跟点地脚尖翘起、屈膝抬腿等），即使是主图裁切距离镜头也不得复制参考图站姿；生成一张和参考图姿势一模一样的图毫无意义，等于浪费一张裂变名额；不能改变裤长基准、版型或裤脚宽度，不能为了展示鞋而拉短或提起裤脚；允许明确腿部动作产生符合物理规律的自然褶皱、裤脚高度投影、鞋子露出程度和鞋脚遮挡变化',
  '- 正面、侧面和背面镜头只展示当前角度参考图中真实可见的裤子结构；不得把某种常见裤装结构当成必有结构写入提示词',
  '- 正面细节只约束正面可见商品局部，侧面细节只约束侧面可见商品局部，背面细节只约束背面可见商品局部；缺失的细节图不推测、不提及',
  '- 商品结构红线：logo、刺绣、贴布、图案、拼接、口袋和侧缝位置只能按参考图清楚可见证据复现；不能为了左右侧姿势变化而换腿、换面、镜像、补全或移动位置',
  '- 平铺图背景、吊牌、衣架、桌面纹理和额外褶皱不作为裤子图案或结构',
  '- 构图边界、画面上边缘、相机距离和人物大小与主图一致；裤脚、脚和鞋是否露出以及彼此遮挡多少由你选择的姿势和真实垂坠共同决定，不再完全复制主图站姿下的鞋脚遮挡，不要求脚或鞋完整展示',
  '- 胸口以上区域不进入画面，画面上边缘与主图上边缘对齐，上衣露出范围按主图',
  '- 每个 shotId 必须从姿势卡库选择一张姿势卡作为基础写入 poseCardId，并将该卡的姿势语义写进 finalPrompt 的 POSITIVE PROMPT 段；你可以在此基础上微调站距、脚位、重心、角度等细节来增加多样性，但不得违反安全规则（不蹲坐、不跪姿、不跳跃、不遮挡裤身）；不得完全脱离卡库自创与所有卡都无关的姿势',
  '- 不写蹲坐、跪姿、大幅跳跃、夸张扭胯或会遮挡裤身的道具互动；不要擅自写参考图未显示的人物属性、商品结构或互动方式',
  '- 【所有镜头姿势差异化】每一个镜头的 pose 字段都必须明确写出一个与参考图普通站姿不同的具体动作（如前后脚错开约20cm、脚尖外八约15°、脚跟点地脚尖翘起、屈膝抬腿、交叉步等），并在描述开头写明"参考图1的画面构图和视角，但腿脚姿势改为以下动作"；严禁任何镜头出现"双脚平行站立、重心居中、膝盖自然放松"等与参考图可能重复的通用站姿描述；用户上传的所有参考图都是同一个原始站姿，生成一张和参考图姿势一样的图毫无意义',
  '- 【禁止伪装站姿】以下描述等同于普通站姿，严禁出现在任何镜头的 pose 字段中："feet close together"、"feet under body"、"feet shoulder-width apart"、"both heels grounded"、"knees naturally relaxed"、"toes outward 10-15 degrees"、"parallel stance"、"standing naturally"；如果你写的姿势删掉手部动作后看起来和普通站立没有肉眼可见区别，那就是伪装站姿，必须重写',
  '- 【姿势可见差异量化标准】每个 pose 必须包含至少一项以下可见变化：(1)一只脚明显离开地面（脚尖点地、脚跟抬起、屈膝抬腿）；(2)两脚前后距离≥20cm的前后错步；(3)两脚左右距离≥30cm的宽站或分腿；(4)膝盖弯曲≥20°的屈膝；(5)交叉腿或一前一后的行走停顿步；只改脚尖外八角度10-15°、只改站距10cm以内、只改重心偏移而不伴随脚部位置变化，都不算可见差异',
  '- 左侧、右侧、正面和背面是不可跨越的方向家族；允许家族内部微前、标准、微后变化，但左侧不能变右侧或纯背面，右侧同理',
  '- 插袋、拉袋、插后袋等动作只有对应参考图清楚存在口袋时才成立；Planner 不看图，自动策划时必须采用安全替代手势，不得为动作创造口袋',
  '- 托物、持物、撩发、扶头仍只保留为条件姿势灵感；主图没有对应物件、头发范围时不能新增。台阶、栏杆、椅子、台面只允许通过姿势卡库中明确存在的受控支撑物姿势低频出现，不能自行新增或改款',
  '- 受控支撑物只允许四类：白色极简台阶、白色极简栏杆/扶手、透明金属椅子、白色极简台面；2 张和 4 张模式默认不用，10 张最多 1-2 张，且白色台阶和透明椅子都属于支撑物抬腿型，同批最多出现其中 1 张；背景、光线和相机距离仍跟随图1，除指定支撑物外不新增其它道具、家具、街景或复杂场景',
  '- 同一批按腿部动作族控制次数：脚尖点地最多 3 次；交叉步、椅子屈膝、台阶高低脚、行走停顿、普通屈膝各最多 1 次；正面小幅前后脚错步最多 1 张；正面轻内八、轻外八、浅V脚尖、前后V形和脚后跟点地脚尖翘起都属于轻脚位弱差异，同批正面最多 1 张；侧面普通前后错步、开放三角、全掌错步、脚尖点地和前脚掌抬起若肉眼都像一腿直立一腿斜伸，也统一最多 1 张；侧面无支撑物的全掌小错步最多 1 张',
  '- 侧面镜头还要按肉眼腿型轮廓去重：凡是一脚承重、另一条腿斜向伸出或普通前后错步的轮廓，都算同一类侧面斜腿轮廓；同一批侧面最多 1 张，不得用姿势名称、左右镜像、脚尖/全掌差异或微小站距差异伪装成新姿势',
  '- 【左右镜像禁止铁律】左侧 3 张和右侧 3 张必须使用完全不同的腿部动作族，绝不允许出现左右镜像版（例如左侧用 compact-toe-out，右侧就不能用 compact-toe-out；左侧用 hands-behind-pure-side，右侧就不能用 hands-behind-pure-side）。右侧 3 张必须从与左侧 3 张不同的动作族中选卡。自检时必须逐对比较左侧 shot_5/6/7 和右侧 shot_8/9/10，如果任何一对的 poseCardId 只是 left-/right- 前缀互换，必须重写右侧那张。特别注意：如果左侧某张的腿部描述和右侧某张的腿部描述只差左右方向词（如"feet close together, toes out 12°"），那就是镜像违规，必须重写',
  '- 同一批每张必须使用不同的可见腿部动作与重心组合；仅改变正侧背方向、站距或左右镜像不算新姿势；左右侧不能出现同动作、同脚位、同步幅的翻转版',
  '- 【同方向腿脚联合差异铁律】同一方向家族的多张（如正面 3 张、左侧 3 张、右侧 3 张）的腿部动作必须有根本性差异（如平行站 vs 前后大迈步 vs 屈膝抬腿），不能只靠重心或小角度变化区分',
  '- 【侧面腿部明确性要求】侧面镜头的 pose 字段必须明确写出哪条腿承重、哪条腿做动作，使用"靠近镜头的腿/远离镜头的腿"或"前腿/后腿"来指定，不能只写"支撑腿"或"另一腿"导致模型随机理解',
  '- 【同方向脚部动作去重】同一方向家族的多张如果都涉及脚部抬起动作，必须是反向差异（如一张脚尖点地脚跟抬起、另一张脚跟点地脚尖翘起），不能两张都是脚尖上翘或脚跟贴地的微弱变体',
  '- 主图不露手时，所有镜头的差异化完全由腿脚动作决定；主图露手时，手部动作族不强制逐张互斥，但手部与腿部的联合姿势不能重复',
  '- 交叉腿动作族最多使用一次；平行站和平行全脚掌落地可以出现多次，但每次都要在站距、脚尖方向、脚跟状态、前后关系或重心中至少形成两项可见差异',
].join('\n')

export const PANTS_STYLE_ANCHOR = [
  '【裤子画面气质锚点】',
  '- 全部镜头沿用参考图原本背景、光线、影调、拍摄环境和画面风格，不新增蓝天草地、街景或生活故事',
  '- 整体像可直接上架的裤子电商商品图：画面裁切距离明确、背景低存在感、裤装真实状态清楚',
  '- 人物只保留参考图裁切范围内的身体比例、肤色倾向、腿部比例、主图上衣、鞋子和低位已有配饰，胸口以上不进入画面，身体状态不按品类标签改写',
  '- 裤长基准、裤型和裤脚宽度严格跟随主图；脚和鞋允许被裤脚遮挡，也不要求完整出现，指定腿部动作造成的自然垂坠、褶皱、鞋子露出程度与遮挡变化必须符合物理规律',
].join('\n')

export const PANTS_NEGATIVE_ADDON = [
  '【关键约束 - 裤子追加】',
  '- 不要生成裙装、连衣裙、随机套装、紧身瑜伽裤或参考图不存在的裤型；不要改变主图里的裤子穿着版型、裤长基准、裤型、裤脚宽度和整体廓形；允许指定腿部动作产生自然褶皱、裤脚垂坠变化与鞋脚遮挡变化',
  '- 每个镜头只使用该 shotId 明确列出的已上传参考图；跳过缺失图片并保持图2/图3/图4连续编号，不得提及未上传细节图',
  '- 图案、贴布、刺绣、logo、拼接、口袋、侧缝和其它商品结构只按当前镜头实际收到的参考图中清楚可见状态复现；参考图对应区域是什么样就生成什么样，不多元素也不少元素',
  '- 不要让任何商品图案、装饰或真实结构与当前镜头实际提供的参考图不一致，也不要凭常见裤装经验补结构；右腿证据不能迁移到左腿，正面证据不能迁移到侧面或背面，局部放大证据不能扩展成整条裤子结构',
  '- 胸口以上区域不进入画面，画面上边缘与主图上边缘对齐，上衣露出范围按主图；输出下边缘按主图，裤脚和鞋脚可见范围允许随你选择的姿势自然变化',
  '- 主图已有的上衣、鞋子按同款保留，主图露出多少上衣就保留多少上衣；主图没有的不新增，也不要让新增内容遮挡裤身主要商品区域',
  '- 不要让侧面镜头角度不清、左右侧重复、背面变侧面、裤身扭曲、左右腿比例失真，或擅自改变裤长基准、裤脚宽度和裤型；不要把你选择的姿势退化成参考图普通站姿',
  '- 不要凭空新增主图没有的随身物、复杂背景、外景、文字、水印或多余人物；不要让细节图覆盖主图上衣、鞋子、背景、光线或相机距离',
  `- ${PANTS_FORBIDDEN_BILATERAL_HANDS_DOWN}`,
  `- ${PANTS_FORBIDDEN_BACK_HANDS_CLASPED}`,
  `- ${PANTS_FORBIDDEN_SIDE_HAND_SEAM}`,
  `- ${PANTS_FORBIDDEN_LOW_FRONT_HANDS}`,
  '- 不要生成多余手臂、多余手掌、身后幽灵手、反关节手腕或手臂穿过躯干；不要采用前臂横停腰前同时另一只手绕到身后的交叉空间动作',
  '- 背面没有明确后袋证据时，背面必须是连续整片面料，禁止生成后袋、袋口、袋盖、贴袋轮廓、对称口袋缝线，也禁止从正面、侧面或常见裤装经验迁移任何口袋结构',
  '- 不要让同批多张重复平行直立或重复交叉腿；左右镜像和拍摄方向变化仍属于同一腿部动作族',
].join('\n')

function adaptPantsTextForHandMode(
  text: string,
  mainHandVisibility: PantsMainHandVisibility,
): string {
  if (mainHandVisibility !== 'visible') return text
  return text
    .replace(
      /画面上边缘、相机距离、人物大小、实际露出的上衣范围、背景和光线以图1主图为准，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐。/g,
      '相机距离、人物大小、背景和光线以图1主图为基础；有手模式允许按姿势卡需要扩展到半身或全身，但裤子必须是画面第一主体，上衣款式、颜色、图案、袖长、袖口和鞋子按图1保留。',
    )
    .replace(
      /胸口以上区域不进入画面，画面上边缘与主图上边缘对齐，上衣露出范围按主图/g,
      '有手模式允许按姿势卡需要扩展到半身或全身；上衣款式、颜色、图案、袖长、袖口和鞋子按图1保留',
    )
    .replace(
      /人物只保留参考图裁切范围内的身体比例、肤色倾向、腿部比例、主图上衣、鞋子和低位已有配饰，胸口以上不进入画面，身体状态不按品类标签改写/g,
      '人物可按有手姿势需要扩展到半身或全身；身体比例、肤色倾向、腿部比例、主图上衣、鞋子和低位已有配饰按图1保留，身体状态不按品类标签改写',
    )
    .replace(
      /画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；/g,
      '相机距离和人物大小以主图为基础；有手模式允许按姿势卡需要扩展到半身或全身；',
    )
    .replace(
      /画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐/g,
      '相机距离和人物大小以主图为基础；有手模式允许按姿势卡需要扩展到半身或全身',
    )
    .replace(
      /画面上边缘与主图上边缘对齐/g,
      '有手模式画面上边缘可按手部造型和全身构图需要调整',
    )
    .replace(/胸口以上区域不进入画面，?/g, '')
    .replace(/不要改成完整人物全身照/g, '不要改成只拍上半身、头像或非裤子主体图')
}

interface PantsPoseAssignment {
  cardId: string
  weight: number
  familyId: string
  visualFamily: PantsPoseVisualFamily
  tier: PantsPoseTier
}

type PantsPoseShapeGroup = string

/**
 * 通过 view + cardId 查询姿势卡的肉眼轮廓组。
 * 后端确定性去重闸门使用：同一轮廓组全批最多 1 张。
 */
export function getPantsPoseShapeGroupByCardId(
  view: PantsPoseView,
  cardId: string,
): PantsPoseShapeGroup | null {
  return getPantsPoseShapeGroup(view as PantsDrawView, {
    cardId,
    weight: 0,
    familyId: '',
    visualFamily: 'weight-shift',
    tier: 'weak',
  })
}

const poseAssignment = (
  cardId: string,
  weight = 1,
): PantsPoseAssignment => {
  const card = getPantsPoseCardById(cardId)
  return {
    cardId,
    weight,
    familyId: cardId,
    visualFamily: getPantsPoseVisualFamily(card),
    tier: getPantsPoseTier(card, 'hidden'),
  }
}

type PantsDrawView = PantsPoseView | 'side'

const FRONT_POSE_DRAW_POOL: readonly PantsPoseAssignment[] = [
  poseAssignment('front-soft-toe-out', 2),
  poseAssignment('front-soft-toe-in', 2),
  poseAssignment('front-shallow-v-toe', 2),
  poseAssignment('front-staggered-v-toe'),
  poseAssignment('front-heel-touch-toe-up', 2),
  poseAssignment('front-light-thigh-touch-toe-point', 2),
  poseAssignment('front-single-waist-inner-toe-point', 2),
  poseAssignment('front-low-hands-away-staggered'),
  poseAssignment('front-hands-folded-staggered'),
  poseAssignment('front-weight-back-front-step'),
  poseAssignment('front-double-waist-light-wide'),
  poseAssignment('front-hands-hidden-narrow-parallel'),
  poseAssignment('front-side-reach-one-waist'),
  poseAssignment('front-hands-behind-stable'),
]

const buildSidePoseDrawPool = (
  view: 'left' | 'right',
): readonly PantsPoseAssignment[] => [
  poseAssignment(`${view}-knee-lift-toe-touch`, 2),
  poseAssignment(`${view}-low-hands-away-cross-step`),
  poseAssignment(`${view}-pure-side-staggered`),
  poseAssignment(`${view}-front-foot-lift`),
  poseAssignment(`${view}-heel-touch-toe-up`, 2),
  poseAssignment(`${view}-compact-toe-out`),
  poseAssignment(`${view}-compact-staggered-v`),
  poseAssignment(`${view}-arms-crossed`),
  poseAssignment(`${view}-waistband-one-hand`),
  poseAssignment(`${view}-toe-point-back`),
  poseAssignment(`${view}-pure-side-walk`),
  poseAssignment(`${view}-hands-down-stable`),
  poseAssignment(`${view}-reverse-hand-rear-waist`),
  poseAssignment(`${view}-one-waist-one-behind`),
  poseAssignment(`${view}-both-hands-waistband-staggered`),
  poseAssignment(`${view}-hands-behind-pure-side`),
  poseAssignment(`${view}-front-toe-point-long-line`, 2),
  poseAssignment(`${view}-all-heels-staggered`),
  poseAssignment(`${view}-hands-hidden-open-step`),
  poseAssignment(`${view}-side-reach-one-waist`),
]

const buildSideSupportPoseDrawPool = (
  view: 'left' | 'right',
): readonly PantsPoseAssignment[] => [
  poseAssignment(`${view}-white-step-staggered`, 2),
  poseAssignment(`${view}-transparent-chair-knee-bend`),
  poseAssignment(`${view}-white-rail-toe-point`),
  poseAssignment(`${view}-white-table-staggered`),
]

const LEFT_POSE_DRAW_POOL = buildSidePoseDrawPool('left')
const RIGHT_POSE_DRAW_POOL = buildSidePoseDrawPool('right')
const SIDE_POSE_DRAW_POOL = [...LEFT_POSE_DRAW_POOL, ...RIGHT_POSE_DRAW_POOL]
const LEFT_SUPPORT_POSE_DRAW_POOL = buildSideSupportPoseDrawPool('left')
const RIGHT_SUPPORT_POSE_DRAW_POOL = buildSideSupportPoseDrawPool('right')

const BACK_POSE_DRAW_POOL: readonly PantsPoseAssignment[] = [
  poseAssignment('back-soft-toe-out'),
  poseAssignment('back-soft-toe-in'),
  poseAssignment('back-both-hands-waist-toe-point'),
  poseAssignment('back-straight-relaxed'),
  poseAssignment('back-double-waist-parallel-heels'),
  poseAssignment('back-hands-hidden-staggered'),
  poseAssignment('back-single-waist-toe-point'),
  poseAssignment('back-weight-shift'),
  poseAssignment('back-hands-hidden-behind'),
  poseAssignment('back-one-raised-one-waist'),
]

const PANTS_DRAW_VIEWS: Record<
  PhotoFissionResultCount,
  readonly PantsDrawView[]
> = {
  2: ['front', 'side'],
  4: ['front', 'left', 'right', 'back'],
  9: ['back', 'front', 'front', 'front', 'left', 'left', 'left', 'right', 'right'],
  10: ['back', 'front', 'front', 'front', 'left', 'left', 'left', 'right', 'right', 'right'],
}

function getPantsPoseDrawPool(
  view: PantsDrawView,
  resultCount: PhotoFissionResultCount,
): readonly PantsPoseAssignment[] {
  if (view === 'front') return FRONT_POSE_DRAW_POOL
  if (view === 'left') {
    return resultCount === 10
      ? [...LEFT_POSE_DRAW_POOL, ...LEFT_SUPPORT_POSE_DRAW_POOL]
      : LEFT_POSE_DRAW_POOL
  }
  if (view === 'right') {
    return resultCount === 10
      ? [...RIGHT_POSE_DRAW_POOL, ...RIGHT_SUPPORT_POSE_DRAW_POOL]
      : RIGHT_POSE_DRAW_POOL
  }
  if (view === 'side') return SIDE_POSE_DRAW_POOL
  return BACK_POSE_DRAW_POOL
}

const PANTS_VISUAL_FAMILY_LIMITS: Partial<Record<PantsPoseVisualFamily, number>> = {
  'toe-point': 3,
  'cross-step': 1,
  'chair-knee-bend': 1,
  'step-height': 1,
  'toe-in': 1,
  'toe-out': 1,
  'v-toe': 1,
  'staggered-v': 1,
  'heel-touch-toe-up': 1,
  walking: 1,
  'knee-bend': 1,
}

const PANTS_LIGHT_FOOT_VISUAL_FAMILIES: ReadonlySet<PantsPoseVisualFamily> =
  new Set<PantsPoseVisualFamily>([
    'toe-in',
    'toe-out',
    'v-toe',
    'staggered-v',
    'heel-touch-toe-up',
  ])

const PANTS_LIGHT_FOOT_POSE_LIMIT = 3

const PANTS_REUSABLE_VISUAL_FAMILIES: ReadonlySet<PantsPoseVisualFamily> =
  new Set<PantsPoseVisualFamily>(['parallel', 'staggered'])

const PANTS_SIDE_MIRROR_VISUAL_FAMILIES: ReadonlySet<PantsPoseVisualFamily> =
  new Set<PantsPoseVisualFamily>([
    'toe-point',
    'cross-step',
    'chair-knee-bend',
    'step-height',
    'walking',
    'knee-bend',
  ])

const PANTS_HIDDEN_TEN_SHOT_CURATED_CARD_IDS = [
  'back-soft-toe-in',
  'front-light-thigh-touch-toe-point',
  'front-relaxed-wide-stance',
  'front-heel-touch-toe-up',
  'left-low-hands-away-cross-step',
  'left-knee-lift-toe-touch',
  'left-heel-touch-toe-up',
  'right-front-foot-lift',
  'right-one-waist-one-behind',
  'right-front-toe-point-long-line',
] as const

const PANTS_VISIBLE_TEN_SHOT_CURATED_CARD_IDS = [
  'back-both-hands-waist-toe-point',
  'front-arms-crossed-parallel',
  'front-hands-folded-staggered',
  'front-side-reach-one-waist',
  'left-pure-side-staggered',
  'left-side-reach-one-waist',
  'left-knee-lift-toe-touch',
  'right-white-rail-toe-point',
  'right-white-table-staggered',
  'right-arms-crossed',
] as const

function getPantsVisualFamilyLimit(visualFamily: PantsPoseVisualFamily): number {
  return PANTS_VISUAL_FAMILY_LIMITS[visualFamily] ?? Number.POSITIVE_INFINITY
}

function hasPantsVisualFamilyCapacity(
  counts: ReadonlyMap<PantsPoseVisualFamily, number>,
  visualFamily: PantsPoseVisualFamily,
): boolean {
  if ((counts.get(visualFamily) ?? 0) >= getPantsVisualFamilyLimit(visualFamily)) {
    return false
  }
  if (!PANTS_LIGHT_FOOT_VISUAL_FAMILIES.has(visualFamily)) return true
  let lightFootCount = 0
  for (const family of PANTS_LIGHT_FOOT_VISUAL_FAMILIES) {
    lightFootCount += counts.get(family) ?? 0
  }
  return lightFootCount < PANTS_LIGHT_FOOT_POSE_LIMIT
}

function addPantsVisualFamilyCount(
  counts: Map<PantsPoseVisualFamily, number>,
  visualFamily: PantsPoseVisualFamily,
): void {
  counts.set(visualFamily, (counts.get(visualFamily) ?? 0) + 1)
}

function seededFraction(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

function drawWeightedPose(
  candidates: readonly PantsPoseAssignment[],
  usedCardIds: ReadonlySet<string>,
  usedFamilyIds: ReadonlySet<string>,
  usedVisualFamilyKeys: ReadonlySet<string>,
  usedPoseShapeGroups: ReadonlySet<PantsPoseShapeGroup>,
  visualFamilyCounts: ReadonlyMap<PantsPoseVisualFamily, number>,
  allowChairPose: boolean,
  supportPoseCount: number,
  mainHandVisibility: PantsMainHandVisibility,
  view: PantsDrawView,
  seed: string,
  weakFamilyCount: number,
): PantsPoseAssignment {
  const available = candidates.filter(
    (item) => {
      const card = getPantsPoseCardById(item.cardId)
      if (usedCardIds.has(item.cardId)) return false
      if (usedFamilyIds.has(item.familyId)) return false
      if (!hasPantsVisualFamilyCapacity(visualFamilyCounts, item.visualFamily)) {
        return false
      }
      const visualFamilyKey = getPantsVisualFamilyKey(view, item.visualFamily)
      if (visualFamilyKey && usedVisualFamilyKeys.has(visualFamilyKey)) return false
      const shapeGroup = getPantsPoseShapeGroup(view, item)
      if (shapeGroup && usedPoseShapeGroups.has(shapeGroup)) return false
      if (!allowChairPose && item.visualFamily === 'chair-knee-bend') return false
      if (
        mainHandVisibility === 'hidden' &&
        isPantsHandDependentVisualFamily(item.visualFamily)
      ) {
        return false
      }
      if (!card.support) return true
      if (supportPoseCount >= 2) return false
      if (mainHandVisibility === 'hidden' && card.support.handMode === 'visible-only') {
        return false
      }
      return true
    },
  )
  if (available.length === 0) {
    const relaxed = candidates.filter(
      (item) => {
        const card = getPantsPoseCardById(item.cardId)
        if (usedCardIds.has(item.cardId)) return false
        if (usedFamilyIds.has(item.familyId)) return false
        if (!allowChairPose && item.visualFamily === 'chair-knee-bend') return false
        if (
          mainHandVisibility === 'hidden' &&
          isPantsHandDependentVisualFamily(item.visualFamily)
        ) {
          return false
        }
        if (!card.support) return true
        if (supportPoseCount >= 2) return false
        if (mainHandVisibility === 'hidden' && card.support.handMode === 'visible-only') {
          return false
        }
        return true
      },
    )
    if (relaxed.length === 0) {
      throw new Error('裤子姿势抽卡池不足，无法保持同批姿势动作族唯一')
    }
    available.push(...relaxed)
  }
  const dynamicTier = (item: PantsPoseAssignment): PantsPoseTier =>
    getPantsPoseTier(getPantsPoseCardById(item.cardId), mainHandVisibility)
  const strong = available.filter((item) => dynamicTier(item) === 'strong')
  const weak = available.filter((item) => dynamicTier(item) === 'weak')
  const weakUnderLimit = weakFamilyCount < 2 ? weak : []
  const parallelFallback = available.filter(
    (item) => item.visualFamily === 'parallel',
  )
  let picks: readonly PantsPoseAssignment[]
  if (strong.length > 0) {
    picks = strong
  } else if (weakUnderLimit.length > 0) {
    picks = weakUnderLimit
  } else if (parallelFallback.length > 0) {
    picks = parallelFallback
  } else {
    picks = available
  }
  const totalWeight = picks.reduce((sum, item) => sum + item.weight, 0)
  let cursor = seededFraction(seed) * totalWeight
  for (const item of picks) {
    cursor -= item.weight
    if (cursor < 0) return item
  }
  return picks[picks.length - 1]!
}

function buildPantsAssignedPosePlan(
  resultCount: PhotoFissionResultCount,
  drawSeed: string,
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
): readonly PantsPoseAssignment[] {
  if (resultCount === 10 && mainHandVisibility === 'hidden') {
    void drawSeed
    return PANTS_HIDDEN_TEN_SHOT_CURATED_CARD_IDS.map((cardId) =>
      poseAssignment(cardId),
    )
  }
  if (resultCount === 10 && mainHandVisibility === 'visible') {
    void drawSeed
    return PANTS_VISIBLE_TEN_SHOT_CURATED_CARD_IDS.map((cardId) =>
      poseAssignment(cardId),
    )
  }

  const usedCardIds = new Set<string>()
  const usedFamilyIds = new Set<string>()
  const usedVisualFamilyKeys = new Set<string>()
  const usedPoseShapeGroups = new Set<PantsPoseShapeGroup>()
  const visualFamilyCounts = new Map<PantsPoseVisualFamily, number>()
  const allowChairPose =
    resultCount === 10 && seededFraction(`${drawSeed}:${resultCount}:chair-contact`) < 0.35
  let supportPoseCount = 0
  let weakFamilyCount = 0
  return PANTS_DRAW_VIEWS[resultCount].map((view, index) => {
    const assignment = drawWeightedPose(
      getPantsPoseDrawPool(view, resultCount),
      usedCardIds,
      usedFamilyIds,
      usedVisualFamilyKeys,
      usedPoseShapeGroups,
      visualFamilyCounts,
      allowChairPose,
      supportPoseCount,
      mainHandVisibility,
      view,
      `${drawSeed}:${resultCount}:${index}:${view}`,
      weakFamilyCount,
    )
    if (getPantsPoseCardById(assignment.cardId).support) supportPoseCount += 1
    const dynamicTier = getPantsPoseTier(
      getPantsPoseCardById(assignment.cardId),
      mainHandVisibility,
    )
    if (dynamicTier === 'weak') weakFamilyCount += 1
    usedCardIds.add(assignment.cardId)
    usedFamilyIds.add(assignment.familyId)
    const visualFamilyKey = getPantsVisualFamilyKey(view, assignment.visualFamily)
    if (visualFamilyKey) usedVisualFamilyKeys.add(visualFamilyKey)
    const shapeGroup = getPantsPoseShapeGroup(view, assignment)
    if (shapeGroup) usedPoseShapeGroups.add(shapeGroup)
    addPantsVisualFamilyCount(visualFamilyCounts, assignment.visualFamily)
    return assignment
  })
}

function getPantsVisualFamilyKey(
  view: PantsDrawView,
  visualFamily: PantsPoseVisualFamily,
): string | null {
  if (PANTS_REUSABLE_VISUAL_FAMILIES.has(visualFamily)) return null
  const scope =
    (view === 'side' || view === 'left' || view === 'right') &&
    PANTS_SIDE_MIRROR_VISUAL_FAMILIES.has(visualFamily)
      ? 'side'
      : view
  return `${scope}:${visualFamily}`
}

function getPantsPoseShapeGroup(
  view: PantsDrawView,
  assignment: PantsPoseAssignment,
): PantsPoseShapeGroup | null {
  const id = assignment.cardId
  if (view === 'front') {
    if (/front-soft-toe-out|front-soft-toe-in|front-shallow-v-toe|front-staggered-v-toe|front-heel-touch-toe-up/.test(id)) {
      return 'front-light-foot'
    }
    if (/front-low-hands-away-staggered|front-hands-folded-staggered|front-weight-back-front-step/.test(id)) {
      return 'front-small-staggered'
    }
    return null
  }
  if (view !== 'left' && view !== 'right' && view !== 'side') return null
  if (/white-step-staggered|transparent-chair-knee-bend/.test(id)) {
    return 'support-raised-leg'
  }
  if (/low-hands-away-cross-step/.test(id)) return 'side-cross-step'
  if (/knee-lift-toe-touch|transparent-chair-knee-bend/.test(id)) {
    return 'side-knee-bend-high-low'
  }
  if (/front-foot-lift/.test(id)) return 'side-front-foot-lift'
  if (/walking-pause|pure-side-walk/.test(id)) return 'side-walking-pause'
  if (/one-waist-one-behind|hands-hidden-open-step|hands-behind-pure-side/.test(id)) {
    return 'side-open-triangle'
  }
  if (/toe-point-back|front-toe-point-long-line|white-rail-toe-point/.test(id)) {
    return 'side-long-toe-point'
  }
  if (/heel-touch-toe-up/.test(id)) return 'side-heel-toe-up'
  if (/compact-toe-out|compact-staggered-v/.test(id)) {
    return 'side-compact-grounded'
  }
  if (/pure-side-staggered|all-heels-staggered|side-reach-one-waist/.test(id)) {
    return 'side-grounded-staggered'
  }
  if (/hands-down-stable|waistband-one-hand|reverse-hand-rear-waist|both-hands-waistband-staggered/.test(id)) {
    return 'side-grounded-staggered'
  }
  return null
}

export function getPantsAssignedPoseForShot(
  resultCount: PhotoFissionResultCount,
  shotId: string,
  drawSeed = 'pants-default-draw',
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
): PantsPoseCard {
  try {
    const assignments = buildPantsAssignedPosePlan(resultCount, drawSeed, mainHandVisibility)
    const shotIndex = Number.parseInt(shotId.replace(/^shot_/, ''), 10) - 1
    const assignment = assignments[shotIndex]
    if (!assignment) {
      throw new Error(`裤子镜头缺少指定姿势卡：count=${resultCount} shotId=${shotId}`)
    }
    return getPantsPoseCardById(assignment.cardId)
  } catch {
    // 抽卡池不足时降级：返回该方向第一张可用卡
    // LLM 导演已负责语义去重，fallback 只需保证不报错
    const shotIndex = Number.parseInt(shotId.replace(/^shot_/, ''), 10) - 1
    const views = PANTS_DRAW_VIEWS[resultCount]
    const view = views?.[shotIndex] ?? 'front'
    const pool = getPantsPoseDrawPool(view, resultCount)
    const fallback = pool.find((item) => {
      if (mainHandVisibility === 'hidden' && isPantsHandDependentVisualFamily(item.visualFamily)) return false
      return true
    })
    if (!fallback) {
      // 极端情况：返回任意一张卡
      return getPantsPoseCardById(pool[0]?.cardId ?? 'front-parallel-stand')
    }
    return getPantsPoseCardById(fallback.cardId)
  }
}

export function validatePantsAssignedPosePlan(
  resultCount: PhotoFissionResultCount,
  drawSeed = 'pants-default-draw',
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
): void {
  const assignments = buildPantsAssignedPosePlan(resultCount, drawSeed, mainHandVisibility)
  if (assignments.length !== resultCount) {
    throw new Error(`裤子指定姿势数量错误：count=${resultCount} actual=${assignments.length}`)
  }
  const cardIds = assignments.map((item) => item.cardId)
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error(`裤子姿势卡存在重复：count=${resultCount}`)
  }
  const familyIds = assignments.map((item) => item.familyId)
  if (new Set(familyIds).size !== familyIds.length) {
    throw new Error(`裤子姿势动作族存在重复：count=${resultCount}`)
  }
  const visualFamilyKeys = assignments.map((item, index) =>
    getPantsVisualFamilyKey(PANTS_DRAW_VIEWS[resultCount][index]!, item.visualFamily),
  ).filter((key): key is string => Boolean(key))
  if (new Set(visualFamilyKeys).size !== visualFamilyKeys.length) {
    throw new Error(`裤子姿势视觉动作族存在重复：count=${resultCount}`)
  }
  const poseShapeGroups = assignments
    .map((item, index) =>
      getPantsPoseShapeGroup(PANTS_DRAW_VIEWS[resultCount][index]!, item),
    )
    .filter((group): group is PantsPoseShapeGroup => Boolean(group))
  if (new Set(poseShapeGroups).size !== poseShapeGroups.length) {
    throw new Error(`裤子底层腿型轮廓存在重复：count=${resultCount}`)
  }
  const visualFamilyCounts = new Map<PantsPoseVisualFamily, number>()
  for (const assignment of assignments) {
    addPantsVisualFamilyCount(visualFamilyCounts, assignment.visualFamily)
  }
  for (const [visualFamily, count] of visualFamilyCounts) {
    const limit = getPantsVisualFamilyLimit(visualFamily)
    if (count > limit) {
      throw new Error(
        `裤子姿势动作族超出上限：family=${visualFamily} count=${count} limit=${limit}`,
      )
    }
  }
  let lightFootCount = 0
  for (const family of PANTS_LIGHT_FOOT_VISUAL_FAMILIES) {
    lightFootCount += visualFamilyCounts.get(family) ?? 0
  }
  if (lightFootCount > PANTS_LIGHT_FOOT_POSE_LIMIT) {
    throw new Error(
      `裤子轻脚位姿势过多：count=${resultCount} lightFoot=${lightFootCount} limit=${PANTS_LIGHT_FOOT_POSE_LIMIT}`,
    )
  }
  const supportPoseCount = assignments.filter((item) => getPantsPoseCardById(item.cardId).support).length
  if (resultCount !== 10 && supportPoseCount > 0) {
    throw new Error(`裤子支撑物姿势只能用于 10 张模式：count=${resultCount}`)
  }
  if (supportPoseCount > 2) {
    throw new Error(`裤子支撑物姿势过多：count=${resultCount} support=${supportPoseCount}`)
  }
  if (mainHandVisibility === 'hidden') {
    const handDependentPose = assignments.find((item) =>
      isPantsHandDependentVisualFamily(item.visualFamily),
    )
    if (handDependentPose) {
      throw new Error(`主图不露手模式不能使用手部依赖姿势：${handDependentPose.cardId}`)
    }
    const visibleOnlySupport = assignments.find((item) => {
      const support = getPantsPoseCardById(item.cardId).support
      return support?.handMode === 'visible-only'
    })
    if (visibleOnlySupport) {
      throw new Error(`主图不露手模式不能使用需手扶支撑物姿势：${visibleOnlySupport.cardId}`)
    }
  }
}

export function mayPantsShotRevealHandsWhenMainHidden(
  resultCount: PhotoFissionResultCount,
  shotId: string,
  drawSeed = 'pants-default-draw',
): boolean {
  void resultCount
  void shotId
  void drawSeed
  return false
}

const PANTS_TWO_SHOT_BLUEPRINT: ReadonlyArray<PantsShotBlueprint> = [
  {
    label: '正面姿势变化裤子商品图',
    description:
      '沿用参考图背景、光线和画面风格的正面裤子商品图，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；主图若露出肩膀、上衣图案、鞋子或低位配饰都按主图保留，裤子的穿着版型、裤长基准和裤脚宽度以主图为准，腿脚姿势按本镜头唯一指定姿势执行，裤脚垂坠和鞋脚遮挡可随姿势自然变化',
    view: 'front',
    scene: 'reference',
  },
  {
    label: '侧面姿势变化裤子商品图',
    description:
      '沿用参考图背景、光线和画面风格的侧面裤子商品图，身体朝向左侧或右侧约60°，允许45°-75°；画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只展示参考图真实可见的侧面状态，裤子的穿着版型、裤长基准和裤脚宽度按主图，腿脚姿势按本镜头唯一指定姿势执行，裤脚垂坠和鞋脚遮挡可随姿势自然变化，已有上衣、鞋子和低位配饰保持不变',
    view: 'side',
    scene: 'reference',
  },
]

const PANTS_FOUR_SHOT_BLUEPRINT: ReadonlyArray<PantsShotBlueprint> = [
  {
    label: '正面姿势变化裤子商品图',
    description:
        '正面裤子商品图，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；模特正面面对镜头，可有0°-15°微左或微右变化，只展示参考图真实可见的正面状态，裤长基准、版型和裤脚宽度按主图，腿脚姿势按本镜头唯一指定姿势执行，垂坠状态及鞋脚遮挡可随姿势自然变化，已有上衣图案、鞋子和低位配饰保持不变；腿脚姿势必须与参考图普通站姿有可见差异（如前后脚错开、脚尖外八、脚跟点地等），严禁复制参考图站姿',
    view: 'front',
    scene: 'reference',
  },
  {
    label: '左侧面姿势变化裤子商品图',
    description:
      '左侧面裤子商品图，身体朝向左侧约60°，允许45°-75°；画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只展示参考图真实可见的左侧状态，手部和腿部严格执行本镜头指定姿势卡，不遮挡裤身主要区域，裤长与版型严格按主图',
    view: 'left',
    scene: 'reference',
  },
  {
    label: '右侧面姿势变化裤子商品图',
    description:
      '右侧面裤子商品图，身体朝向右侧约60°，允许45°-75°，与左侧图形成角度互补；画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只展示参考图真实可见的右侧状态，手部和腿部严格执行本镜头指定姿势卡，裤长与版型严格按主图',
    view: 'right',
    scene: 'reference',
  },
  {
    label: '背面姿势变化裤子商品图',
    description:
      '背面裤子商品图，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；模特背对镜头或接近正背面站立，可有0°-15°微左或微右变化，只展示当前镜头参考图真实可见的背面状态，图案、logo、贴布、刺绣、拼接和其它结构只按参考图复现，裤长基准和裤脚宽度按主图，腿脚姿势按本镜头唯一指定姿势执行，裤脚垂坠及鞋脚遮挡可随姿势自然变化',
    view: 'back',
    scene: 'reference',
  },
]

const PANTS_TEN_SHOT_BLUEPRINT: ReadonlyArray<PantsShotBlueprint> = [
  PANTS_FOUR_SHOT_BLUEPRINT[3]!,
  PANTS_FOUR_SHOT_BLUEPRINT[0]!,
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[0]!,
    label: '正面姿势变化裤子商品图',
    description:
      '正面裤子商品图，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只执行你为本镜头选择的唯一姿势卡，让腿脚、脚掌落点和重心形成可见变化，手部是否出现严格服从主图露手证据，主图不露手则本镜头不露手，不改变裤长、版型和裤脚自然垂坠',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[0]!,
    label: '正面角度微调姿势变化裤子商品图',
    description:
      '正面裤子商品图，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；手部和腿部严格执行本镜头指定姿势卡，不遮挡裤身主要区域，只展示参考图真实可见的正面状态，裤子版型与裤脚宽度按主图；腿脚姿势必须与参考图普通站姿有可见差异，严禁复制参考图站姿',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[1]!,
    label: '左侧面角度微调姿势变化裤子商品图',
    description:
      '左侧面裤子商品图，身体朝向左侧约30°，允许15°-45°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只展示参考图真实可见的左侧状态，手部和腿部严格执行本镜头指定姿势卡，不遮挡裤身主要区域，裤长与版型严格按主图',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[1]!,
    label: '左侧面姿势变化裤子商品图',
    description:
      '左侧面裤子商品图，身体朝向左侧约60°，允许45°-75°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只执行你为本镜头选择的唯一姿势卡，让腿脚、脚掌落点和重心形成可见变化，手部是否出现严格服从主图露手证据，主图不露手则本镜头不露手，不改变裤长、版型和裤脚自然垂坠',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[1]!,
    label: '左侧面纯侧姿势变化裤子商品图',
    description:
      '左侧面裤子商品图，身体朝向左侧约90°，允许75°-95°，最高不超过95°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；模特身体保持明确左侧角度，手部和腿部严格执行本镜头指定姿势卡，只展示参考图真实可见的左侧状态，裤长、裤型和裤脚宽度按主图',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[2]!,
    label: '右侧面角度微调姿势变化裤子商品图',
    description:
      '右侧面裤子商品图，身体朝向右侧约30°，允许15°-45°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只展示参考图真实可见的右侧状态，手部和腿部严格执行本镜头指定姿势卡，裤长与版型严格按主图',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[2]!,
    label: '右侧面姿势变化裤子商品图',
    description:
      '右侧面裤子商品图，身体朝向右侧约60°，允许45°-75°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；只执行你为本镜头选择的唯一姿势卡，让腿脚、脚掌落点和重心形成可见变化，手部是否出现严格服从主图露手证据，主图不露手则本镜头不露手，不改变裤长、版型和裤脚自然垂坠',
  },
  {
    ...PANTS_FOUR_SHOT_BLUEPRINT[2]!,
    label: '右侧面纯侧姿势变化裤子商品图',
    description:
      '右侧面裤子商品图，身体朝向右侧约90°，允许75°-95°，最高不超过95°，画面边界、相机距离和人物大小严格参考主图，胸口以上区域不进入画面，画面上边缘与主图上边缘对齐；模特保持明确右侧角度，手部和腿部严格执行本镜头指定姿势卡，不遮挡裤身主要区域，只展示参考图真实可见的右侧状态，裤长、裤型和裤脚宽度按主图',
  },
]

const PANTS_NINE_SHOT_BLUEPRINT: ReadonlyArray<PantsShotBlueprint> = [
  ...PANTS_TEN_SHOT_BLUEPRINT.slice(0, 7),
  ...PANTS_TEN_SHOT_BLUEPRINT.slice(8),
]

export function getPantsShotBlueprintForCount(
  resultCount: PhotoFissionResultCount,
): ReadonlyArray<PantsShotBlueprint> {
  if (resultCount === 2) return PANTS_TWO_SHOT_BLUEPRINT
  if (resultCount === 4) return PANTS_FOUR_SHOT_BLUEPRINT
  if (resultCount === 9) return PANTS_NINE_SHOT_BLUEPRINT
  return PANTS_TEN_SHOT_BLUEPRINT
}

export function buildPantsPlannerSlots(resultCount: PhotoFissionResultCount) {
  const blueprint = getPantsShotBlueprintForCount(resultCount)
  return blueprint.map((shot, index) => ({
    shotId: `shot_${index + 1}`,
    role: shot.label,
    type: 'full' as const,
    scene: 'indoor' as const,
  }))
}

export function buildPantsPlannerUserPrompt(
  resultCount: PhotoFissionResultCount,
  recentActionHints: readonly string[] = [],
): string {
  const avoidSection = formatRecentPantsPoseHints(recentActionHints)
  const mirrorCheck = resultCount === 10
    ? ' 自检时必须额外逐对比较左侧 shot_5/6/7 和右侧 shot_8/9/10：如果任何一对的 poseCardId 只是 left-/right- 前缀互换（例如 left-compact-toe-out vs right-compact-toe-out），必须重写右侧那张，换成与左侧完全不同的动作族。'
    : ''
  return `请按系统提示词的输入输出标准，为本次裤子裂变任务输出 ${resultCount} 段提示词 JSON。每个 shotId 必须包含 role、view、angle、poseCardId、finalPrompt、selfCheck。finalPrompt 是你自己写好的最终生图提示词，必须可直接发送给图片生成模型，且必须包含 POSITIVE PROMPT: 与 NEGATIVE PROMPT: 两段。你需要在一次思考中完成全部 ${resultCount} 段的起草，然后统一自检这 ${resultCount} 段的角度、手部模式、poseCardId、手脚姿势语义是否重复；如果有重复或违反手部模式，必须重写对应 finalPrompt 和 poseCardId，确保全部 ${resultCount} 个姿势都是独立动作后再输出最终 JSON。不得改变主图裤长基准、版型和裤脚宽度，也不得为了展示鞋而拉短或提起裤脚；但必须允许指定姿势带来自然裤脚垂坠、褶皱和鞋脚遮挡变化。${mirrorCheck}${avoidSection}`
}

export function buildPantsActionPlannerUserPrompt(
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
  recentActionHints: readonly string[] = [],
): string {
  const avoidSection = formatRecentPantsPoseHints(recentActionHints)
  const handModeText =
    mainHandVisibility === 'visible'
      ? 'visible，有手模式；可以选择安全高位手部造型或明确受控支撑物姿势'
      : 'hidden，无手模式；只按腿脚轮廓选卡，不能选择依赖手部造型才能成立的卡'
  return [
    `请为裤子 10 张裂变输出 ActionPlan JSON。本次 handMode=${handModeText}。`,
    '你只负责选择动作计划，不写 Gemini 最终 prompt，不输出 finalPrompt，不写 POSITIVE PROMPT 或 NEGATIVE PROMPT。',
    '后端会读取你的 poseCardId，再从姿势库编译成稳定英文 hard prompt；所以你的输出必须专注于动作差异、角度和去重。',
    '固定顺序必须是：shot_1 back、shot_2 front、shot_3 front、shot_4 front、shot_5 left、shot_6 left、shot_7 left、shot_8 right、shot_9 right、shot_10 right。',
    '侧面 6 张是本次重点：必须覆盖不同肉眼轮廓，不允许 6 张都像“一条腿承重、另一腿斜伸/普通错步”。左侧 3 张内部要不同，右侧 3 张内部要不同，左右侧也不能只是镜像。',
    '右侧 shot_10 的 angle 必须保持 right 75-95deg 纯侧层级；不要为了 logo 或正面图案把它拉回正面。',
    '自检时逐张比较 poseCardId、actionFamily、silhouetteKey：任何一项重复、近似或左右镜像，都要换卡。',
    avoidSection,
  ].filter(Boolean).join('\n')
}

export function buildPantsActionPlannerSystemPrompt(
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
  recentActionHints: readonly string[] = [],
): string {
  const candidatePool = buildPantsActionPlannerCandidatePool(mainHandVisibility)
  const recentPoseRules = buildRecentPantsPoseRuleSection(recentActionHints)
  const handModeInstruction = mainHandVisibility === 'visible'
    ? [
        '本次为有手模式：可以半身/全身，但裤子仍是第一主体。',
        '必须选择带明确高位手部造型的安全卡：双手搭腰、胸前交叉、单臂侧展搭腰、或手明确扶白色栏杆/台面。',
        '禁止选择或暗示 hands behind、hidden hands、low hands、hands on thigh、hands at sides、双手下垂、双手自然摆放、手贴裤缝、手掌贴大腿外侧等危险动作。',
        '空手必须在腰线、胸前交叉或侧展并与裤面有空隙；只有扶栏杆/台面时手可低于腰线。',
      ].join('\n')
    : [
        '本次为无手模式：默认模式，不用全身，不补完整身体。',
        '你只看腿脚轮廓选择 poseCardId；不要在任何字段里写手部动作。',
        '不能选择依赖手部造型才有差异的卡，也不能选择 visible-only 支撑物卡。',
      ].join('\n')

  return `# 角色

你是「AI 服装大片裂变」裤子品类的动作分镜导演。你只负责为 10 张固定镜头选择动作计划 ActionPlan；后端会根据 poseCardId 编译最终 Gemini prompt。

# 不可越界

- 你绝对不要输出 finalPrompt、imagePrompt、POSITIVE PROMPT、NEGATIVE PROMPT。
- 你不直接控制商品颜色、材质、logo、口袋、背景、光线、构图文字；这些由后端 hard prompt 和参考图策略控制。
- 主图只锁商品、人物比例、构图、背景、光线；细节图只锁商品局部证据，不作为姿势参考。

# 手部模式

${handModeInstruction}

# 10 张固定顺序与角度 token

- shot_1: view=back, angle=back +/-15deg
- shot_2: view=front, angle=front 0deg
- shot_3: view=front, angle=front left <=15deg
- shot_4: view=front, angle=front right <=15deg
- shot_5: view=left, angle=left 30deg
- shot_6: view=left, angle=left 60deg
- shot_7: view=left, angle=left 90deg
- shot_8: view=right, angle=right 15-45deg
- shot_9: view=right, angle=right 45-75deg
- shot_10: view=right, angle=right 75-95deg

正面允许 0°/左右 15° 内微侧，不要求三张都纯正面。左侧必须形成 30/60/90 的层级，右侧必须形成 15-45/45-75/75-95 的层级，shot_10 必须是明确纯右侧。

# 侧面去重目标

侧面 6 张必须尽量覆盖这些不同轮廓族：
- 交叉步
- 屈膝抬脚 / 高低膝
- 脚跟点地脚尖翘起
- 前脚掌抬起
- 开放三角
- 长线脚尖点地或受控支撑物
- 紧凑全掌侧站 / 小 V 脚位

不得让同方向 3 张都落入“一条腿承重另一腿斜伸”的同类轮廓。左右侧不能只把 left-/right- 前缀互换。

# 候选姿势卡

只能从下面候选池选择 poseCardId。actionFamily 必须使用卡片后的 visualFamily；silhouetteKey 用你对肉眼腿型轮廓的短英文 key，必须便于后端查重。

${candidatePool}

# 内部流程

1. 起草：按固定顺序为 10 张各选 1 张符合 view 的 poseCardId。
2. 自检：比较 poseCardId、actionFamily、silhouetteKey、左右镜像和同方向腿脚轮廓。
3. 重写：发现重复时优先改侧面卡，特别是 shot_5 至 shot_10。
4. 定稿：只输出 JSON，不解释。

${recentPoseRules}

# 输出格式

直接输出严格 JSON，不要 markdown 代码围栏：

{
  "shots": [
    {
      "shotId": "shot_1",
      "role": "back view pants action plan",
      "view": "back",
      "angle": "back +/-15deg",
      "poseCardId": "back-soft-toe-in",
      "actionFamily": "toe-in",
      "silhouetteKey": "back-inward-toes-grounded",
      "selfCheck": "back +/-15deg; hidden mode; grounded inward-toe back silhouette differs from side and front actions"
    }
  ]
}

硬性要求：
- shots 数量必须等于 10。
- shotId 必须从 shot_1 到 shot_10 连续。
- view 和 angle 必须逐字匹配固定 token。
- poseCardId 必须真实存在且方向匹配。
- poseCardId 不得重复。
- actionFamily 和 silhouetteKey 必须能表达动作差异；侧面 6 张 silhouetteKey 不能重复或近似。
- selfCheck 必须简短说明角度、手部模式、姿势差异点、避开重复的理由。`
}

function buildPantsActionPlannerCandidatePool(
  mainHandVisibility: PantsMainHandVisibility,
): string {
  const views: PantsPoseView[] = ['back', 'front', 'left', 'right']
  return views.map((view) => {
    const candidates = getPantsPoseLibraryForView(view)
      .filter((card) => isPantsActionPlannerCandidate(card, mainHandVisibility))
      .map((card) => {
        const visibility = getPantsPoseVisibility(card)
        const support = card.support ? `；support=${card.support.type}` : ''
        const handText = mainHandVisibility === 'visible'
          ? `；hand=${card.hand}`
          : ''
        return `- ${card.id}｜visualFamily=${visibility.visualFamily}｜silhouetteHint=${visibility.mustShow}${handText}；legs=${card.legs}${support}`
      })
      .join('\n')
    return `## ${getPantsPoseViewLabel(view)}候选\n${candidates}`
  }).join('\n\n')
}

function isPantsActionPlannerCandidate(
  card: PantsPoseCard,
  mainHandVisibility: PantsMainHandVisibility,
): boolean {
  const visualFamily = getPantsPoseVisualFamily(card)
  if (mainHandVisibility === 'hidden') {
    if (isPantsHandDependentVisualFamily(visualFamily)) return false
    if (card.support) return false
    return true
  }
  if (hasPantsDangerousVisibleHandPlanText(card.hand)) return false
  return true
}

export function buildPantsPlannerSystemPrompt(
  resultCount: PhotoFissionResultCount,
  recentActionHints: readonly string[] = [],
  detailAvailability: PantsDetailAvailability = {
    hasFrontDetail: false,
    hasSideDetail: false,
    hasBackDetail: false,
  },
  mainHandVisibility: PantsMainHandVisibility = 'hidden',
): string {
  const blueprint = getPantsShotBlueprintForCount(resultCount)
  const distribution =
    resultCount === 2
      ? '2 张必须是：1 张正面、1 张侧面（左侧、右侧或微微侧一点都可以）。'
      : resultCount === 4
        ? '4 张必须是：1 张正面、1 张左侧面、1 张右侧面、1 张背面。'
        : resultCount === 10
          ? '10 张必须是：1 张背面、3 张正面、3 张左侧面、3 张右侧面。'
          : '9 张用于历史兼容，必须覆盖背面、正面、左侧面和右侧面，全部沿用参考背景。'
  const requiredShots = blueprint
    .map(
      (shot, index) => {
        const shotId = `shot_${index + 1}`
        return `${shotId}：${shot.label}。方向硬约束：${getPantsPoseDirectionRule(shot.view)} 你必须从姿势库里为这个 shotId 选择一张符合方向的姿势卡 id 写入 poseCardId 字段。${adaptPantsTextForHandMode(shot.description, mainHandVisibility)}。${buildPantsShotReferenceInstruction(shot, detailAvailability)}`
      },
    )
    .join('\n')
  const recentPoseRules = buildRecentPantsPoseRuleSection(recentActionHints)
  const poseLibrary = buildPantsPoseLibraryPrompt().replace(
    '使用方式：每个 shotId 最终只能执行后端注入的一张唯一指定姿势卡；Planner 可阅读卡库理解方向和动作边界，但不能输出第二套动作，也不能把“相似姿势”写成替代方案。',
    '使用方式：姿势卡库是你的动作参考教材，帮助你理解裤子商品图可接受的动作范围和安全边界。每个 shotId 必须选择一张卡作为基础写入 poseCardId，并将该卡的姿势语义写进 finalPrompt 的 POSITIVE PROMPT 段；你可以在此基础上微调站距、脚位、重心、角度等细节来增加多样性，但不能违反安全规则，也不能完全脱离卡库自创与所有卡都无关的姿势。'
  )

  const handModeInstruction = mainHandVisibility === 'visible'
    ? '本次为露手模式。你必须在每个 shotId 的 finalPrompt 正向段中写入选定姿势卡的 hand 字段描述（手部动作、手臂位置、手掌状态），与腿部动作一起组成完整 pose。上衣款式、颜色、图案、袖长、袖口和可见范围必须与图1一致。\n\n【双手下垂风险防范】生图模型无法正确渲染"手在身后"的透视关系，会把没有明确弯曲、搭靠或抬起的手臂默认画成垂直下垂贴身侧。finalPrompt 正向段中的手部描述必须让生图模型能明确识别手臂的弯曲方向和手部位置，不能留模糊空间。以下描述模式已知会导致生图模型生成双手下垂，严禁出现在 finalPrompt 正向段中："hands behind body"、"hands placed behind body"、"hands hidden"、"arms tucked behind body"、"other hand placed behind body and not visible"、"hands at low level"、"low level hands"，以及任何含 "behind body"、"hidden"、"not visible"、"low level" 的手部描述。如果姿势卡的 hand 字段含上述危险描述，你必须改写为双手搭腰、交叉抱臂、单手搭腰另一手明确弯曲等高位可见动作；改写后手部动作必须明确写出"手在腰部/胸前/腰侧"等高位位置，手臂有明确弯曲。'
    : '本次为不露手模式。你不得在任何 shotId 的 finalPrompt 正向段中写任何手部、手臂、手掌、手指相关的描述词；finalPrompt 正向段只写腿脚动作（站距、脚位、重心、膝盖弯曲、脚尖方向等），完全不提手。'

  const handsDownCheckStep = mainHandVisibility === 'visible'
    ? '\n2.5. 双手下垂风险检查：逐张检查 finalPrompt 正向段中的手部描述，判断是否可能导致生图模型生成双手下垂。判断标准：把手部描述单独拿出来看，手臂是否有明确的弯曲方向和高位落点？如果描述含"身后"、"隐藏"、"不可见"、"低位"等模糊词，或手臂没有明确弯曲到腰部/胸前/腰侧等高位，标记为危险，在步骤 3 重写时改为安全的高位可见手部动作。'
    : ''

  const categoryRequirement = adaptPantsTextForHandMode(
    PANTS_CATEGORY_REQUIREMENT,
    mainHandVisibility,
  )
  const actionControl = adaptPantsTextForHandMode(
    PANTS_ACTION_CONTROL,
    mainHandVisibility,
  )
  const styleAnchor = adaptPantsTextForHandMode(
    PANTS_STYLE_ANCHOR,
    mainHandVisibility,
  )
  const negativeAddon = adaptPantsTextForHandMode(
    PANTS_NEGATIVE_ADDON,
    mainHandVisibility,
  )
  const referenceFramePolicy = mainHandVisibility === 'visible'
    ? '有手模式允许按姿势卡需要扩展到半身或全身；上衣款式、颜色、图案、袖长、袖口、鞋子、人物比例和状态按图1。'
    : '胸口以上区域不进入画面，画面上边缘与主图上边缘对齐，上衣露出范围按主图，人物比例和状态只按图1。'
  const forbiddenShotTypes = mainHandVisibility === 'visible'
    ? '必须按下面 shotId 顺序输出，不能调换角色，不能改成外景、坐姿、局部细节、头像、只拍上半身或非裤子主体图：'
    : '必须按下面 shotId 顺序输出，不能调换角色，不能改成外景、坐姿、局部细节、头像、上半身图或完整人物全身照：'

  return `# 角色

你是「AI 服装大片裂变」中裤子品类的分镜导演。用户上传 1 张裤子穿着主图，可选上传正面、侧面、背面平铺细节图。你负责在每个 shotId 固定的方向家族内安排商品展示与参考图证据边界，从姿势卡库中为每个 shotId 选择一张姿势卡，并亲自写出可直接给生图模型使用的 finalPrompt。你一次看到全部 ${resultCount} 个 shotId 的指令，必须在一次思考中完成全部 ${resultCount} 段的起草，然后统一自检这 ${resultCount} 段的角度、手部模式、poseCardId、手脚姿势语义是否重复；如果有重复，换一个不同视觉族的姿势重写（方向家族保持不变），确保全部 ${resultCount} 个姿势都是独立动作后再输出最终 JSON。人物状态只根据图1。

# 参考图变量边界

主图的画面边界、相机距离、人物大小、身体比例、腿长、上衣款式、颜色、图案、袖长、袖口、实际露出范围、鞋子款式、已有低位配饰、背景、光线和画面风格全部由图1读取。图1是否露手也是构图证据；主图不露手时（默认模式），你不得在任何字段中写手部描述，后端会自动注入 no hands 负向提示词；只有图1清楚露手时你才可以在 pose 字段中写入手部动作。裤子的穿着版型、宽松度、裤长基准、裤脚宽度和整体廓形以图1穿着效果为准。图1的站姿、裤脚垂坠和裤脚与脚或鞋的原始遮挡关系不得覆盖你选择的姿势卡；脚或鞋可以被裤脚遮挡，不要求完整展示，指定腿部动作带来的自然褶皱、裤脚高度投影和鞋脚露出变化必须保留。

每个镜头独立出图，并按该 shotId 后列出的顺序收到参考图片。每个角度最多有2张商品细节图：正面镜头只收到图1主图与正面细节图；左侧/右侧镜头只收到图1主图与侧面细节图；背面镜头只收到图1主图与背面细节图。只有用户实际上传的图片才会加入，缺失位置会被跳过并重新连续编号。细节图只作为商品局部证据，不参与姿势、身体朝向、构图边界、人物比例、上衣、鞋子、背景或光线，也不能证明另一条腿、另一侧或背面存在同款 logo / 图案 / 口袋。finalPrompt 只允许提及该 shotId 明确列出的图片，绝对不要提及不存在的参考图。不要自行写死颜色、材质、图案、商品结构、道具、背景或外景。${referenceFramePolicy}

${categoryRequirement}

${actionControl}

# 本次手部模式

${handModeInstruction}

${styleAnchor}

${poseLibrary}

# 姿势选择与语义去重规则

- 你必须从上方姿势卡库中为每个 shotId 选择一张姿势卡，将其 id 写入 poseCardId 字段，并将该卡的姿势语义写进 finalPrompt 的 POSITIVE PROMPT 段。
- 选择的姿势卡方向必须与该 shotId 的方向家族一致：正面 shotId 只能选 front- 开头的卡，左侧选 left- 开头，右侧选 right- 开头，背面选 back- 开头。
- 你一次看到全部 ${resultCount} 个 shotId，必须从语义层面判断选择的姿势是否在视觉上相似。例如“脚尖点地”在正面和背面看起来都是一脚尖点地另一脚承重，视觉相似，不应同时选择；“交叉步”和“开放三角”都是一腿跨出，视觉可能相似。
- 同一批 ${resultCount} 张图选择的姿势卡必须在视觉动作上互不相似：不同动作族、不同腿型轮廓、不同重心分布。不得仅靠方向变化或左右镜像来制造差异。
- 如果同一方向需要多张，例如 10 张里的 3 张正面、3 张左侧、3 张右侧，必须为同方向选择视觉差异最大的姿势卡，且同方向多张必须错开摄像角度：正面 3 张分别用正面、微左约10°、微右约10°；侧面 3 张分别用约30°、约60°、约90°。
- 姿势变化不能遮挡裤身主要商品区域，不能改变主图裤子版型、裤长基准、裤脚宽度或人物比例；指定姿势可以改变裤脚垂坠、自然褶皱、鞋子露出程度和鞋脚遮挡逻辑。
- Planner 不看图片，不能判断口袋、道具或头发是否存在；自动策划时不要直接选择依赖这些证据的条件互动姿势。台阶、栏杆、透明金属椅子和台面只能在姿势卡明确写出时才可选择。
- 受控支撑物姿势只在 10 张模式允许选择，整批最多 2 张。

# 内部语义自检流程（必须在思考阶段完成，只输出最终定稿）

1. 起草：为全部 ${resultCount} 个 shotId 逐一选择姿势卡，并写出可直接给生图模型使用的 finalPrompt。
2. 自检：将 ${resultCount} 段 finalPrompt 的角度、手部动作、腿脚动作和 poseCardId 两两比较，判断是否存在语义重复——包括动作种类相同、侧面镜像雷同、腿型轮廓相似、摄像角度相近。${handsDownCheckStep}
3. 重写：发现重复或双手下垂风险时，保留其中一张或保留安全的那张，其余从姿势库换一个不同视觉族的姿势卡重写 finalPrompt，方向家族保持不变；双手下垂风险的重写只需改写手部动作为高位可见动作，不需要换卡。
4. 定稿：确认全部 ${resultCount} 个姿势都是独立动作、同方向角度已错开后，才输出最终 JSON。思考过程不要写进 finalPrompt，只输出定稿。
${recentPoseRules}

# ${resultCount} 张图固定分布

${distribution}

${forbiddenShotTypes}
${requiredShots}

# 输出格式（严格 JSON）

直接输出以下结构的 JSON，不要解释、不要前言后语、不要 markdown 代码围栏。finalPrompt 字段必须是你亲自写好的最终生图提示词，不是摘要，不是规则列表，不是占位符。**finalPrompt 必须用英文撰写**，因为最终提示词直接发送给 Gemini 图片生成模型，英文提示词效果更好：

{
  "shots": [
    {
      "shotId": "shot_1",
      "role": "back view pants product photo",
      "view": "back",
      "angle": "back +/-15deg",
      "poseCardId": "back-single-waist-toe-point",
      "finalPrompt": "POSITIVE PROMPT: ... NEGATIVE PROMPT: ...",
      "selfCheck": "view=back, angle token exact, handMode=${mainHandVisibility}, pose differs from all other shots by ..."
    }
  ]
}

finalPrompt 必须包含两个英文段落标题：
- POSITIVE PROMPT: 正向生图描述，写清楚商品图类型、方向角度、构图裁切、裤子主体、姿势卡的手脚动作、参考图证据边界、背景光线、真实布料质感。
- NEGATIVE PROMPT: 负向约束，写清楚禁止生成的内容、伪影、商品结构迁移、错误姿势、错误身体范围。

标准 angle token 必须逐字使用，不能自创近义词：
${buildPantsPlannerAngleTokenList(resultCount)}

要求：
- shots 数量必须等于 ${resultCount}。
- shotId 必须从 shot_1 连续到 shot_${resultCount}。
- view 必须与固定分布一致。
- angle 必须逐字使用上面的标准 token。
- poseCardId 必须是姿势卡库里真实存在的 id，方向必须与该 shotId 的方向家族一致。
- finalPrompt 必须写入你从姿势卡选择的姿势语义，不能为空或只写按姿势卡执行。
- selfCheck 必须说明本张 angle、handMode、姿势差异点，以及它如何避开其它 shot 的重复。
- 每段只允许使用对应 shotId 后写明的参考图编号与角度分工；缺失图片已经被跳过，不得出现任何未列出的细节图名称或错误编号。
- 每段都要用英文说明"patterns, patches, embroidery, logos, stitching, pockets and other product details must only reproduce what is clearly visible in reference images; do not generate, mirror, or relocate elements without evidence"，不要列举或暗示参考图中没有证据的具体结构。
- 所有镜头都沿用参考图背景和光线，不生成蓝天草地、街景、建筑、人群或生活故事；除姿势卡明确含受控支撑物时，才允许写该支撑物。
- POSITIVE PROMPT 只写要生成的正向画面内容；不要在 POSITIVE PROMPT 写 no / without / not visible / exclude 这类排除语。所有 no hands、no arms、no head、no face、no full body 等排除约束只能写进 NEGATIVE PROMPT。
- 无手模式（handMode=hidden）：POSITIVE PROMPT 不能出现 hand / arm / palm / finger / wrist / elbow 等手部词，也不能写 full body / upper body / head / face；NEGATIVE PROMPT 必须包含 no hands / no arms / no visible hands 类约束。
- 有手模式（handMode=visible）：POSITIVE PROMPT 必须写明确手部造型，禁止 both hands down、hands naturally at sides、arms hanging、双手下垂、自然摆放、贴裤缝、贴大腿外侧等危险动作。

${negativeAddon}`
}

function buildPantsPlannerAngleTokenList(
  resultCount: PhotoFissionResultCount,
): string {
  const tokensByCount: Record<PhotoFissionResultCount, readonly string[]> = {
    2: ['shot_1: front +/-15deg', 'shot_2: side 45-75deg'],
    4: [
      'shot_1: front +/-15deg',
      'shot_2: left 45-75deg',
      'shot_3: right 45-75deg',
      'shot_4: back +/-15deg',
    ],
    9: [
      'shot_1: back +/-15deg',
      'shot_2: front 0deg',
      'shot_3: front left <=15deg',
      'shot_4: front right <=15deg',
      'shot_5: left 30deg',
      'shot_6: left 60deg',
      'shot_7: left 90deg',
      'shot_8: right 45-75deg',
      'shot_9: right 75-95deg',
    ],
    10: [
      'shot_1: back +/-15deg',
      'shot_2: front 0deg',
      'shot_3: front left <=15deg',
      'shot_4: front right <=15deg',
      'shot_5: left 30deg',
      'shot_6: left 60deg',
      'shot_7: left 90deg',
      'shot_8: right 15-45deg',
      'shot_9: right 45-75deg',
      'shot_10: right 75-95deg',
    ],
  }
  return tokensByCount[resultCount].map((token) => `- ${token}`).join('\n')
}

function buildPantsShotReferenceInstruction(
  shot: PantsShotBlueprint,
  detailAvailability: PantsDetailAvailability,
): string {
  const angle = getPantsReferenceAngleForView(shot.view)
  const angleLabel = getPantsAngleLabel(angle)
  const referenceSlots = getPantsShotReferenceSlots(
    detailAvailability,
    shot.view,
  )

  if (referenceSlots.length === 0) {
    return `本镜头输入只有图1主图；裤子版型和${angleLabel}可见商品证据只按图1清楚可见内容保守呈现，不得提及任何细节图，不得从其它角度推测或迁移 logo、图案、口袋、刺绣、贴布和拼接`
  }

  const references = referenceSlots
    .map((slot, index) => {
      const label = getPantsAngleLabel(slot.angle)
      return `图${index + 2}${label}细节${slot.ordinal}只锁定图中清楚可见的商品局部证据，不控制腿脚姿势、身体朝向、构图边界或完整裤身轮廓`
    })
    .join('；')
  const targetCount = referenceSlots.filter((slot) => slot.angle === angle).length
  const targetFallback =
    targetCount > 0
      ? `${angleLabel}商品细节以 ${targetCount} 张${angleLabel}细节图和图1共同清楚可见的证据为准；局部放大图只证明局部，不扩展成另一条腿、另一侧或整条裤子的结构`
      : `没有${angleLabel}细节图，${angleLabel}商品元素只按图1清楚可见证据保守呈现，其它角度不能代替${angleLabel}结构证据`
  const backStructureGuard =
    angle === 'back'
      ? targetCount > 0
        ? '；背面参考未显示的后袋、袋口、袋盖、贴袋轮廓或口袋缝线视为明确不存在，背面保持连续整片面料，禁止从主图、正面、侧面或常见裤装经验迁移口袋'
        : '；没有背面参考明确证明后袋存在时，背面保持连续整片面料，禁止从主图、正面、侧面或常见裤装经验迁移口袋'
      : ''
  return `本镜头输入依次为图1主图、${referenceSlots.map((slot, index) => `图${index + 2}${getPantsAngleLabel(slot.angle)}细节${slot.ordinal}`).join('、')}；${references}；${targetFallback}${backStructureGuard}；logo、刺绣、贴布、图案、拼接、口袋和侧缝不得换腿、换面、镜像或移动位置；不得提及未列出的图片`
}

function formatRecentPantsPoseHints(recentActionHints: readonly string[]): string {
  if (recentActionHints.length === 0) return ''
  return `本次处在裤子姿势避重阶段，禁止复用这些上一轮/前两轮已经用过的姿势角度元素：${recentActionHints.join('、')}。`
}

function buildRecentPantsPoseRuleSection(recentActionHints: readonly string[]): string {
  if (recentActionHints.length === 0) {
    return '- 当前没有跨批姿势避重列表，但仍必须保证本批内部每张图姿势角度不同。'
  }
  return `- 当前处在裤子姿势避重阶段，下面这些上一轮/前两轮已经使用过的姿势角度元素本次不能复用：${recentActionHints.join('、')}。
- 你必须为本批设计新的角度细分、腿脚站姿、重心和低位手部动作，避免与上述列表重复。`
}
