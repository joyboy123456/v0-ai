/**
 * 童装 / 连衣裙 专属 prompt 模板。
 *
 * 设计来源（v4）：
 * - 衣百 AIGC 提示词库 3,977 条 gemini3pro 案例的「场景叙事」公式
 *   （参考 `.trellis/tasks/05-18-pose-fission/research/yibaiaigc-prompt-engineering.md`）
 * - 用户提供的女装范例（海堤回头侧身 + 双手插袋 + 望远方）作为叙事写法样本
 * - 客户「连衣裙.rtf」标准答案 + 3 张参考图灵感
 *
 * 设计原则（上架图补丁）：
 * - 只服务 AI 服装大片裂变的童装连衣裙路径
 * - **每个 shot description 都优先服务商品展示**，不是生活方式写真
 * - **动作克制有差异**：轻提裙摆 / 轻迈步 / 脚尖点地 / 坐姿铺裙等都要让裙摆更清楚
 * - **背景低存在感**：默认沿用并弱化图1拍摄环境；白底 / 浅灰白棚拍参考图延续棚拍货架感
 * - 9 张图是受控抽卡裂变：每批动态组合 7 张参考/棚拍基调 + 2 张蓝天白云草地外景补充图
 */

import type { PhotoFissionChildrensCategory } from '@/lib/types'

export interface ChildrensCategoryShotBlueprint {
  label: string
  description: string
  scene?: 'reference' | 'outdoor'
}

/**
 * 童装 / 连衣裙参考/棚拍基调卡池：
 *
 * 每个 shot description 是一段完整的场景叙事，由 service 层 `buildShotSection` 拼接到 SHOT 段，
 * 直接成为模型推理的核心剧本。动作与表情必须服务连衣裙上架图，不写生活故事。
 *
 * 注意：description 里不再写"角度数值"（如"微侧 15°"），让模型按叙事自由选择镜头；
 *      不再写"任选一种"的池子，每个 shot 是一段不同的商品展示动作。
 */
export const CHILDRENS_DRESS_REFERENCE_SHOT_POOL: ReadonlyArray<ChildrensCategoryShotBlueprint> = [
  {
    label: '主图候选全身站姿',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，采用适合测试主图点击率的全身商品图构图，人物居中或轻微居中，从头到脚完整入镜；TA双脚稳定落地，头顶保留少量留白，一只手轻轻搭在裙摆外侧，另一只手自然垂放，裙摆完整展开且自然垂落。裙长、腰线位置、下摆弧度、自然蓬度和整体廓形清楚可见，背景沿用图1拍摄环境并弱化成干净低存在感的商品图陪衬，如果图1是白底或浅灰白棚拍，就延续这种可直接上架的棚拍货架感',
    scene: 'reference',
  },
  {
    label: '轻提裙摆展示',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，身体呈三分之二角度面向镜头自然站立，重心稳定落在后脚，前脚脚尖轻轻点地；一只手轻提裙摆一侧，让裙身垂坠感、下摆弧度和自然蓬度更清楚，另一只手自然放在体侧。TA看向镜头，嘴角自然上扬，眼睛微微弯起，表情甜美但不夸张。画面保持电商主图构图，人物占画面高度约八成以上，脚底有轻微接触阴影，背景干净柔和，方便美工裁切、排版和上架使用',
    scene: 'reference',
  },
  {
    label: '上半身版型细节',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，采用半身近景商品图构图，重点展示领口线条、胸前结构、肩颈比例、面料质感和上半身版型；TA身体轻微转向镜头，手指可以轻轻停在领口附近但不遮挡服装细节。TA微微低头又看向镜头，嘴角保持自然甜美的浅笑。背景沿用图1拍摄环境并弱化，焦点落在连衣裙上半身细节与小朋友自然表情上，画面像详情页可直接使用的童装局部素材',
    scene: 'reference',
  },
  {
    label: '裙摆详情展示',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，镜头更靠近裙身和下摆，重点展示裙摆层次、下摆弧度、面料垂感、自然蓬度和裙长比例；TA一只手的手指轻轻停在裙摆边缘，另一只手自然放松，动作轻柔克制，不拉扯、不遮挡。裙摆可以自然铺开但必须大而不乱，裙长和下摆结构清楚可见。背景低存在感，光线柔和均匀，整体像可直接放入商品详情页的裙摆细节图',
    scene: 'reference',
  },
  {
    label: '侧身廓形展示',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，身体轻微侧向镜头自然站立，肩膀放松，侧身角度用于展示连衣裙从上身到裙摆的整体廓形；一只手轻拢裙摆侧边，另一只手自然垂落，手、头发和任何参考图已有配饰都不能遮挡裙子主体。TA轻轻转头看向镜头，嘴角自然上扬。人物居中或轻微居中，裙摆完整入镜，背景延续图1并保持干净统一的电商棚拍质感',
    scene: 'reference',
  },
  {
    label: '表情手势商品特写',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，采用上半身到大腿附近的商品图特写，保留足够连衣裙信息，不能变成纯人像；TA一只手轻轻抬起做自然小手势，另一只手搭在裙摆或体侧，手势不遮挡领口、胸前结构和腰线。TA看向镜头，眼睛弯成月牙，嘴角自然上扬，脸部可爱甜美。背景低存在感，光线均匀打亮人物和服装，面料细节清楚',
    scene: 'reference',
  },
  {
    label: '坐姿铺裙展示',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，TA优雅地坐在一把白色金属折叠椅上，椅腿呈 X 形交叉结构，椅面与靠背干净简洁，椅腿在画面里完整可见且不被裙摆遮挡。TA坐在椅面的前半段，脊背自然挺直，双腿并拢自然下垂，双脚踏实落在地面；一只手轻轻提起裙摆一侧，让裙身廓形和面料垂感自然展开，另一只手松弛搭在膝盖上。裙摆自然铺开但不乱，腰线、裙长、下摆弧度和整体比例清楚，背景保持低存在感的上架图质感',
    scene: 'reference',
  },
  {
    label: '双手轻拉裙摆',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，采用全身商品图构图，TA双手轻轻拉起裙摆两侧，让下摆弧度和自然蓬度更清楚，但动作幅度保持克制，裙摆不飞起、不变形。TA双脚自然并拢或轻轻错开，脚底完整落地，嘴角自然上扬，看向镜头。人物占画面高度约八成以上，裙身长度、腰线位置、裙摆弧度和整体比例清楚，背景延续图1并保持干净低存在感，适合测试主图或轮播图点击效果',
    scene: 'reference',
  },
  {
    label: '轻微迈步动态',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，在商品图构图中做轻微向前迈步的站姿，身体重心稳定，前脚脚尖轻轻点地，裙摆顺着步伐产生很小的日常摆动；一只手自然搭在裙摆侧边，另一只手放松垂下或轻轻抬起。TA看向镜头旁侧再微微回头，表情自然甜美。动作带来轻微流动感但不抢商品，裙长、腰线、下摆层次和脚底落地关系全部清楚',
    scene: 'reference',
  },
  {
    label: '轻拢发丝展示',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，采用上半身到膝盖附近的商品图构图，一只手轻轻把发丝别到耳后，另一只手自然搭在裙摆边缘或腰侧，头发和手都不遮挡连衣裙主体。TA微微歪头看向镜头，眼睛弯起，嘴角抿出浅笑。画面保留足够的领口、胸前结构、腰线和裙摆信息，背景干净柔和低存在感，整体像详情页里用于增强模特亲和力的上架素材',
    scene: 'reference',
  },
  {
    label: '低头看裙摆',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，身体轻微转向镜头，微微低头看向自己的裙摆，一只手指尖轻碰下摆边缘，另一只手自然垂放；TA的表情安静甜美，动作像在展示裙摆面料和下摆层次。镜头可以是全身或近全身构图，但必须让裙长、腰线位置、裙摆弧度和整体比例清楚。背景延续图1并弱化，视觉焦点落在连衣裙本身，方便美工做轮播图或详情页排版',
    scene: 'reference',
  },
  {
    label: '背后三分之二回看',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，身体呈背后三分之二角度轻轻回看镜头，用于补充展示连衣裙背部轮廓、肩颈比例、腰线连接和裙摆后侧弧度；TA一只手自然搭在裙摆侧边，另一只手放松垂下，脚步稳定站好。画面不能变成纯背影，脸部仍有自然甜美的可见表情，连衣裙主体清楚。背景沿用图1拍摄环境并保持干净低存在感，整体仍是商品展示优先的上架素材',
    scene: 'reference',
  },
]

export const CHILDRENS_DRESS_OUTDOOR_SHOT_POOL: ReadonlyArray<ChildrensCategoryShotBlueprint> = [
  {
    label: '外景蓝天草地站姿',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，站在干净开阔的蓝天白云草地外景中，整体像淘宝童装商品轮播图里可直接使用的种草补充素材；TA正面或轻微正面站在画面中央，双脚稳定落在草地上，一只脚可以轻轻勾脚或脚尖点地，一只手轻搭裙摆外侧，另一只手自然垂放。裙摆顺着站姿自然垂落，只产生轻微日常摆动，裙长、腰线位置、裙摆弧度和整体廓形清楚可见。天空与草地干净柔和，只作为低存在感陪衬，所有视觉注意力集中在小朋友和连衣裙本身',
    scene: 'outdoor',
  },
  {
    label: '外景蓝天草地轻互动',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，处在蓝天白云与干净草地组成的户外电商补充场景里，身体轻微转向镜头，脚步轻轻错开，脚底踏在草地上并保留自然接触阴影；一只手轻提裙摆一侧展示下摆弧度，另一只手可以轻轻整理发丝，但头发和手都不遮挡连衣裙主体。TA嘴角自然上扬，眼神甜美，动作轻柔克制。画面保持商品展示优先，人物占画面高度约八成以上，裙长、腰线、下摆层次、自然蓬度和整体比例清楚，蓝天与草地提供清爽留白，方便美工裁切、排版和作为详情页素材使用',
    scene: 'outdoor',
  },
  {
    label: '外景蓝天草地轻提裙摆',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，在清爽的蓝天白云草地外景中做轻柔的轻提裙摆动作，身体三分之二角度面向镜头，双脚稳定落在草地上；一只手提起裙摆一侧，另一只手自然放在体侧，让裙长、腰线、裙摆弧度和自然蓬度清楚呈现。TA看向镜头，嘴角自然上扬。天空留白干净，草地色块柔和，画面不是公园游玩故事，而是可用于商品轮播图的外景上架素材',
    scene: 'outdoor',
  },
  {
    label: '外景蓝天草地坐姿铺裙',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，坐在干净草地上展示裙摆自然铺开的效果，身体保持端正轻松，双腿姿态自然且不抢画面；一只手轻轻整理裙摆边缘，另一只手自然撑在身侧或搭在膝边。裙摆铺开但不凌乱，裙长、腰线、下摆层次和自然蓬度清楚可见。蓝天白云和草地作为清爽低存在感背景，整体像详情页种草补充图，方便裁切排版',
    scene: 'outdoor',
  },
  {
    label: '外景蓝天草地轻微迈步',
    description:
      '画面呈现一位身着这套连衣裙的小朋友，在蓝天白云草地外景中做轻微迈步的全身商品图，身体重心稳定，前脚脚尖轻轻点在草地上，脚底有自然接触阴影；裙摆只产生细微摆动，轮廓完整清楚。一只手轻搭裙摆，另一只手自然放松，TA看向镜头自然甜笑。画面人物占比充足，天空与草地提供干净留白，适合作为淘宝轮播图测试素材',
    scene: 'outdoor',
  },
]

export const CHILDRENS_DRESS_SHOT_BLUEPRINT: ReadonlyArray<ChildrensCategoryShotBlueprint> =
  buildChildrensDressShotBlueprint()

/**
 * 旧版固定外景下标白名单。
 * @deprecated 童装连衣裙现在由 shot blueprint 的 scene 字段控制外景抽卡，
 * 外景不再绑定固定下标。保留空数组仅兼容旧导入。
 */
export const CHILDRENS_DRESS_OUTDOOR_SHOT_INDICES: ReadonlyArray<number> = []

/**
 * 蓝天白云草地外景常量：抽中 outdoor 场景卡时替换 SCENE 段。
 */
export const CHILDRENS_DRESS_OUTDOOR_SCENE = [
  '【场景呈现 SCENE】',
  '这是童装连衣裙抽卡裂变中的蓝天白云草地外景补充图，场景使用开阔干净的户外草地、蓝天与白云，整体保持可直接作为淘宝轮播图或详情页种草素材的商品展示感。',
  '天空与草地只作为清爽柔和的低存在感陪衬，远处自然元素保持轻微虚化和低对比，画面不加入复杂街景、建筑、人群或生活道具。',
  '人物和连衣裙仍是绝对主体，人物从头到脚完整入镜并占画面高度约八成以上，脚底在草地上保留轻微接触阴影，方便美工后期裁切、排版和上架使用。',
].join('\n')

/**
 * 历史兼容导出：外景限制已内化到 SCENE / SHOT / NEGATIVE_ADDON。
 */
export const CHILDRENS_DRESS_OUTDOOR_NEGATIVE = ''

/**
 * 灵性气质锚点：注入 STYLE 段，给「童装 / 连衣裙」全 shot 通用。
 * v4 调整：从"列举式标签"改为"叙事化指令"，配合 shot description 的叙事写法。
 * show not tell：让模型通过具体动作和微表情推理出"邻家小姑娘"气质，不直接堆砌"可爱/活泼"等抽象词。
 */
export const CHILDRENS_DRESS_STYLE_ANCHOR = [
  '【灵性气质锚点｜童装连衣裙】',
  '- 整体气质参考：专业儿童电商时尚上架图，亲切自然、甜美可爱，但所有情绪都服务于连衣裙展示',
  '- 9 张图是受控抽卡裂变：每批动态组合 7 张棚拍 / 参考背景货架感素材 + 2 张蓝天白云草地外景补充图；外景位置不固定，但外景仍是商品素材，不写成生活故事',
  '- 让"可爱"通过具体动作+微表情自然流露出来——比如轻提裙摆、脚尖点地、微微歪头、抿嘴弯眼等小动作；不要在画面里硬塞生活故事概念',
  '- 9 张图任意两两之间在**动作设计**上必须显著不同（不仅仅是镜头角度不同），动作丰富但克制：与裙摆互动 / 与头发轻互动 / 坐姿铺裙等都要让裙摆更清楚',
  '- 表情自然真实：抿嘴浅笑、眼睛弯成月牙、微微歪头、下巴轻抬等小细节；禁止咧嘴大笑（甜笑除外）、闭眼夸张、撅嘴卖萌过度',
  '- 手势规则：站姿/走姿时手势轻柔（轻搭裙边/轻拢发丝/双手交握于身后/手指自然伸展），禁止用力抓握；**坐姿场景例外：允许主动用手提起裙摆做自然展示，体现商业感而非用力拽拉**',
  '- 视线大多看向镜头（建立与消费者的代入感），少数 shot 可看自己的裙摆或镜头旁侧前方，但不能变成环境人像',
].join('\n')

/**
 * 角度差异化铁律：注入 SHOT 段之前，强制 9 shot 动作分布不雷同。
 * v4 调整：从"角度差异化"重心转移到"动作差异化"，因为用户反馈过去问题是"换镜头不换动作"。
 */
export const CHILDRENS_DRESS_ANGLE_CONTROL = [
  '【动作差异化铁律｜童装连衣裙】',
  '- 本任务 9 张图核心追求是**动作多样化**：每张图的肢体动作、与裙摆/头发/环境的互动方式必须显著不同；禁止"只换镜头角度不换动作"',
  '- 镜头/景别/构图由抽到的商品展示卡自然决定，不强求固定正面、侧面、细节顺序；如果两张都是全身，也必须靠动作、情绪和卖点展示拉开差异',
  '- 坐姿不是每批必出；如果抽到椅子坐姿，使用**白色金属折叠椅**（X 形椅脚交叉结构、带靠背、椅腿可见），并让裙摆、腰线、脚底关系清楚',
  '- 每批随机 7 张沿用并弱化图1拍摄环境；白底 / 浅灰白棚拍参考图要延续干净棚拍货架感',
  '- 每批随机 2 张使用蓝天白云草地外景，但外景只作为干净种草补充场景，人物占比、裙摆展示和商品清晰度仍按上架图标准执行',
].join('\n')

/**
 * 童装连衣裙专属负面提示词追加段：拼接到 buildNegativeSection 通用约束之后。
 */
export const CHILDRENS_DRESS_NEGATIVE_ADDON = [
  '【关键约束 - 童装 / 连衣裙 追加】',
  '- 画面中只允许出现参考图明确包含的服装、模特与道具元素；禁止凭空生成参考图未提供的包包、帽子、配饰、装饰物、额外道具',
  '- 道具如有出现，不得遮挡裙子主体；裙摆与版型必须完整可见',
  '- 不要把连衣裙生成成裤装、瑜伽裤、紧身裤、贴腿包裹下装；必须保留裙摆轮廓',
  '- 9 张图之间禁止仅靠镜头角度差异化、动作必须真正不同',
  '- 不要儿童成人化、性感化表达；保持儿童年龄感与自然童趣',
  '- 除每批抽到的 2 张蓝天白云草地外景补充图外，不主动把参考图的棚拍或室内背景替换成户外、公园、泳池、滨海、街景或复杂生活场景',
  '- 蓝天白云草地外景必须是干净蓝天、白云、草地的商品补充图，不写奔跑、跳跃、旋转、大幅甩裙或环境人像式构图',
].join('\n')

function buildChildrensDressShotBlueprint(): ReadonlyArray<ChildrensCategoryShotBlueprint> {
  const referenceShots = takeRandom(
    CHILDRENS_DRESS_REFERENCE_SHOT_POOL,
    7,
  )
  const outdoorShots = takeRandom(CHILDRENS_DRESS_OUTDOOR_SHOT_POOL, 2)
  return shuffle([...referenceShots, ...outdoorShots])
}

function takeRandom<T>(items: ReadonlyArray<T>, count: number): T[] {
  return shuffle([...items]).slice(0, count)
}

function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = items[index]
    items[index] = items[swapIndex]
    items[swapIndex] = current
  }
  return items
}

/**
 * 按二级品类返回对应蓝图。未来扩展套装等二级品类时在此扩展。
 */
export function getChildrensCategoryShotBlueprint(
  childrensCategory: PhotoFissionChildrensCategory,
): ReadonlyArray<ChildrensCategoryShotBlueprint> | undefined {
  switch (childrensCategory) {
    case 'dress':
      return buildChildrensDressShotBlueprint()
    default:
      return undefined
  }
}

/**
 * 按二级品类和出图数量返回对应蓝图。
 *
 * 场景分布规则：
 * - 2/4 张：全部 reference（无外景）
 * - 9 张：7 reference + 2 outdoor（向后兼容）
 * - 10 张：8 reference + 2 outdoor
 */
export function getChildrensCategoryShotBlueprintForCount(
  childrensCategory: PhotoFissionChildrensCategory,
  resultCount: number,
): ReadonlyArray<ChildrensCategoryShotBlueprint> | undefined {
  if (childrensCategory !== 'dress') return undefined

  const refPool = CHILDRENS_DRESS_REFERENCE_SHOT_POOL
  const outPool = CHILDRENS_DRESS_OUTDOOR_SHOT_POOL

  const outdoorCount = resultCount >= 9 ? 2 : 0
  const referenceCount = resultCount - outdoorCount

  const referenceShots = takeRandom(refPool, Math.min(referenceCount, refPool.length))
  const outdoorShots = outdoorCount > 0
    ? takeRandom(outPool, Math.min(outdoorCount, outPool.length))
    : []

  return shuffle([...referenceShots, ...outdoorShots])
}

/**
 * 按二级品类返回灵性气质锚点；其它二级品类未实现时返回 undefined（caller 走默认）。
 */
export function getChildrensCategoryStyleAnchor(
  childrensCategory: PhotoFissionChildrensCategory,
): string | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_STYLE_ANCHOR
    default:
      return undefined
  }
}

/**
 * 按二级品类返回角度差异化铁律。
 */
export function getChildrensCategoryAngleControl(
  childrensCategory: PhotoFissionChildrensCategory,
): string | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_ANGLE_CONTROL
    default:
      return undefined
  }
}

/**
 * 按二级品类返回负面提示词追加段。
 */
export function getChildrensCategoryNegativeAddon(
  childrensCategory: PhotoFissionChildrensCategory,
): string | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_NEGATIVE_ADDON
    default:
      return undefined
  }
}

/**
 * 按二级品类返回外景场景常量（抽中 outdoor 场景卡的 shot 替换 SCENE 段）。
 */
export function getChildrensCategoryOutdoorScene(
  childrensCategory: PhotoFissionChildrensCategory,
): string | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_OUTDOOR_SCENE
    default:
      return undefined
  }
}

/**
 * 按二级品类返回外景 shot 白名单（0-indexed shot index）。
 */
export function getChildrensCategoryOutdoorShotIndices(
  childrensCategory: PhotoFissionChildrensCategory,
): ReadonlyArray<number> | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_OUTDOOR_SHOT_INDICES
    default:
      return undefined
  }
}
