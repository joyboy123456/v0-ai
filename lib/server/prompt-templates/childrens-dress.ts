/**
 * 童装 / 连衣裙 专属 prompt 模板。
 *
 * 设计来源（v4）：
 * - 衣百 AIGC 提示词库 3,977 条 gemini3pro 案例的「场景叙事」公式
 *   （参考 `.trellis/tasks/05-18-pose-fission/research/yibaiaigc-prompt-engineering.md`）
 * - 用户提供的女装范例（海堤回头侧身 + 双手插袋 + 望远方）作为叙事写法样本
 * - 用户提供的草地外景 JSON 预设（场景常量直接抄录）
 * - 客户「连衣裙.rtf」标准答案 + 3 张参考图灵感
 *
 * 设计原则（v4 终稿）：
 * - **每个 shot description 是一段完整的场景叙事**（不再用列举式"任选一种"）
 * - **动作丰富有交互**：跟裙摆互动 / 跟头发互动 / 跟环境互动（蹲、转、踮脚、回头、伸手等）
 * - **show not tell**：用具体动作 + 微表情 + 视线方向让模型推理出"邻家小姑娘可爱"，不直接说"可爱"
 * - **镜头描述轻**：把笔墨集中在动作和情绪，镜头景别让模型自由判断
 * - 9 张图固定结构：shot_1~6 = 6 段不同的内景叙事；shot_7 = 坐姿（白色金属折叠椅 + 单手提裙）；shot_8/9 = 外景（蓝天草地）
 */

import type { PhotoFissionChildrensCategory } from '@/lib/types'

export interface ChildrensCategoryShotBlueprint {
  label: string
  description: string
}

/**
 * 童装 / 连衣裙 9 shot 蓝图（v4 终稿）：
 *
 * 每个 shot description 是一段完整的场景叙事，由 service 层 `buildShotSection` 拼接到 SHOT 段，
 * 直接成为模型推理的核心剧本。表情与气质走 show not tell 路线，动作丰富 + 与裙/头发/环境互动。
 *
 * 注意：description 里不再写"角度数值"（如"微侧 15°"），让模型按叙事自由选择镜头；
 *      不再写"任选一种"的池子，每个 shot 是一段不同的故事。
 */
export const CHILDRENS_DRESS_SHOT_BLUEPRINT: ReadonlyArray<ChildrensCategoryShotBlueprint> = [
  {
    label: '回眸提裙',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正背对镜头站立，身体重心微微落在一只脚上，两只手的手指轻轻捏起裙摆两侧自然向外展开，像是要给身后的某个人展示这条新裙子；她微微回头看向镜头，下巴微微抬起，嘴角轻轻上扬抿成一个浅浅的笑，眼睛因为笑意微微弯起，发梢自然垂落在肩头。整体姿态像在家中客厅被妈妈悄悄叫住回头的瞬间，松弛自然、毫无摆拍痕迹',
  },
  {
    label: '蹲身互动',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正在地面上轻轻蹲下，双膝并拢、裙摆在身前自然铺成一个柔软的弧形覆盖在膝盖上，一只手的手指轻轻抚摸着裙摆上的面料或图案，仿佛在好奇地端详裙子的细节，另一只手自然撑在身侧的地面或膝盖旁；她微微低头又抬起目光看向镜头，嘴角弯出一抹小小的笑意，眼神带着一点专注又一点俏皮。整体像在自家小院里发现了什么有趣东西、被人喊住抬头的小女孩，自然真实',
  },
  {
    label: '双手背后踮脚',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正面朝向镜头自然站立，双手在身后轻轻交握，身体微微向左侧倾、一只脚的脚尖微微踮起，裙摆随着这个轻盈的姿态自然轻晃；她头微微歪向一侧、下巴轻抬，嘴唇抿成一个浅浅的弧，眼睛弯弯地直直看向镜头，发丝随重心偏移自然滑落到一侧肩膀。整体姿态像在等大人给她拍照前自己悄悄摆好的小动作，纯真而不刻意',
  },
  {
    label: '轻拢裙摆侧身',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她身体微微侧向一边自然站立、肩膀放松，一只手的手指自然垂落、指尖轻轻拢着裙摆的一侧让裙身的廓形更清楚地展现出来，另一只手自然垂在身侧；她转过头来看向镜头，嘴唇轻轻抿成一个小小的笑、眼睛微微眯起，下巴的角度刚好露出脖颈的线条，几缕头发被微风吹过般搭在脸颊侧。整体像在户外被人轻声唤名转头的瞬间，松弛、安静又带一点点小骄傲',
  },
  {
    label: '玩发丝甜笑',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正面朝向镜头自然站立，一只手轻轻抬起、手指自然挽起一缕落在脸颊旁的发丝绕在指尖玩弄，另一只手自然垂落或轻轻搭在大腿外侧；她的视线直直看向镜头，嘴角咧开一个抑制不住的小小甜笑、露出一点点小白牙，眼睛因为笑意几乎弯成两弯月牙，整张脸都明亮起来。整体像在跟最喜欢的家人说话、忍不住笑出来的瞬间，亲切又有感染力',
  },
  {
    label: '微转身轻盈',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正在原地轻轻转身的瞬间被定格，裙摆因为这个小动作自然飘起、向斜上方扬起一个柔和的弧度，一只手自然抬起到腰侧像在保持平衡，另一只手轻盈地伸向旁边；她回头看向镜头，嘴唇微微张开像是在轻声笑出来或在哼一段小调子，眼睛因为转身的兴奋微微眯起、眉梢上扬。整体充满轻盈灵动的童趣感，像在自家走廊上转着圈被妈妈拍下的一瞬',
  },
  {
    label: '坐姿（白色金属折叠椅）',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她优雅地坐在一把白色金属折叠椅上——这把椅子的椅腿是 X 形交叉结构、椅面与靠背都是白色金属材质，椅腿在画面里完整可见、不被裙摆遮挡。她坐在椅面的前半段、脊背自然挺直，双腿并拢自然下垂、双脚踏踏实实地踩在地上；一只手的手指轻轻提起裙摆的一侧、让裙身的廓形和面料的垂感自然展开（动作像是要给镜头展示这件裙子，不抓握、不捏紧、不夸张拉扯），另一只手自然搭在膝盖上或轻轻垂落在体侧。她微微歪着头看向镜头，嘴角抿成一个浅浅的笑、眼睛微微弯起。整体气质像在客厅沙发边小憩、对镜头甜甜一笑的小女孩，松弛得体而不超模',
  },
  {
    label: '草地奔跑',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她正在户外草地上轻盈地奔跑或大步迈进的瞬间被定格，裙摆因为奔跑的气流自然向后扬起，发丝也随之飘动，一只手自然抬起摆动、另一只手向后摆出动感；她侧着脸或微微回头看向镜头方向，嘴角咧出一个明亮的笑、眼睛因为奔跑的兴奋而发亮，整张脸洋溢着户外撒欢的快乐。整体充满阳光下奔跑的童年记忆感，自由、明亮、充满生命力',
  },
  {
    label: '草地俏皮回望',
    description:
      '画面呈现一位身着这套连衣裙的年轻亚洲小女孩，她背身或侧身站在草地上、目光向远处的小树苗或天空望去，又像被什么轻轻唤回，正微微回过头来看向镜头；一只手轻轻拢起裙摆的一侧或自然垂在身侧，另一只手抬起到耳边像是要把一缕风吹乱的头发别到耳后，身体的重心放在一只脚上、姿态自然慵懒。她的嘴角带着一抹安静的笑意，眼神温和而明亮。整体像周末午后在小公园里玩到出神、被妈妈轻轻喊住的瞬间，宁静治愈又有童真',
  },
]

/**
 * 外景 shot 白名单（0-indexed）：命中此白名单的 shot，
 * service 层 `buildSceneLockSection` 会把背景从「图1原背景」替换为 `CHILDRENS_DRESS_OUTDOOR_SCENE`。
 *
 * 当前策略：最后 2 个 shot（shot_8 + shot_9）走外景，前 7 个 shot 沿用图1原背景。
 */
export const CHILDRENS_DRESS_OUTDOOR_SHOT_INDICES: ReadonlyArray<number> = [7, 8]

/**
 * 外景常量：蓝天白云草地公园场景（中文版，措辞来源于用户提供的 JSON 预设）。
 * 原始数据：`.trellis/tasks/05-23-childrens-dress-sit-pose-rules/research/outdoor-grassland-scene-preset.md`
 *
 * 由 service 层 `buildSceneLockSection` 在命中 OUTDOOR_SHOT_INDICES 时替换原 SCENE 段使用。
 */
export const CHILDRENS_DRESS_OUTDOOR_SCENE = [
  '【场景呈现 SCENE｜外景蓝天草地】',
  '本张为户外大片：明亮晴朗的户外公园草地场景，大片干净蓝天作为背景，低地平线构图天空留白充足，前景是自然绿色草坪、草地纹理自然微起伏并带自然阳光阴影，远处有几棵稀疏的小树苗、背景轻微虚化（浅景深）。',
  '春夏季清新氛围，自然日光、柔和明亮的日间光线、略偏暖的色温，整体明亮干净无杂物。',
  '商业摄影质感，真实摄影风格，主体居中偏下，35mm–50mm 真实人像镜头感，轻微低机位、温和仰拍，高清细节、主体锐利。',
  '注意：本张**不**沿用图1的房间/室内陈设，背景完全替换为上述户外草地蓝天场景；人物身份、服装细节、整体光质感仍延续图1。',
].join('\n')

/**
 * 外景 shot 专属负面提示词：拼接到 NEGATIVE 段（全模板加也无害）。
 */
export const CHILDRENS_DRESS_OUTDOOR_NEGATIVE = [
  '- 外景 shot 严禁出现：室内场景、城市街道、高楼建筑、车辆、人群、广告牌、电线杆、垃圾桶、背景人物、阴天、雨天、夜晚、强烈雾霾、灰暗天空、过曝天空、脏乱草地、枯黄草坪、复杂道具',
].join('\n')

/**
 * 灵性气质锚点：注入 STYLE 段，给「童装 / 连衣裙」全 shot 通用。
 * v4 调整：从"列举式标签"改为"叙事化指令"，配合 shot description 的叙事写法。
 * show not tell：让模型通过具体动作和微表情推理出"邻家小姑娘"气质，不直接堆砌"可爱/活泼"等抽象词。
 */
export const CHILDRENS_DRESS_STYLE_ANCHOR = [
  '【灵性气质锚点｜童装连衣裙】',
  '- 整体气质参考：像在自家小院、客厅或公园里玩耍的邻家小女孩，被家人轻声唤住回头的自然瞬间被记录下来；禁止超模摆拍、禁止刻意端正',
  '- 让"可爱"通过具体动作+微表情自然流露出来——比如蹲身碰裙摆、双手背后踮脚、回头浅笑、玩发丝甜笑、抿嘴弯眼等小动作；不要在画面里硬塞"活泼可爱"的概念符号',
  '- 9 张图任意两两之间在**动作设计**上必须显著不同（不仅仅是镜头角度不同），动作丰富多元：与裙摆互动 / 与头发互动 / 与环境互动（蹲、转、踮脚、奔跑、回头、伸手等都要分布到不同 shot）',
  '- 表情自然真实：抿嘴浅笑、眼睛弯成月牙、微微歪头、下巴轻抬等小细节；禁止咧嘴大笑（甜笑除外）、闭眼夸张、撅嘴卖萌过度',
  '- 手势规则：站姿/走姿时手势轻柔（轻搭裙边/轻拢发丝/双手交握于身后/手指自然伸展），禁止用力抓握；**坐姿场景例外：允许主动用手提起裙摆做自然展示，体现商业感而非用力拽拉**',
  '- 视线大多看向镜头（建立与观众的代入感），少数 shot 可看向远方/侧前方制造叙事氛围（如草地俏皮回望、回眸提裙等）',
].join('\n')

/**
 * 角度差异化铁律：注入 SHOT 段之前，强制 9 shot 动作分布不雷同。
 * v4 调整：从"角度差异化"重心转移到"动作差异化"，因为用户反馈过去问题是"换镜头不换动作"。
 */
export const CHILDRENS_DRESS_ANGLE_CONTROL = [
  '【动作差异化铁律｜童装连衣裙】',
  '- 本任务 9 张图核心追求是**动作多样化**：每张图的肢体动作、与裙摆/头发/环境的互动方式必须显著不同；禁止"只换镜头角度不换动作"',
  '- 镜头/景别/构图由叙事自然决定，不强求 9 种不同角度；如果叙事需要相同角度，那就相同（如两张正面但动作不同是 OK 的）',
  '- 坐姿 shot 为全任务唯一一个，必须使用**白色金属折叠椅**（X 形椅脚交叉结构、带靠背、椅腿可见）；其它 shot 不得出现椅子或其它座位',
  '- 9 张图中固定 2 张为蓝天白云草地外景（由系统在固定 index 自动注入外景背景），其它 7 张沿用图1原背景',
].join('\n')

/**
 * 童装连衣裙专属负面提示词追加段：拼接到 buildNegativeSection 通用约束之后。
 */
export const CHILDRENS_DRESS_NEGATIVE_ADDON = [
  '【关键约束 - 童装 / 连衣裙 追加】',
  '- 画面中只允许出现参考图明确包含的服装、模特与道具元素；禁止凭空生成参考图未提供的包包、帽子、配饰、装饰物、额外道具（外景 shot 的草地/蓝天/小树苗除外，属于本任务允许的外景常量）',
  '- 道具如有出现，不得遮挡裙子主体；裙摆与版型必须完整可见',
  '- 不要把连衣裙生成成裤装、瑜伽裤、紧身裤、贴腿包裹下装；必须保留裙摆轮廓',
  '- 9 张图之间禁止仅靠镜头角度差异化、动作必须真正不同',
  '- 不要儿童成人化、性感化表达；保持儿童年龄感与自然童趣',
  CHILDRENS_DRESS_OUTDOOR_NEGATIVE,
].join('\n')

/**
 * 按二级品类返回对应蓝图。未来扩展套装等二级品类时在此扩展。
 */
export function getChildrensCategoryShotBlueprint(
  childrensCategory: PhotoFissionChildrensCategory,
): ReadonlyArray<ChildrensCategoryShotBlueprint> | undefined {
  switch (childrensCategory) {
    case 'dress':
      return CHILDRENS_DRESS_SHOT_BLUEPRINT
    default:
      return undefined
  }
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
 * 按二级品类返回外景场景常量（命中 OUTDOOR_SHOT_INDICES 的 shot 替换 SCENE 段）。
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
