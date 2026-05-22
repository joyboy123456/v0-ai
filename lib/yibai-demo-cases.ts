// 共 26 条 demo task (6 原批 + 20 二批)
import type { GenerationTask, PhotoFissionCase } from './types'

/**
 * yibaiaigc.com 演示数据（仅 MVP 阶段不上线、不商用）。
 *
 * 这些图片和 prompt 用于让"AI 服装大片"案例库 Tab、"服装大片裂变"案例库
 * 在没有真实生成历史时就能展示丰富内容，方便老板演示。
 *
 * 图片资源全部走 yibaiaigc 阿里云 OSS 公开直链，不下载到本仓库，
 * 避免 git 仓库被 ~150MB 大图污染。OSS 链已实测可直接外链访问。
 *
 * 上线前必须替换为本平台真实生成的素材，并删除整个文件。
 */

/**
 * AI 服装大片演示 task（不入持久化 task-store）。
 * 在 right-panel.tsx 的 aiFashionGalleryItems 中追加合并到瀑布流末尾，
 * 让「案例库」Tab 始终能看到一组高质量演示成片，点击「做同款」可一键回填参数。
 *
 * inputAssets 字段：占位用 demo 图自身 OSS URL 作为参考图，目的是让
 * AiFashionMasonryGallery 的 canUseSameStyle 判定为 true，按钮可点。
 * left-panel.tsx fashionRemixRequest useEffect 只读 params，不消费 inputAssets 内容。
 *
 * ratio normalize 规则：yibai 原始 ratio 中不在 FashionImageRatio 支持范围
 * （'4:5' / '5:4' / '16:9' / '9:16' / '21:9'）的，统一回退为 '3:4'。
 * 这样「做同款」回填到表单时不会被 FASHION_IMAGE_RATIOS.some 校验拒绝。
 */
export const AI_FASHION_DEMO_TASKS: GenerationTask[] = [
  {
    // yibai id=13193 ratio=3:4
    taskId: 'demo-yibai-fashion-13193',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13193-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13193-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13193.jpg',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/9333e2b6-97a5-47ae-b907-3f53df31fef2.jpg',
        fileType: 'image/jpeg',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `平视中景复古胶片风户外时尚人像摄影，带细腻胶片颗粒，低饱和冷调高清写实，无厚重滤镜，白日柔和自然漫射光照射，明暗过渡柔和。慵懒气质的中国年轻女模特留深棕微卷长发，神色清冷直视镜头，慵懒自然的站立着，背靠在粗粝毛石墙上，左手插兜右手自然垂落。她穿着这套服装。背景是深灰绿、黄棕色天然毛石搭配米白水泥填缝的粗粝石墙，底部为带细碎黑点的浅灰色水磨石地面，整体氛围随性冷冽，充满松弛的复古轻熟穿搭质感。人物近景半身照，人物占画面的四分之三。`,
      userPrompt: `平视中景复古胶片风户外时尚人像摄影，带细腻胶片颗粒，低饱和冷调高清写实，无厚重滤镜，白日柔和自然漫射光照射，明暗过渡柔和。慵懒气质的中国年轻女模特留深棕微卷长发，神色清冷直视镜头，慵懒自然的站立着，背靠在粗粝毛石墙上，左手插兜右手自然垂落。她穿着这套服装。背景是深灰绿、黄棕色天然毛石搭配米白水泥填缝的粗粝石墙，底部为带细碎黑点的浅灰色水磨石地面，整体氛围随性冷冽，充满松弛的复古轻熟穿搭质感。人物近景半身照，人物占画面的四分之三。`,
      finalPrompt: `平视中景复古胶片风户外时尚人像摄影，带细腻胶片颗粒，低饱和冷调高清写实，无厚重滤镜，白日柔和自然漫射光照射，明暗过渡柔和。慵懒气质的中国年轻女模特留深棕微卷长发，神色清冷直视镜头，慵懒自然的站立着，背靠在粗粝毛石墙上，左手插兜右手自然垂落。她穿着这套服装。背景是深灰绿、黄棕色天然毛石搭配米白水泥填缝的粗粝石墙，底部为带细碎黑点的浅灰色水磨石地面，整体氛围随性冷冽，充满松弛的复古轻熟穿搭质感。人物近景半身照，人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13193'],
    results: [
      {
        assetId: 'demo-yibai-13193',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/9333e2b6-97a5-47ae-b907-3f53df31fef2.jpg',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/9333e2b6-97a5-47ae-b907-3f53df31fef2.jpg',
        width: 1024,
        height: 1365,
        finalPrompt: `平视中景复古胶片风户外时尚人像摄影，带细腻胶片颗粒，低饱和冷调高清写实，无厚重滤镜，白日柔和自然漫射光照射，明暗过渡柔和。慵懒气质的中国年轻女模特留深棕微卷长发，神色清冷直视镜头，慵懒自然的站立着，背靠在粗粝毛石墙上，左手插兜右手自然垂落。她穿着这套服装。背景是深灰绿、黄棕色天然毛石搭配米白水泥填缝的粗粝石墙，底部为带细碎黑点的浅灰色水磨石地面，整体氛围随性冷冽，充满松弛的复古轻熟穿搭质感。人物近景半身照，人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13191 ratio=3:4
    taskId: 'demo-yibai-fashion-13191',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13191-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13191-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13191.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/049bf048-7413-43d8-b5b7-0b5255658536.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `平视中景东方禅意人像摄影，柔和室内漫射光，低饱和复古色调，高清通透质感，整体氛围静谧恬淡。黑长直低盘发的中国年轻女模特身材高挑纤细，神色沉静低垂眼眸，正举着白瓷小茶杯品茶。她身着这套服装。背景是深棕色木框的米白色障子格子门，人物坐在表面粗糙凹凸、孔洞纹理自然的黄棕色太湖石上，石面边缘摆放素白瓷盖碗，地面为深棕色实木地板，充满舒缓雅致的新中式茶室氛围感。人物近景半身照，人物占画面的四分之三。镜头采用仰拍视角。`,
      userPrompt: `平视中景东方禅意人像摄影，柔和室内漫射光，低饱和复古色调，高清通透质感，整体氛围静谧恬淡。黑长直低盘发的中国年轻女模特身材高挑纤细，神色沉静低垂眼眸，正举着白瓷小茶杯品茶。她身着这套服装。背景是深棕色木框的米白色障子格子门，人物坐在表面粗糙凹凸、孔洞纹理自然的黄棕色太湖石上，石面边缘摆放素白瓷盖碗，地面为深棕色实木地板，充满舒缓雅致的新中式茶室氛围感。人物近景半身照，人物占画面的四分之三。镜头采用仰拍视角。`,
      finalPrompt: `平视中景东方禅意人像摄影，柔和室内漫射光，低饱和复古色调，高清通透质感，整体氛围静谧恬淡。黑长直低盘发的中国年轻女模特身材高挑纤细，神色沉静低垂眼眸，正举着白瓷小茶杯品茶。她身着这套服装。背景是深棕色木框的米白色障子格子门，人物坐在表面粗糙凹凸、孔洞纹理自然的黄棕色太湖石上，石面边缘摆放素白瓷盖碗，地面为深棕色实木地板，充满舒缓雅致的新中式茶室氛围感。人物近景半身照，人物占画面的四分之三。镜头采用仰拍视角。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13191'],
    results: [
      {
        assetId: 'demo-yibai-13191',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/049bf048-7413-43d8-b5b7-0b5255658536.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/049bf048-7413-43d8-b5b7-0b5255658536.png',
        width: 1024,
        height: 1365,
        finalPrompt: `平视中景东方禅意人像摄影，柔和室内漫射光，低饱和复古色调，高清通透质感，整体氛围静谧恬淡。黑长直低盘发的中国年轻女模特身材高挑纤细，神色沉静低垂眼眸，正举着白瓷小茶杯品茶。她身着这套服装。背景是深棕色木框的米白色障子格子门，人物坐在表面粗糙凹凸、孔洞纹理自然的黄棕色太湖石上，石面边缘摆放素白瓷盖碗，地面为深棕色实木地板，充满舒缓雅致的新中式茶室氛围感。人物近景半身照，人物占画面的四分之三。镜头采用仰拍视角。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13190 ratio=3:4
    taskId: 'demo-yibai-fashion-13190',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13190-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13190-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13190.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/8a4a566d-122c-499b-87bf-e65633a64814.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `平视全身视角极简风商业服装人像摄影，柔和均匀的室内漫射自然光，低饱和高清写实质感无厚重滤镜。清冷气质的顺直黑发中国女性，身材高挑纤细，佩戴这套首饰，神色淡然直视镜头正向前迈步，她穿着这套服装，右手拎这个包，左手自然垂落。场景为明亮极简工作室，纯白墙面旁立着原木框空白画布与白色画板，左侧摆带滚轮的原木色画架和带黄调纹理的白色石块，地面是哑光浅灰色微水泥，整体氛围干练高级，呈现简约的都市通勤穿搭质感。人物近景全身照，人物占画面的四分之三。`,
      userPrompt: `平视全身视角极简风商业服装人像摄影，柔和均匀的室内漫射自然光，低饱和高清写实质感无厚重滤镜。清冷气质的顺直黑发中国女性，身材高挑纤细，佩戴这套首饰，神色淡然直视镜头正向前迈步，她穿着这套服装，右手拎这个包，左手自然垂落。场景为明亮极简工作室，纯白墙面旁立着原木框空白画布与白色画板，左侧摆带滚轮的原木色画架和带黄调纹理的白色石块，地面是哑光浅灰色微水泥，整体氛围干练高级，呈现简约的都市通勤穿搭质感。人物近景全身照，人物占画面的四分之三。`,
      finalPrompt: `平视全身视角极简风商业服装人像摄影，柔和均匀的室内漫射自然光，低饱和高清写实质感无厚重滤镜。清冷气质的顺直黑发中国女性，身材高挑纤细，佩戴这套首饰，神色淡然直视镜头正向前迈步，她穿着这套服装，右手拎这个包，左手自然垂落。场景为明亮极简工作室，纯白墙面旁立着原木框空白画布与白色画板，左侧摆带滚轮的原木色画架和带黄调纹理的白色石块，地面是哑光浅灰色微水泥，整体氛围干练高级，呈现简约的都市通勤穿搭质感。人物近景全身照，人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13190'],
    results: [
      {
        assetId: 'demo-yibai-13190',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/8a4a566d-122c-499b-87bf-e65633a64814.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/8a4a566d-122c-499b-87bf-e65633a64814.png',
        width: 1024,
        height: 1365,
        finalPrompt: `平视全身视角极简风商业服装人像摄影，柔和均匀的室内漫射自然光，低饱和高清写实质感无厚重滤镜。清冷气质的顺直黑发中国女性，身材高挑纤细，佩戴这套首饰，神色淡然直视镜头正向前迈步，她穿着这套服装，右手拎这个包，左手自然垂落。场景为明亮极简工作室，纯白墙面旁立着原木框空白画布与白色画板，左侧摆带滚轮的原木色画架和带黄调纹理的白色石块，地面是哑光浅灰色微水泥，整体氛围干练高级，呈现简约的都市通勤穿搭质感。人物近景全身照，人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13185 ratio=3:4
    taskId: 'demo-yibai-fashion-13185',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13185-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13185-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13185.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/d1b3afde-ce2d-4a80-8b34-026662a46ab9.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `镜头采用微仰视角，人物近景全身照，韩系极简人像写真，柔和均匀的室内漫射自然光，光影柔和无硬朗阴影，低饱和自然色调无厚重滤镜，高清写实。一位年轻的中国女模特身材高挑纤细，留深棕色中长微卷发，神色恬淡低垂眼眸，双手捧着白色开本书籍阅读，慵懒自然的站立着，身体微朝向画面左侧45度，重心放在一侧腿上，姿态放松。她身着这套服装。场景为纯白墙面的简约家居空间，身后是米白色软包布艺沙发，地面铺带清晰编织肌理的暖棕色剑麻地毯，地毯边缘露出浅灰细缝的白色哑光瓷砖，整体氛围安静闲适，通透清爽。`,
      userPrompt: `镜头采用微仰视角，人物近景全身照，韩系极简人像写真，柔和均匀的室内漫射自然光，光影柔和无硬朗阴影，低饱和自然色调无厚重滤镜，高清写实。一位年轻的中国女模特身材高挑纤细，留深棕色中长微卷发，神色恬淡低垂眼眸，双手捧着白色开本书籍阅读，慵懒自然的站立着，身体微朝向画面左侧45度，重心放在一侧腿上，姿态放松。她身着这套服装。场景为纯白墙面的简约家居空间，身后是米白色软包布艺沙发，地面铺带清晰编织肌理的暖棕色剑麻地毯，地毯边缘露出浅灰细缝的白色哑光瓷砖，整体氛围安静闲适，通透清爽。`,
      finalPrompt: `镜头采用微仰视角，人物近景全身照，韩系极简人像写真，柔和均匀的室内漫射自然光，光影柔和无硬朗阴影，低饱和自然色调无厚重滤镜，高清写实。一位年轻的中国女模特身材高挑纤细，留深棕色中长微卷发，神色恬淡低垂眼眸，双手捧着白色开本书籍阅读，慵懒自然的站立着，身体微朝向画面左侧45度，重心放在一侧腿上，姿态放松。她身着这套服装。场景为纯白墙面的简约家居空间，身后是米白色软包布艺沙发，地面铺带清晰编织肌理的暖棕色剑麻地毯，地毯边缘露出浅灰细缝的白色哑光瓷砖，整体氛围安静闲适，通透清爽。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13185'],
    results: [
      {
        assetId: 'demo-yibai-13185',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/d1b3afde-ce2d-4a80-8b34-026662a46ab9.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/d1b3afde-ce2d-4a80-8b34-026662a46ab9.png',
        width: 1024,
        height: 1365,
        finalPrompt: `镜头采用微仰视角，人物近景全身照，韩系极简人像写真，柔和均匀的室内漫射自然光，光影柔和无硬朗阴影，低饱和自然色调无厚重滤镜，高清写实。一位年轻的中国女模特身材高挑纤细，留深棕色中长微卷发，神色恬淡低垂眼眸，双手捧着白色开本书籍阅读，慵懒自然的站立着，身体微朝向画面左侧45度，重心放在一侧腿上，姿态放松。她身着这套服装。场景为纯白墙面的简约家居空间，身后是米白色软包布艺沙发，地面铺带清晰编织肌理的暖棕色剑麻地毯，地毯边缘露出浅灰细缝的白色哑光瓷砖，整体氛围安静闲适，通透清爽。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13184 ratio=3:4
    taskId: 'demo-yibai-fashion-13184',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13184-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13184-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13184.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/b87e17f1-10e7-47ef-989c-db17c392ccf8.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `平视全身视角高端极简时尚人像摄影，柔和均匀的白日漫射自然光，光影干净通透，低饱和冷调质感，高清写实无厚重滤镜。清冷气质年轻中国女性留顺直黑中长发，身材高挑纤细，神色淡然直视镜头，放松站立。她穿着这套服装，右手拎着这个包。场景为侘寂风入户门廊，背景是原木色竖纹格栅入户门，两侧是米白色肌理墙面，地面铺浅灰色哑光长条瓷砖，顶部为深棕色吊顶，整体氛围干练高级，呈现极简都市通勤穿搭质感。人物中间全身照。`,
      userPrompt: `平视全身视角高端极简时尚人像摄影，柔和均匀的白日漫射自然光，光影干净通透，低饱和冷调质感，高清写实无厚重滤镜。清冷气质年轻中国女性留顺直黑中长发，身材高挑纤细，神色淡然直视镜头，放松站立。她穿着这套服装，右手拎着这个包。场景为侘寂风入户门廊，背景是原木色竖纹格栅入户门，两侧是米白色肌理墙面，地面铺浅灰色哑光长条瓷砖，顶部为深棕色吊顶，整体氛围干练高级，呈现极简都市通勤穿搭质感。人物中间全身照。`,
      finalPrompt: `平视全身视角高端极简时尚人像摄影，柔和均匀的白日漫射自然光，光影干净通透，低饱和冷调质感，高清写实无厚重滤镜。清冷气质年轻中国女性留顺直黑中长发，身材高挑纤细，神色淡然直视镜头，放松站立。她穿着这套服装，右手拎着这个包。场景为侘寂风入户门廊，背景是原木色竖纹格栅入户门，两侧是米白色肌理墙面，地面铺浅灰色哑光长条瓷砖，顶部为深棕色吊顶，整体氛围干练高级，呈现极简都市通勤穿搭质感。人物中间全身照。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13184'],
    results: [
      {
        assetId: 'demo-yibai-13184',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/b87e17f1-10e7-47ef-989c-db17c392ccf8.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/b87e17f1-10e7-47ef-989c-db17c392ccf8.png',
        width: 1024,
        height: 1365,
        finalPrompt: `平视全身视角高端极简时尚人像摄影，柔和均匀的白日漫射自然光，光影干净通透，低饱和冷调质感，高清写实无厚重滤镜。清冷气质年轻中国女性留顺直黑中长发，身材高挑纤细，神色淡然直视镜头，放松站立。她穿着这套服装，右手拎着这个包。场景为侘寂风入户门廊，背景是原木色竖纹格栅入户门，两侧是米白色肌理墙面，地面铺浅灰色哑光长条瓷砖，顶部为深棕色吊顶，整体氛围干练高级，呈现极简都市通勤穿搭质感。人物中间全身照。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13172 ratio=3:4
    taskId: 'demo-yibai-fashion-13172',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13172-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13172-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13172.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/6d8b918e-77df-4b90-ab8c-3d2ac179cc33.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `在这个场景里，一位年轻的中国女模特身材高挑纤细，穿着这套服装，慵懒自然的站立着，身体正对镜头，微朝右侧45度站立，低头看向下方，人物居左，左手插兜，右手拎着这个包。人物远景全身照。`,
      userPrompt: `在这个场景里，一位年轻的中国女模特身材高挑纤细，穿着这套服装，慵懒自然的站立着，身体正对镜头，微朝右侧45度站立，低头看向下方，人物居左，左手插兜，右手拎着这个包。人物远景全身照。`,
      finalPrompt: `在这个场景里，一位年轻的中国女模特身材高挑纤细，穿着这套服装，慵懒自然的站立着，身体正对镜头，微朝右侧45度站立，低头看向下方，人物居左，左手插兜，右手拎着这个包。人物远景全身照。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13172'],
    results: [
      {
        assetId: 'demo-yibai-13172',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/6d8b918e-77df-4b90-ab8c-3d2ac179cc33.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/6d8b918e-77df-4b90-ab8c-3d2ac179cc33.png',
        width: 1024,
        height: 1365,
        finalPrompt: `在这个场景里，一位年轻的中国女模特身材高挑纤细，穿着这套服装，慵懒自然的站立着，身体正对镜头，微朝右侧45度站立，低头看向下方，人物居左，左手插兜，右手拎着这个包。人物远景全身照。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13170 ratio=3:4
    taskId: 'demo-yibai-fashion-13170',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13170-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13170-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13170.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/3ba566a0-6dc1-444e-9f99-088e2fad6fbd.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `复古时尚杂志人像，暖金色日落侧逆光勾勒出发丝鎏金光边，氛围松弛清透。场景为初夏郊野鸢尾花田，前景是虚化的奶白黄芯鸢尾花，带着柔焦光斑，周围生着鲜绿草叶、零星点缀淡蓝色小野花，背景是朦胧深绿灌木丛，整体是低饱和柔白、草绿、暖金的治愈色调，空气带着郊野特有的湿润朦胧感。
深棕蓬松大波浪卷发的年轻欧美女性，发丝被风扬起，闭着眼神态慵懒放松的站立着，身着这套服装，一手自然抬起轻触领口，一手自然垂落，姿态舒展自然。
使用柯达 Portra 400 胶片拍摄，85mm f/1.8 大光圈，浅景深，画面带细腻胶片颗粒，暖调柔化滤镜，边缘带轻微复古暗角，光影过渡柔和自然。时尚大片感。人物近景半身照。仰拍视角`,
      userPrompt: `复古时尚杂志人像，暖金色日落侧逆光勾勒出发丝鎏金光边，氛围松弛清透。场景为初夏郊野鸢尾花田，前景是虚化的奶白黄芯鸢尾花，带着柔焦光斑，周围生着鲜绿草叶、零星点缀淡蓝色小野花，背景是朦胧深绿灌木丛，整体是低饱和柔白、草绿、暖金的治愈色调，空气带着郊野特有的湿润朦胧感。
深棕蓬松大波浪卷发的年轻欧美女性，发丝被风扬起，闭着眼神态慵懒放松的站立着，身着这套服装，一手自然抬起轻触领口，一手自然垂落，姿态舒展自然。
使用柯达 Portra 400 胶片拍摄，85mm f/1.8 大光圈，浅景深，画面带细腻胶片颗粒，暖调柔化滤镜，边缘带轻微复古暗角，光影过渡柔和自然。时尚大片感。人物近景半身照。仰拍视角`,
      finalPrompt: `复古时尚杂志人像，暖金色日落侧逆光勾勒出发丝鎏金光边，氛围松弛清透。场景为初夏郊野鸢尾花田，前景是虚化的奶白黄芯鸢尾花，带着柔焦光斑，周围生着鲜绿草叶、零星点缀淡蓝色小野花，背景是朦胧深绿灌木丛，整体是低饱和柔白、草绿、暖金的治愈色调，空气带着郊野特有的湿润朦胧感。
深棕蓬松大波浪卷发的年轻欧美女性，发丝被风扬起，闭着眼神态慵懒放松的站立着，身着这套服装，一手自然抬起轻触领口，一手自然垂落，姿态舒展自然。
使用柯达 Portra 400 胶片拍摄，85mm f/1.8 大光圈，浅景深，画面带细腻胶片颗粒，暖调柔化滤镜，边缘带轻微复古暗角，光影过渡柔和自然。时尚大片感。人物近景半身照。仰拍视角`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13170'],
    results: [
      {
        assetId: 'demo-yibai-13170',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/3ba566a0-6dc1-444e-9f99-088e2fad6fbd.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/3ba566a0-6dc1-444e-9f99-088e2fad6fbd.png',
        width: 1024,
        height: 1365,
        finalPrompt: `复古时尚杂志人像，暖金色日落侧逆光勾勒出发丝鎏金光边，氛围松弛清透。场景为初夏郊野鸢尾花田，前景是虚化的奶白黄芯鸢尾花，带着柔焦光斑，周围生着鲜绿草叶、零星点缀淡蓝色小野花，背景是朦胧深绿灌木丛，整体是低饱和柔白、草绿、暖金的治愈色调，空气带着郊野特有的湿润朦胧感。
深棕蓬松大波浪卷发的年轻欧美女性，发丝被风扬起，闭着眼神态慵懒放松的站立着，身着这套服装，一手自然抬起轻触领口，一手自然垂落，姿态舒展自然。
使用柯达 Portra 400 胶片拍摄，85mm f/1.8 大光圈，浅景深，画面带细腻胶片颗粒，暖调柔化滤镜，边缘带轻微复古暗角，光影过渡柔和自然。时尚大片感。人物近景半身照。仰拍视角`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13163 ratio=3:4
    taskId: 'demo-yibai-fashion-13163',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13163-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13163-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13163.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/5d957e15-5019-4cfc-b178-3994163c407b.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `森系女装电商棚拍，柔和均匀的室内漫射柔光，无生硬阴影，整体氛围清新温婉。背景是哑光肌理感米杏色墙面，地面为浅棕原木纹理地板，左侧放置原木画架，架面贴风景明信片，顶部搭着蓝黄碎花晕染布艺，旁侧点缀浅蓝鸢尾、蓝玫瑰花艺，地面铺同款碎花布、散落杂志页，整体是柔雾蓝、米白、浅木色的低饱和清新配色。
黑长齐刘海、侧编麻花辫的中国年轻女孩，戴细银白色缎面发箍，神态柔和，手臂舒展呈自然行走姿态；身穿这套服装，垂坠感柔和；肩挎这个包。
使用 50mm f/2.0 定焦镜头拍摄，柔光箱补光，色彩还原真实，画面清晰锐利，通透干净，突出服饰细节质感。人物近景全身照。`,
      userPrompt: `森系女装电商棚拍，柔和均匀的室内漫射柔光，无生硬阴影，整体氛围清新温婉。背景是哑光肌理感米杏色墙面，地面为浅棕原木纹理地板，左侧放置原木画架，架面贴风景明信片，顶部搭着蓝黄碎花晕染布艺，旁侧点缀浅蓝鸢尾、蓝玫瑰花艺，地面铺同款碎花布、散落杂志页，整体是柔雾蓝、米白、浅木色的低饱和清新配色。
黑长齐刘海、侧编麻花辫的中国年轻女孩，戴细银白色缎面发箍，神态柔和，手臂舒展呈自然行走姿态；身穿这套服装，垂坠感柔和；肩挎这个包。
使用 50mm f/2.0 定焦镜头拍摄，柔光箱补光，色彩还原真实，画面清晰锐利，通透干净，突出服饰细节质感。人物近景全身照。`,
      finalPrompt: `森系女装电商棚拍，柔和均匀的室内漫射柔光，无生硬阴影，整体氛围清新温婉。背景是哑光肌理感米杏色墙面，地面为浅棕原木纹理地板，左侧放置原木画架，架面贴风景明信片，顶部搭着蓝黄碎花晕染布艺，旁侧点缀浅蓝鸢尾、蓝玫瑰花艺，地面铺同款碎花布、散落杂志页，整体是柔雾蓝、米白、浅木色的低饱和清新配色。
黑长齐刘海、侧编麻花辫的中国年轻女孩，戴细银白色缎面发箍，神态柔和，手臂舒展呈自然行走姿态；身穿这套服装，垂坠感柔和；肩挎这个包。
使用 50mm f/2.0 定焦镜头拍摄，柔光箱补光，色彩还原真实，画面清晰锐利，通透干净，突出服饰细节质感。人物近景全身照。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13163'],
    results: [
      {
        assetId: 'demo-yibai-13163',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/5d957e15-5019-4cfc-b178-3994163c407b.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/5d957e15-5019-4cfc-b178-3994163c407b.png',
        width: 1024,
        height: 1365,
        finalPrompt: `森系女装电商棚拍，柔和均匀的室内漫射柔光，无生硬阴影，整体氛围清新温婉。背景是哑光肌理感米杏色墙面，地面为浅棕原木纹理地板，左侧放置原木画架，架面贴风景明信片，顶部搭着蓝黄碎花晕染布艺，旁侧点缀浅蓝鸢尾、蓝玫瑰花艺，地面铺同款碎花布、散落杂志页，整体是柔雾蓝、米白、浅木色的低饱和清新配色。
黑长齐刘海、侧编麻花辫的中国年轻女孩，戴细银白色缎面发箍，神态柔和，手臂舒展呈自然行走姿态；身穿这套服装，垂坠感柔和；肩挎这个包。
使用 50mm f/2.0 定焦镜头拍摄，柔光箱补光，色彩还原真实，画面清晰锐利，通透干净，突出服饰细节质感。人物近景全身照。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13162 ratio=3:4
    taskId: 'demo-yibai-fashion-13162',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13162-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13162-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13162.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/407f8c2c-1ebb-4c09-8d65-1424224ab2d1.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `在这个场景里，一位年轻女性背影，浅金长发随奔跑飘逸，赤足沿小径向前跑动，左手拎着这个帽子，身穿这套服装，抓拍。高角度俯拍视角，跟拍视角，人物与背景融合自然。`,
      userPrompt: `在这个场景里，一位年轻女性背影，浅金长发随奔跑飘逸，赤足沿小径向前跑动，左手拎着这个帽子，身穿这套服装，抓拍。高角度俯拍视角，跟拍视角，人物与背景融合自然。`,
      finalPrompt: `在这个场景里，一位年轻女性背影，浅金长发随奔跑飘逸，赤足沿小径向前跑动，左手拎着这个帽子，身穿这套服装，抓拍。高角度俯拍视角，跟拍视角，人物与背景融合自然。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13162'],
    results: [
      {
        assetId: 'demo-yibai-13162',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/407f8c2c-1ebb-4c09-8d65-1424224ab2d1.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/407f8c2c-1ebb-4c09-8d65-1424224ab2d1.png',
        width: 1024,
        height: 1365,
        finalPrompt: `在这个场景里，一位年轻女性背影，浅金长发随奔跑飘逸，赤足沿小径向前跑动，左手拎着这个帽子，身穿这套服装，抓拍。高角度俯拍视角，跟拍视角，人物与背景融合自然。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13161 ratio=3:4
    taskId: 'demo-yibai-fashion-13161',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13161-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13161-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13161.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/36c9f361-9aad-4065-b449-e8dc57f3cd5f.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `法式田园风人像摄影，暖金色黄昏柔雾侧逆光，薄雾笼罩的郊野场景：前景是虬曲深褐橡树枝与鲜绿锯齿状橡叶，带虚化焦外光斑构成框架式构图，中景是齐小腿高、被风吹得微晃的柔绿长野草地，远景是蒙着淡雾的浅灰绿开阔原野，空气浮着柔细尘粒，光线穿过枝叶漏下碎金光斑，整体为低饱和、莫兰迪色调，氛围静谧慵懒。

留浅棕长卷发的年轻白人女孩，发丝被风拂起，身穿这套服装，一只手轻抓身侧橡树枝，另一只手抬在额前遮挡阳光，视线柔和望向镜头。采用 85mm f/1.4 大光圈拍摄，浅景深，复古胶片滤镜，暗部带细腻颗粒，光影柔暖过渡自然。人物远景，微俯视角`,
      userPrompt: `法式田园风人像摄影，暖金色黄昏柔雾侧逆光，薄雾笼罩的郊野场景：前景是虬曲深褐橡树枝与鲜绿锯齿状橡叶，带虚化焦外光斑构成框架式构图，中景是齐小腿高、被风吹得微晃的柔绿长野草地，远景是蒙着淡雾的浅灰绿开阔原野，空气浮着柔细尘粒，光线穿过枝叶漏下碎金光斑，整体为低饱和、莫兰迪色调，氛围静谧慵懒。

留浅棕长卷发的年轻白人女孩，发丝被风拂起，身穿这套服装，一只手轻抓身侧橡树枝，另一只手抬在额前遮挡阳光，视线柔和望向镜头。采用 85mm f/1.4 大光圈拍摄，浅景深，复古胶片滤镜，暗部带细腻颗粒，光影柔暖过渡自然。人物远景，微俯视角`,
      finalPrompt: `法式田园风人像摄影，暖金色黄昏柔雾侧逆光，薄雾笼罩的郊野场景：前景是虬曲深褐橡树枝与鲜绿锯齿状橡叶，带虚化焦外光斑构成框架式构图，中景是齐小腿高、被风吹得微晃的柔绿长野草地，远景是蒙着淡雾的浅灰绿开阔原野，空气浮着柔细尘粒，光线穿过枝叶漏下碎金光斑，整体为低饱和、莫兰迪色调，氛围静谧慵懒。

留浅棕长卷发的年轻白人女孩，发丝被风拂起，身穿这套服装，一只手轻抓身侧橡树枝，另一只手抬在额前遮挡阳光，视线柔和望向镜头。采用 85mm f/1.4 大光圈拍摄，浅景深，复古胶片滤镜，暗部带细腻颗粒，光影柔暖过渡自然。人物远景，微俯视角`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13161'],
    results: [
      {
        assetId: 'demo-yibai-13161',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/36c9f361-9aad-4065-b449-e8dc57f3cd5f.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/36c9f361-9aad-4065-b449-e8dc57f3cd5f.png',
        width: 1024,
        height: 1365,
        finalPrompt: `法式田园风人像摄影，暖金色黄昏柔雾侧逆光，薄雾笼罩的郊野场景：前景是虬曲深褐橡树枝与鲜绿锯齿状橡叶，带虚化焦外光斑构成框架式构图，中景是齐小腿高、被风吹得微晃的柔绿长野草地，远景是蒙着淡雾的浅灰绿开阔原野，空气浮着柔细尘粒，光线穿过枝叶漏下碎金光斑，整体为低饱和、莫兰迪色调，氛围静谧慵懒。

留浅棕长卷发的年轻白人女孩，发丝被风拂起，身穿这套服装，一只手轻抓身侧橡树枝，另一只手抬在额前遮挡阳光，视线柔和望向镜头。采用 85mm f/1.4 大光圈拍摄，浅景深，复古胶片滤镜，暗部带细腻颗粒，光影柔暖过渡自然。人物远景，微俯视角`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13160 ratio=3:4
    taskId: 'demo-yibai-fashion-13160',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13160-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13160-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13160.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/25ad5417-30fa-4270-bc90-a1d5e9b10a57.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `法式复古度假风人像摄影，白日暖金色柔和日光笼罩，画面明亮温暖，氛围悠闲慵懒。场景是内河游船的敞开式白色木质窗边，窗边摆放黄铜色小圆桌，桌面立着插有白玫瑰的透明玻璃瓶、米白花纹马克杯，旁侧是两把配白红黑条纹坐垫的白色木质餐椅；窗外是开阔的灰蓝色河面，远处可见浅黄褐色的荒漠岸线与跨河长桥，天空澄澈亮白。
年轻白人女性浅棕头发挽成低发髻，佩戴这副墨镜，侧身倚靠坐在窗边、长腿交叠，正捧书阅读姿态放松，身着这套服装。
平视中景拍摄，柯达暖调复古胶片滤镜，带轻微自然胶片颗粒，低对比度，高曝光度，充满悠然的假日松弛感。`,
      userPrompt: `法式复古度假风人像摄影，白日暖金色柔和日光笼罩，画面明亮温暖，氛围悠闲慵懒。场景是内河游船的敞开式白色木质窗边，窗边摆放黄铜色小圆桌，桌面立着插有白玫瑰的透明玻璃瓶、米白花纹马克杯，旁侧是两把配白红黑条纹坐垫的白色木质餐椅；窗外是开阔的灰蓝色河面，远处可见浅黄褐色的荒漠岸线与跨河长桥，天空澄澈亮白。
年轻白人女性浅棕头发挽成低发髻，佩戴这副墨镜，侧身倚靠坐在窗边、长腿交叠，正捧书阅读姿态放松，身着这套服装。
平视中景拍摄，柯达暖调复古胶片滤镜，带轻微自然胶片颗粒，低对比度，高曝光度，充满悠然的假日松弛感。`,
      finalPrompt: `法式复古度假风人像摄影，白日暖金色柔和日光笼罩，画面明亮温暖，氛围悠闲慵懒。场景是内河游船的敞开式白色木质窗边，窗边摆放黄铜色小圆桌，桌面立着插有白玫瑰的透明玻璃瓶、米白花纹马克杯，旁侧是两把配白红黑条纹坐垫的白色木质餐椅；窗外是开阔的灰蓝色河面，远处可见浅黄褐色的荒漠岸线与跨河长桥，天空澄澈亮白。
年轻白人女性浅棕头发挽成低发髻，佩戴这副墨镜，侧身倚靠坐在窗边、长腿交叠，正捧书阅读姿态放松，身着这套服装。
平视中景拍摄，柯达暖调复古胶片滤镜，带轻微自然胶片颗粒，低对比度，高曝光度，充满悠然的假日松弛感。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13160'],
    results: [
      {
        assetId: 'demo-yibai-13160',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/25ad5417-30fa-4270-bc90-a1d5e9b10a57.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/25ad5417-30fa-4270-bc90-a1d5e9b10a57.png',
        width: 1024,
        height: 1365,
        finalPrompt: `法式复古度假风人像摄影，白日暖金色柔和日光笼罩，画面明亮温暖，氛围悠闲慵懒。场景是内河游船的敞开式白色木质窗边，窗边摆放黄铜色小圆桌，桌面立着插有白玫瑰的透明玻璃瓶、米白花纹马克杯，旁侧是两把配白红黑条纹坐垫的白色木质餐椅；窗外是开阔的灰蓝色河面，远处可见浅黄褐色的荒漠岸线与跨河长桥，天空澄澈亮白。
年轻白人女性浅棕头发挽成低发髻，佩戴这副墨镜，侧身倚靠坐在窗边、长腿交叠，正捧书阅读姿态放松，身着这套服装。
平视中景拍摄，柯达暖调复古胶片滤镜，带轻微自然胶片颗粒，低对比度，高曝光度，充满悠然的假日松弛感。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13159 ratio=3:4
    taskId: 'demo-yibai-fashion-13159',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13159-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13159-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13159.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/c86505ff-069c-419a-b11c-060f0e6f8634.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `这是一组充满东方侘寂感的清冷艺术人像摄影。画面环境以深墨色的澄澈浅静水为主体，水面泛着细碎涟漪，清晰倒映出植物与人物的轮廓，两朵奶白色、一朵柔粉色的重瓣睡莲静静浮在人物身侧，花瓣纹理柔和清晰。画面上侧与右侧边缘错落分布着鲜绿的狭长芦苇叶，点缀着浅棕褐色的干枯芦苇穗与细碎杂草，野趣自然；背景是素白的哑光墙面，植物投射的斜向条状光影落在墙面上，为静谧的空间增添了错落的光影层次。
画面中的年轻中国女性水池高挑纤细，她半仰躺于浅水中，上半身微微抬起，双臂向后撑在水底支撑身体，双眼闭合神态放松柔和，赤裸双足浸在水里自然舒展。她身着这套服装，裙摆被水浸润半浮于水面，褶皱自然灵动。
该作品采用高角度俯视拍摄，大景深让画面整体清晰度较高，人物、睡莲与前景植物都清晰呈现，仅水体最深的暗部有轻微虚化。后期使用暗调日系胶片滤镜，带有细腻的自然胶片颗粒，低饱和冷调校色压低了对比度，暗部压黑却保留了面料与水面的纹理细节，整体氛围沉静空灵。`,
      userPrompt: `这是一组充满东方侘寂感的清冷艺术人像摄影。画面环境以深墨色的澄澈浅静水为主体，水面泛着细碎涟漪，清晰倒映出植物与人物的轮廓，两朵奶白色、一朵柔粉色的重瓣睡莲静静浮在人物身侧，花瓣纹理柔和清晰。画面上侧与右侧边缘错落分布着鲜绿的狭长芦苇叶，点缀着浅棕褐色的干枯芦苇穗与细碎杂草，野趣自然；背景是素白的哑光墙面，植物投射的斜向条状光影落在墙面上，为静谧的空间增添了错落的光影层次。
画面中的年轻中国女性水池高挑纤细，她半仰躺于浅水中，上半身微微抬起，双臂向后撑在水底支撑身体，双眼闭合神态放松柔和，赤裸双足浸在水里自然舒展。她身着这套服装，裙摆被水浸润半浮于水面，褶皱自然灵动。
该作品采用高角度俯视拍摄，大景深让画面整体清晰度较高，人物、睡莲与前景植物都清晰呈现，仅水体最深的暗部有轻微虚化。后期使用暗调日系胶片滤镜，带有细腻的自然胶片颗粒，低饱和冷调校色压低了对比度，暗部压黑却保留了面料与水面的纹理细节，整体氛围沉静空灵。`,
      finalPrompt: `这是一组充满东方侘寂感的清冷艺术人像摄影。画面环境以深墨色的澄澈浅静水为主体，水面泛着细碎涟漪，清晰倒映出植物与人物的轮廓，两朵奶白色、一朵柔粉色的重瓣睡莲静静浮在人物身侧，花瓣纹理柔和清晰。画面上侧与右侧边缘错落分布着鲜绿的狭长芦苇叶，点缀着浅棕褐色的干枯芦苇穗与细碎杂草，野趣自然；背景是素白的哑光墙面，植物投射的斜向条状光影落在墙面上，为静谧的空间增添了错落的光影层次。
画面中的年轻中国女性水池高挑纤细，她半仰躺于浅水中，上半身微微抬起，双臂向后撑在水底支撑身体，双眼闭合神态放松柔和，赤裸双足浸在水里自然舒展。她身着这套服装，裙摆被水浸润半浮于水面，褶皱自然灵动。
该作品采用高角度俯视拍摄，大景深让画面整体清晰度较高，人物、睡莲与前景植物都清晰呈现，仅水体最深的暗部有轻微虚化。后期使用暗调日系胶片滤镜，带有细腻的自然胶片颗粒，低饱和冷调校色压低了对比度，暗部压黑却保留了面料与水面的纹理细节，整体氛围沉静空灵。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13159'],
    results: [
      {
        assetId: 'demo-yibai-13159',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/c86505ff-069c-419a-b11c-060f0e6f8634.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/c86505ff-069c-419a-b11c-060f0e6f8634.png',
        width: 1024,
        height: 1365,
        finalPrompt: `这是一组充满东方侘寂感的清冷艺术人像摄影。画面环境以深墨色的澄澈浅静水为主体，水面泛着细碎涟漪，清晰倒映出植物与人物的轮廓，两朵奶白色、一朵柔粉色的重瓣睡莲静静浮在人物身侧，花瓣纹理柔和清晰。画面上侧与右侧边缘错落分布着鲜绿的狭长芦苇叶，点缀着浅棕褐色的干枯芦苇穗与细碎杂草，野趣自然；背景是素白的哑光墙面，植物投射的斜向条状光影落在墙面上，为静谧的空间增添了错落的光影层次。
画面中的年轻中国女性水池高挑纤细，她半仰躺于浅水中，上半身微微抬起，双臂向后撑在水底支撑身体，双眼闭合神态放松柔和，赤裸双足浸在水里自然舒展。她身着这套服装，裙摆被水浸润半浮于水面，褶皱自然灵动。
该作品采用高角度俯视拍摄，大景深让画面整体清晰度较高，人物、睡莲与前景植物都清晰呈现，仅水体最深的暗部有轻微虚化。后期使用暗调日系胶片滤镜，带有细腻的自然胶片颗粒，低饱和冷调校色压低了对比度，暗部压黑却保留了面料与水面的纹理细节，整体氛围沉静空灵。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13158 ratio=3:4
    taskId: 'demo-yibai-fashion-13158',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13158-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13158-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13158.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2057887b-c3f5-408f-8d28-57a2efd27c23.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `在这个场景里，一位年轻白皙的白人女性，浅棕长卷发，仰头望向上方，一手自然垂落，一手背在身后，姿态放松，身穿这套服装，佩戴这套首饰。镜头采用俯拍视角拍摄，人物中景全身照。`,
      userPrompt: `在这个场景里，一位年轻白皙的白人女性，浅棕长卷发，仰头望向上方，一手自然垂落，一手背在身后，姿态放松，身穿这套服装，佩戴这套首饰。镜头采用俯拍视角拍摄，人物中景全身照。`,
      finalPrompt: `在这个场景里，一位年轻白皙的白人女性，浅棕长卷发，仰头望向上方，一手自然垂落，一手背在身后，姿态放松，身穿这套服装，佩戴这套首饰。镜头采用俯拍视角拍摄，人物中景全身照。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13158'],
    results: [
      {
        assetId: 'demo-yibai-13158',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2057887b-c3f5-408f-8d28-57a2efd27c23.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2057887b-c3f5-408f-8d28-57a2efd27c23.png',
        width: 1024,
        height: 1365,
        finalPrompt: `在这个场景里，一位年轻白皙的白人女性，浅棕长卷发，仰头望向上方，一手自然垂落，一手背在身后，姿态放松，身穿这套服装，佩戴这套首饰。镜头采用俯拍视角拍摄，人物中景全身照。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13156 ratio=3:4
    taskId: 'demo-yibai-fashion-13156',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13156-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13156-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13156.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/535edebf-afff-4e4a-a478-7a99e73e1b68.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `夏日清新山野度假风人像摄影，晴朗午后淡蓝晴空，远处是覆满绿植的浅黛色山峦，近处临澄澈浅水池，周边环绕深绿阔叶乔木、翠色尖顶松柏，前景有虚化的蓝白小花与嫩绿枝叶做前景框，自然通透的暖柔日光笼罩，氛围慵懒治愈，低饱和清透色调。
年轻的白人少女，深棕长发扎低马尾系浅蓝色发圈（碎发自然飘动），垂头看向地面，姿态放松，双手自然垂落，佩戴这套首饰，身穿这套服装。朝向画面的左侧站立(站在水池边的矮墙上)，行走姿势抓拍。

低角度仰拍全身，浅景深虚化背景，日系清透胶片滤镜，低对比度带轻微柔光效果，突出面料通透肌理。人物近景全身照，人物占画面的四分之三。`,
      userPrompt: `夏日清新山野度假风人像摄影，晴朗午后淡蓝晴空，远处是覆满绿植的浅黛色山峦，近处临澄澈浅水池，周边环绕深绿阔叶乔木、翠色尖顶松柏，前景有虚化的蓝白小花与嫩绿枝叶做前景框，自然通透的暖柔日光笼罩，氛围慵懒治愈，低饱和清透色调。
年轻的白人少女，深棕长发扎低马尾系浅蓝色发圈（碎发自然飘动），垂头看向地面，姿态放松，双手自然垂落，佩戴这套首饰，身穿这套服装。朝向画面的左侧站立(站在水池边的矮墙上)，行走姿势抓拍。

低角度仰拍全身，浅景深虚化背景，日系清透胶片滤镜，低对比度带轻微柔光效果，突出面料通透肌理。人物近景全身照，人物占画面的四分之三。`,
      finalPrompt: `夏日清新山野度假风人像摄影，晴朗午后淡蓝晴空，远处是覆满绿植的浅黛色山峦，近处临澄澈浅水池，周边环绕深绿阔叶乔木、翠色尖顶松柏，前景有虚化的蓝白小花与嫩绿枝叶做前景框，自然通透的暖柔日光笼罩，氛围慵懒治愈，低饱和清透色调。
年轻的白人少女，深棕长发扎低马尾系浅蓝色发圈（碎发自然飘动），垂头看向地面，姿态放松，双手自然垂落，佩戴这套首饰，身穿这套服装。朝向画面的左侧站立(站在水池边的矮墙上)，行走姿势抓拍。

低角度仰拍全身，浅景深虚化背景，日系清透胶片滤镜，低对比度带轻微柔光效果，突出面料通透肌理。人物近景全身照，人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13156'],
    results: [
      {
        assetId: 'demo-yibai-13156',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/535edebf-afff-4e4a-a478-7a99e73e1b68.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/535edebf-afff-4e4a-a478-7a99e73e1b68.png',
        width: 1024,
        height: 1365,
        finalPrompt: `夏日清新山野度假风人像摄影，晴朗午后淡蓝晴空，远处是覆满绿植的浅黛色山峦，近处临澄澈浅水池，周边环绕深绿阔叶乔木、翠色尖顶松柏，前景有虚化的蓝白小花与嫩绿枝叶做前景框，自然通透的暖柔日光笼罩，氛围慵懒治愈，低饱和清透色调。
年轻的白人少女，深棕长发扎低马尾系浅蓝色发圈（碎发自然飘动），垂头看向地面，姿态放松，双手自然垂落，佩戴这套首饰，身穿这套服装。朝向画面的左侧站立(站在水池边的矮墙上)，行走姿势抓拍。

低角度仰拍全身，浅景深虚化背景，日系清透胶片滤镜，低对比度带轻微柔光效果，突出面料通透肌理。人物近景全身照，人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13155 ratio=3:4
    taskId: 'demo-yibai-fashion-13155',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13155-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13155-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13155.jpg',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2ed03174-a2af-4431-8d35-4500a601c4a3.jpg',
        fileType: 'image/jpeg',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。人物近景全身照。人物占画面的四分之三。`,
      userPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。人物近景全身照。人物占画面的四分之三。`,
      finalPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。人物近景全身照。人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13155'],
    results: [
      {
        assetId: 'demo-yibai-13155',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2ed03174-a2af-4431-8d35-4500a601c4a3.jpg',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/2ed03174-a2af-4431-8d35-4500a601c4a3.jpg',
        width: 1024,
        height: 1365,
        finalPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。人物近景全身照。人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13154 ratio=3:4
    taskId: 'demo-yibai-fashion-13154',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13154-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13154-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13154.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/813cfdb9-05f1-4841-b887-c51e0b6f224c.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。`,
      userPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。`,
      finalPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13154'],
    results: [
      {
        assetId: 'demo-yibai-13154',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/813cfdb9-05f1-4841-b887-c51e0b6f224c.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/813cfdb9-05f1-4841-b887-c51e0b6f224c.png',
        width: 1024,
        height: 1365,
        finalPrompt: `法式松弛感户外人像摄影，夏日午后静谧庭院，浅米白粗糙肌理石灰墙带着岁月斑驳痕迹，旁侧垂落翠绿藤蔓、生着低矮绿植，地面是混杂浅棕小碎石的青草地，背景有浅澈小水池，树木在墙面、地面投下柔和斑驳碎影，自然侧柔光笼罩，空气通透，低饱和莫兰迪色调，氛围慵懒闲适。

年轻白皙白人女性，浅棕长卷发，仰头望向上方，双手插兜姿态放松，身穿这套服装，佩戴这套首饰。平视全身拍摄，浅景深虚化背景，低对比度日系胶片滤镜，带轻微胶片颗粒，色调柔和清冷，突出面料肌理与松弛感。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13152 ratio=3:4
    taskId: 'demo-yibai-fashion-13152',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13152-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13152-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13152.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/e98c27e6-ab9b-4195-a56c-1984ec3c3383.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `这是一张法式田园风格的竖幅户外人像摄影作品，采用低角度仰拍视角，搭配柔和的自然散射光，运用浅景深效果加复古柔焦滤镜：焦点清晰落于模特面部与上半身，从白马头部、前景花田到远景树林的虚化程度逐层加深，整体影调低饱和、偏暖调，带有细腻的柔光颗粒感，高光柔和不溢出，暗部通透无死黑，氛围朦胧治愈。法式浪漫风格。

拍摄场景设于开阔的郊外花田，前景是模特与白马；中景是花田核心区域，花卉密度适中，错落生长的野生小花，白、粉、黄各色小雏菊点缀在嫩绿草叶间，鲜活灵动；远景是层叠茂密的深绿色乔木林，浓郁柔化的墨绿色背景如同天然幕布，将浅色系的主体衬得格外突出。

模特为浅棕蓬松卷发的白人女性，此刻端正骑乘在白马上，上身挺直，双臂自然垂落放在身前马颈两侧，姿态舒展松弛，神情恬淡地望向镜头。她身着这套服装，通体雪白的白马站在画面下半部分中心，马鞍侧挂着米白色钩针草包，包内插着的粉白非洲菊，刚好和整体柔美的氛围相呼应。人物近景半身照，人物占画面的四分之三。`,
      userPrompt: `这是一张法式田园风格的竖幅户外人像摄影作品，采用低角度仰拍视角，搭配柔和的自然散射光，运用浅景深效果加复古柔焦滤镜：焦点清晰落于模特面部与上半身，从白马头部、前景花田到远景树林的虚化程度逐层加深，整体影调低饱和、偏暖调，带有细腻的柔光颗粒感，高光柔和不溢出，暗部通透无死黑，氛围朦胧治愈。法式浪漫风格。

拍摄场景设于开阔的郊外花田，前景是模特与白马；中景是花田核心区域，花卉密度适中，错落生长的野生小花，白、粉、黄各色小雏菊点缀在嫩绿草叶间，鲜活灵动；远景是层叠茂密的深绿色乔木林，浓郁柔化的墨绿色背景如同天然幕布，将浅色系的主体衬得格外突出。

模特为浅棕蓬松卷发的白人女性，此刻端正骑乘在白马上，上身挺直，双臂自然垂落放在身前马颈两侧，姿态舒展松弛，神情恬淡地望向镜头。她身着这套服装，通体雪白的白马站在画面下半部分中心，马鞍侧挂着米白色钩针草包，包内插着的粉白非洲菊，刚好和整体柔美的氛围相呼应。人物近景半身照，人物占画面的四分之三。`,
      finalPrompt: `这是一张法式田园风格的竖幅户外人像摄影作品，采用低角度仰拍视角，搭配柔和的自然散射光，运用浅景深效果加复古柔焦滤镜：焦点清晰落于模特面部与上半身，从白马头部、前景花田到远景树林的虚化程度逐层加深，整体影调低饱和、偏暖调，带有细腻的柔光颗粒感，高光柔和不溢出，暗部通透无死黑，氛围朦胧治愈。法式浪漫风格。

拍摄场景设于开阔的郊外花田，前景是模特与白马；中景是花田核心区域，花卉密度适中，错落生长的野生小花，白、粉、黄各色小雏菊点缀在嫩绿草叶间，鲜活灵动；远景是层叠茂密的深绿色乔木林，浓郁柔化的墨绿色背景如同天然幕布，将浅色系的主体衬得格外突出。

模特为浅棕蓬松卷发的白人女性，此刻端正骑乘在白马上，上身挺直，双臂自然垂落放在身前马颈两侧，姿态舒展松弛，神情恬淡地望向镜头。她身着这套服装，通体雪白的白马站在画面下半部分中心，马鞍侧挂着米白色钩针草包，包内插着的粉白非洲菊，刚好和整体柔美的氛围相呼应。人物近景半身照，人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13152'],
    results: [
      {
        assetId: 'demo-yibai-13152',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/e98c27e6-ab9b-4195-a56c-1984ec3c3383.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/e98c27e6-ab9b-4195-a56c-1984ec3c3383.png',
        width: 1024,
        height: 1365,
        finalPrompt: `这是一张法式田园风格的竖幅户外人像摄影作品，采用低角度仰拍视角，搭配柔和的自然散射光，运用浅景深效果加复古柔焦滤镜：焦点清晰落于模特面部与上半身，从白马头部、前景花田到远景树林的虚化程度逐层加深，整体影调低饱和、偏暖调，带有细腻的柔光颗粒感，高光柔和不溢出，暗部通透无死黑，氛围朦胧治愈。法式浪漫风格。

拍摄场景设于开阔的郊外花田，前景是模特与白马；中景是花田核心区域，花卉密度适中，错落生长的野生小花，白、粉、黄各色小雏菊点缀在嫩绿草叶间，鲜活灵动；远景是层叠茂密的深绿色乔木林，浓郁柔化的墨绿色背景如同天然幕布，将浅色系的主体衬得格外突出。

模特为浅棕蓬松卷发的白人女性，此刻端正骑乘在白马上，上身挺直，双臂自然垂落放在身前马颈两侧，姿态舒展松弛，神情恬淡地望向镜头。她身着这套服装，通体雪白的白马站在画面下半部分中心，马鞍侧挂着米白色钩针草包，包内插着的粉白非洲菊，刚好和整体柔美的氛围相呼应。人物近景半身照，人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=13151 ratio=3:4
    taskId: 'demo-yibai-fashion-13151',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-13151-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-13151-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-13151.jpg',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/56007a93-5b28-4098-8094-a1708fefdb6e.jpg',
        fileType: 'image/jpeg',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `这是南欧度假风时装宣传大片，镜头采用仰拍视角，左上角近景的深绿色树叶呈虚化前景，叶隙间漏出柔化的阳光光斑，图中的模特与餐区陈设为清晰实焦，背景的开阔滨水水面则自然柔化，虚实过渡柔和，画面层次舒展。

场景设定在临水的露天餐区，地面是带有自然磨损纹理的浅米灰色石板，落有清晰柔和的树影光斑，区域内摆放着做旧原木色的折叠导演椅，搭配白色布艺软垫，一旁还有同款空置座椅。餐桌铺着垂坠感米白色亚麻桌布，桌上摆放着盛有粉色气泡酒的高脚杯、透明棱纹水杯、橘色皮质餐单与白瓷餐盘，陈设松弛随性。背景是开阔的清透蓝灰色水面，浮动着细碎的阳光波光，午后暖调侧光明亮柔和，投下的阴影清晰不生硬，整体氛围慵懒闲适，满是滨海度假的惬意感。

浅金棕长卷发的白人模特身材高挑纤细，身着这套服装。她慵懒自然的侧身坐在折叠椅上，右臂自然搭在椅背，左手搭在椅子扶手上，上半身和头部向后转，看向远方，姿态舒展放松。画面采用暖调复古胶片滤镜，低对比度搭配柔化高光，带有细微胶片颗粒，整体色彩柔和高级。人物近景全身照。人物占画面的四分之三。`,
      userPrompt: `这是南欧度假风时装宣传大片，镜头采用仰拍视角，左上角近景的深绿色树叶呈虚化前景，叶隙间漏出柔化的阳光光斑，图中的模特与餐区陈设为清晰实焦，背景的开阔滨水水面则自然柔化，虚实过渡柔和，画面层次舒展。

场景设定在临水的露天餐区，地面是带有自然磨损纹理的浅米灰色石板，落有清晰柔和的树影光斑，区域内摆放着做旧原木色的折叠导演椅，搭配白色布艺软垫，一旁还有同款空置座椅。餐桌铺着垂坠感米白色亚麻桌布，桌上摆放着盛有粉色气泡酒的高脚杯、透明棱纹水杯、橘色皮质餐单与白瓷餐盘，陈设松弛随性。背景是开阔的清透蓝灰色水面，浮动着细碎的阳光波光，午后暖调侧光明亮柔和，投下的阴影清晰不生硬，整体氛围慵懒闲适，满是滨海度假的惬意感。

浅金棕长卷发的白人模特身材高挑纤细，身着这套服装。她慵懒自然的侧身坐在折叠椅上，右臂自然搭在椅背，左手搭在椅子扶手上，上半身和头部向后转，看向远方，姿态舒展放松。画面采用暖调复古胶片滤镜，低对比度搭配柔化高光，带有细微胶片颗粒，整体色彩柔和高级。人物近景全身照。人物占画面的四分之三。`,
      finalPrompt: `这是南欧度假风时装宣传大片，镜头采用仰拍视角，左上角近景的深绿色树叶呈虚化前景，叶隙间漏出柔化的阳光光斑，图中的模特与餐区陈设为清晰实焦，背景的开阔滨水水面则自然柔化，虚实过渡柔和，画面层次舒展。

场景设定在临水的露天餐区，地面是带有自然磨损纹理的浅米灰色石板，落有清晰柔和的树影光斑，区域内摆放着做旧原木色的折叠导演椅，搭配白色布艺软垫，一旁还有同款空置座椅。餐桌铺着垂坠感米白色亚麻桌布，桌上摆放着盛有粉色气泡酒的高脚杯、透明棱纹水杯、橘色皮质餐单与白瓷餐盘，陈设松弛随性。背景是开阔的清透蓝灰色水面，浮动着细碎的阳光波光，午后暖调侧光明亮柔和，投下的阴影清晰不生硬，整体氛围慵懒闲适，满是滨海度假的惬意感。

浅金棕长卷发的白人模特身材高挑纤细，身着这套服装。她慵懒自然的侧身坐在折叠椅上，右臂自然搭在椅背，左手搭在椅子扶手上，上半身和头部向后转，看向远方，姿态舒展放松。画面采用暖调复古胶片滤镜，低对比度搭配柔化高光，带有细微胶片颗粒，整体色彩柔和高级。人物近景全身照。人物占画面的四分之三。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-13151'],
    results: [
      {
        assetId: 'demo-yibai-13151',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/56007a93-5b28-4098-8094-a1708fefdb6e.jpg',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260512/56007a93-5b28-4098-8094-a1708fefdb6e.jpg',
        width: 1024,
        height: 1365,
        finalPrompt: `这是南欧度假风时装宣传大片，镜头采用仰拍视角，左上角近景的深绿色树叶呈虚化前景，叶隙间漏出柔化的阳光光斑，图中的模特与餐区陈设为清晰实焦，背景的开阔滨水水面则自然柔化，虚实过渡柔和，画面层次舒展。

场景设定在临水的露天餐区，地面是带有自然磨损纹理的浅米灰色石板，落有清晰柔和的树影光斑，区域内摆放着做旧原木色的折叠导演椅，搭配白色布艺软垫，一旁还有同款空置座椅。餐桌铺着垂坠感米白色亚麻桌布，桌上摆放着盛有粉色气泡酒的高脚杯、透明棱纹水杯、橘色皮质餐单与白瓷餐盘，陈设松弛随性。背景是开阔的清透蓝灰色水面，浮动着细碎的阳光波光，午后暖调侧光明亮柔和，投下的阴影清晰不生硬，整体氛围慵懒闲适，满是滨海度假的惬意感。

浅金棕长卷发的白人模特身材高挑纤细，身着这套服装。她慵懒自然的侧身坐在折叠椅上，右臂自然搭在椅背，左手搭在椅子扶手上，上半身和头部向后转，看向远方，姿态舒展放松。画面采用暖调复古胶片滤镜，低对比度搭配柔化高光，带有细微胶片颗粒，整体色彩柔和高级。人物近景全身照。人物占画面的四分之三。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12741 ratio=3:2
    taskId: 'demo-yibai-fashion-12741',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12741-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12741-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12741.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/1a134ce0-bdf6-495f-8f5c-8dabcaca69e1.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `这是一张写实风格的摄影照片，呈现出一种复古且带有古典油画质感的氛围，构图采用垂直竖幅，主体人物（年轻中国女性网红，身材高挑纤细，皮肤白皙，妆容精致）站画面中央偏下位置，身体呈现直立状态，以俯视视角捕捉人物姿态，展现其在绿意盎然的自然环境中。画面中主体人物穿着这个服装，她双臂向上伸展扶着树枝（未出现手部），姿态优雅，眼神看向画面右侧；画面上方前景处有绿叶的虚影。背景是茂密的模糊绿色地面植被（叶片形态饱满，深浅不一的绿色交织），地面散落枯叶与草皮，营造出静谧的林间场景。人物的肌肤在柔和侧光下泛着自然光泽，光线从斜上方洒落，形成柔和的阴影，整体亮度适中，氛围宁静而略带神秘，传达出一种复古优雅且略带奇幻的情绪，仿佛将人物置于古典神话场景中。图片细节丰富，人物服饰的褶皱、叶片的纹理都清晰可辨，光影效果营造出电影感的质感，整体给人一种充满艺术感的复古写实氛围，让人联想到具有古典主义风格的时尚摄影作品，材质上人物的服饰面料呈现出细腻的垂坠感，自然环境中的植物则展现出鲜活的生机与柔软的质感，整体通过柔和的光线、复古的色调与优雅的人物姿态，构建出一个静谧而富有诗意的画面。`,
      userPrompt: `这是一张写实风格的摄影照片，呈现出一种复古且带有古典油画质感的氛围，构图采用垂直竖幅，主体人物（年轻中国女性网红，身材高挑纤细，皮肤白皙，妆容精致）站画面中央偏下位置，身体呈现直立状态，以俯视视角捕捉人物姿态，展现其在绿意盎然的自然环境中。画面中主体人物穿着这个服装，她双臂向上伸展扶着树枝（未出现手部），姿态优雅，眼神看向画面右侧；画面上方前景处有绿叶的虚影。背景是茂密的模糊绿色地面植被（叶片形态饱满，深浅不一的绿色交织），地面散落枯叶与草皮，营造出静谧的林间场景。人物的肌肤在柔和侧光下泛着自然光泽，光线从斜上方洒落，形成柔和的阴影，整体亮度适中，氛围宁静而略带神秘，传达出一种复古优雅且略带奇幻的情绪，仿佛将人物置于古典神话场景中。图片细节丰富，人物服饰的褶皱、叶片的纹理都清晰可辨，光影效果营造出电影感的质感，整体给人一种充满艺术感的复古写实氛围，让人联想到具有古典主义风格的时尚摄影作品，材质上人物的服饰面料呈现出细腻的垂坠感，自然环境中的植物则展现出鲜活的生机与柔软的质感，整体通过柔和的光线、复古的色调与优雅的人物姿态，构建出一个静谧而富有诗意的画面。`,
      finalPrompt: `这是一张写实风格的摄影照片，呈现出一种复古且带有古典油画质感的氛围，构图采用垂直竖幅，主体人物（年轻中国女性网红，身材高挑纤细，皮肤白皙，妆容精致）站画面中央偏下位置，身体呈现直立状态，以俯视视角捕捉人物姿态，展现其在绿意盎然的自然环境中。画面中主体人物穿着这个服装，她双臂向上伸展扶着树枝（未出现手部），姿态优雅，眼神看向画面右侧；画面上方前景处有绿叶的虚影。背景是茂密的模糊绿色地面植被（叶片形态饱满，深浅不一的绿色交织），地面散落枯叶与草皮，营造出静谧的林间场景。人物的肌肤在柔和侧光下泛着自然光泽，光线从斜上方洒落，形成柔和的阴影，整体亮度适中，氛围宁静而略带神秘，传达出一种复古优雅且略带奇幻的情绪，仿佛将人物置于古典神话场景中。图片细节丰富，人物服饰的褶皱、叶片的纹理都清晰可辨，光影效果营造出电影感的质感，整体给人一种充满艺术感的复古写实氛围，让人联想到具有古典主义风格的时尚摄影作品，材质上人物的服饰面料呈现出细腻的垂坠感，自然环境中的植物则展现出鲜活的生机与柔软的质感，整体通过柔和的光线、复古的色调与优雅的人物姿态，构建出一个静谧而富有诗意的画面。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:2',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12741'],
    results: [
      {
        assetId: 'demo-yibai-12741',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/1a134ce0-bdf6-495f-8f5c-8dabcaca69e1.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/1a134ce0-bdf6-495f-8f5c-8dabcaca69e1.png',
        width: 1024,
        height: 1365,
        finalPrompt: `这是一张写实风格的摄影照片，呈现出一种复古且带有古典油画质感的氛围，构图采用垂直竖幅，主体人物（年轻中国女性网红，身材高挑纤细，皮肤白皙，妆容精致）站画面中央偏下位置，身体呈现直立状态，以俯视视角捕捉人物姿态，展现其在绿意盎然的自然环境中。画面中主体人物穿着这个服装，她双臂向上伸展扶着树枝（未出现手部），姿态优雅，眼神看向画面右侧；画面上方前景处有绿叶的虚影。背景是茂密的模糊绿色地面植被（叶片形态饱满，深浅不一的绿色交织），地面散落枯叶与草皮，营造出静谧的林间场景。人物的肌肤在柔和侧光下泛着自然光泽，光线从斜上方洒落，形成柔和的阴影，整体亮度适中，氛围宁静而略带神秘，传达出一种复古优雅且略带奇幻的情绪，仿佛将人物置于古典神话场景中。图片细节丰富，人物服饰的褶皱、叶片的纹理都清晰可辨，光影效果营造出电影感的质感，整体给人一种充满艺术感的复古写实氛围，让人联想到具有古典主义风格的时尚摄影作品，材质上人物的服饰面料呈现出细腻的垂坠感，自然环境中的植物则展现出鲜活的生机与柔软的质感，整体通过柔和的光线、复古的色调与优雅的人物姿态，构建出一个静谧而富有诗意的画面。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12737 ratio=4:5  // 原始 4:5 → 回退 3:4
    taskId: 'demo-yibai-fashion-12737',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12737-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12737-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12737.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260423/2c2b4c1b-337a-460e-b9a4-cfcd9ba19ecd.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `画面为横幅摄影照片，主体是一位年轻欧美男超模，位于画面偏左的位置，采用全身视角。人物穿着这个服装，左手挎着这个包，姿态慵懒地站在后方的浅色矮墙前，右手扶墙，低头看向画面左下角，左腿自然弯曲，呈现出随性而优雅的状态。镜头在人物正对面位置拍摄。整体构图平衡且富有层次感，光线为柔和的侧光（或前侧光），光线明亮，阴影柔和，色彩柔和协调，对比度适中，传达出宁静、优雅且略带复古时尚的情绪。画面质感细腻，整体氛围静谧而富有艺术气息。`,
      userPrompt: `画面为横幅摄影照片，主体是一位年轻欧美男超模，位于画面偏左的位置，采用全身视角。人物穿着这个服装，左手挎着这个包，姿态慵懒地站在后方的浅色矮墙前，右手扶墙，低头看向画面左下角，左腿自然弯曲，呈现出随性而优雅的状态。镜头在人物正对面位置拍摄。整体构图平衡且富有层次感，光线为柔和的侧光（或前侧光），光线明亮，阴影柔和，色彩柔和协调，对比度适中，传达出宁静、优雅且略带复古时尚的情绪。画面质感细腻，整体氛围静谧而富有艺术气息。`,
      finalPrompt: `画面为横幅摄影照片，主体是一位年轻欧美男超模，位于画面偏左的位置，采用全身视角。人物穿着这个服装，左手挎着这个包，姿态慵懒地站在后方的浅色矮墙前，右手扶墙，低头看向画面左下角，左腿自然弯曲，呈现出随性而优雅的状态。镜头在人物正对面位置拍摄。整体构图平衡且富有层次感，光线为柔和的侧光（或前侧光），光线明亮，阴影柔和，色彩柔和协调，对比度适中，传达出宁静、优雅且略带复古时尚的情绪。画面质感细腻，整体氛围静谧而富有艺术气息。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12737'],
    results: [
      {
        assetId: 'demo-yibai-12737',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260423/2c2b4c1b-337a-460e-b9a4-cfcd9ba19ecd.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260423/2c2b4c1b-337a-460e-b9a4-cfcd9ba19ecd.png',
        width: 1024,
        height: 1365,
        finalPrompt: `画面为横幅摄影照片，主体是一位年轻欧美男超模，位于画面偏左的位置，采用全身视角。人物穿着这个服装，左手挎着这个包，姿态慵懒地站在后方的浅色矮墙前，右手扶墙，低头看向画面左下角，左腿自然弯曲，呈现出随性而优雅的状态。镜头在人物正对面位置拍摄。整体构图平衡且富有层次感，光线为柔和的侧光（或前侧光），光线明亮，阴影柔和，色彩柔和协调，对比度适中，传达出宁静、优雅且略带复古时尚的情绪。画面质感细腻，整体氛围静谧而富有艺术气息。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12719 ratio=2:3
    taskId: 'demo-yibai-fashion-12719',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12719-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12719-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12719.jpg',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/4c2a33cd-6513-404e-beb9-0ebca501f139.jpg',
        fileType: 'image/jpeg',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `一位年轻亚洲女网红站立在这个海边码头的石阶上，她穿着这个服装正抬起脚步向石阶上行走，右手垂落拿着几本书，左手持黑色数码相机，姿态放松自然，侧身对着镜头，模特抬头眼神看向镜头右侧。构图上人物位于画面中下部，采用竖幅构图，以石阶和水面为引导线，将视线引向人物，视角为俯视，展现全身姿态。画面色彩以冷色调为主，海水的蓝、石阶的灰、服饰的白与藏青形成柔和对比，光线柔和自然，营造出宁静闲适的氛围，整体风格写实，细节丰富，如石阶的斑驳纹理、水面的波纹及人物服饰的质感都清晰可见，传递出一种轻松惬意的海滨生活情调。`,
      userPrompt: `一位年轻亚洲女网红站立在这个海边码头的石阶上，她穿着这个服装正抬起脚步向石阶上行走，右手垂落拿着几本书，左手持黑色数码相机，姿态放松自然，侧身对着镜头，模特抬头眼神看向镜头右侧。构图上人物位于画面中下部，采用竖幅构图，以石阶和水面为引导线，将视线引向人物，视角为俯视，展现全身姿态。画面色彩以冷色调为主，海水的蓝、石阶的灰、服饰的白与藏青形成柔和对比，光线柔和自然，营造出宁静闲适的氛围，整体风格写实，细节丰富，如石阶的斑驳纹理、水面的波纹及人物服饰的质感都清晰可见，传递出一种轻松惬意的海滨生活情调。`,
      finalPrompt: `一位年轻亚洲女网红站立在这个海边码头的石阶上，她穿着这个服装正抬起脚步向石阶上行走，右手垂落拿着几本书，左手持黑色数码相机，姿态放松自然，侧身对着镜头，模特抬头眼神看向镜头右侧。构图上人物位于画面中下部，采用竖幅构图，以石阶和水面为引导线，将视线引向人物，视角为俯视，展现全身姿态。画面色彩以冷色调为主，海水的蓝、石阶的灰、服饰的白与藏青形成柔和对比，光线柔和自然，营造出宁静闲适的氛围，整体风格写实，细节丰富，如石阶的斑驳纹理、水面的波纹及人物服饰的质感都清晰可见，传递出一种轻松惬意的海滨生活情调。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '2:3',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12719'],
    results: [
      {
        assetId: 'demo-yibai-12719',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/4c2a33cd-6513-404e-beb9-0ebca501f139.jpg',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/4c2a33cd-6513-404e-beb9-0ebca501f139.jpg',
        width: 1024,
        height: 1365,
        finalPrompt: `一位年轻亚洲女网红站立在这个海边码头的石阶上，她穿着这个服装正抬起脚步向石阶上行走，右手垂落拿着几本书，左手持黑色数码相机，姿态放松自然，侧身对着镜头，模特抬头眼神看向镜头右侧。构图上人物位于画面中下部，采用竖幅构图，以石阶和水面为引导线，将视线引向人物，视角为俯视，展现全身姿态。画面色彩以冷色调为主，海水的蓝、石阶的灰、服饰的白与藏青形成柔和对比，光线柔和自然，营造出宁静闲适的氛围，整体风格写实，细节丰富，如石阶的斑驳纹理、水面的波纹及人物服饰的质感都清晰可见，传递出一种轻松惬意的海滨生活情调。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12711 ratio=2:3
    taskId: 'demo-yibai-fashion-12711',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12711-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12711-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12711.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/12a4933a-c251-4f81-bcc8-ee5a37d169e1.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `画面采用竖幅构图，主体人物（年轻亚洲女网红，妆容精致）位于画面中间偏下位置，以平视特性视角呈现人物半身像。人物穿着这个服装，深色长卷发自然垂落，姿态轻松，双手叉腰，展现出优雅随性的气质。柔和温暖的阳光洒落在人物身上。背景是开阔的蓝色水域（可能是河流或湖泊），水面波光粼粼，远处模糊的建筑群与树木增添了场景的层次感光线柔和（建筑群被阳光照射出暖色），营造出温暖宁静的氛围，画面质感细腻，细节丰富，具有高清摄影的写实效果，传递出优雅自信的情绪，构图采用自然的中景布局，背景元素简洁而富有空间感，突出人物主体，整体风格偏向时尚杂志大片，光线柔和均匀，无强烈阴影，整体亮度适中，给人舒适放松的视觉体验。`,
      userPrompt: `画面采用竖幅构图，主体人物（年轻亚洲女网红，妆容精致）位于画面中间偏下位置，以平视特性视角呈现人物半身像。人物穿着这个服装，深色长卷发自然垂落，姿态轻松，双手叉腰，展现出优雅随性的气质。柔和温暖的阳光洒落在人物身上。背景是开阔的蓝色水域（可能是河流或湖泊），水面波光粼粼，远处模糊的建筑群与树木增添了场景的层次感光线柔和（建筑群被阳光照射出暖色），营造出温暖宁静的氛围，画面质感细腻，细节丰富，具有高清摄影的写实效果，传递出优雅自信的情绪，构图采用自然的中景布局，背景元素简洁而富有空间感，突出人物主体，整体风格偏向时尚杂志大片，光线柔和均匀，无强烈阴影，整体亮度适中，给人舒适放松的视觉体验。`,
      finalPrompt: `画面采用竖幅构图，主体人物（年轻亚洲女网红，妆容精致）位于画面中间偏下位置，以平视特性视角呈现人物半身像。人物穿着这个服装，深色长卷发自然垂落，姿态轻松，双手叉腰，展现出优雅随性的气质。柔和温暖的阳光洒落在人物身上。背景是开阔的蓝色水域（可能是河流或湖泊），水面波光粼粼，远处模糊的建筑群与树木增添了场景的层次感光线柔和（建筑群被阳光照射出暖色），营造出温暖宁静的氛围，画面质感细腻，细节丰富，具有高清摄影的写实效果，传递出优雅自信的情绪，构图采用自然的中景布局，背景元素简洁而富有空间感，突出人物主体，整体风格偏向时尚杂志大片，光线柔和均匀，无强烈阴影，整体亮度适中，给人舒适放松的视觉体验。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '2:3',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12711'],
    results: [
      {
        assetId: 'demo-yibai-12711',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/12a4933a-c251-4f81-bcc8-ee5a37d169e1.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/12a4933a-c251-4f81-bcc8-ee5a37d169e1.png',
        width: 1024,
        height: 1365,
        finalPrompt: `画面采用竖幅构图，主体人物（年轻亚洲女网红，妆容精致）位于画面中间偏下位置，以平视特性视角呈现人物半身像。人物穿着这个服装，深色长卷发自然垂落，姿态轻松，双手叉腰，展现出优雅随性的气质。柔和温暖的阳光洒落在人物身上。背景是开阔的蓝色水域（可能是河流或湖泊），水面波光粼粼，远处模糊的建筑群与树木增添了场景的层次感光线柔和（建筑群被阳光照射出暖色），营造出温暖宁静的氛围，画面质感细腻，细节丰富，具有高清摄影的写实效果，传递出优雅自信的情绪，构图采用自然的中景布局，背景元素简洁而富有空间感，突出人物主体，整体风格偏向时尚杂志大片，光线柔和均匀，无强烈阴影，整体亮度适中，给人舒适放松的视觉体验。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12708 ratio=2:3
    taskId: 'demo-yibai-fashion-12708',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12708-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12708-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12708.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7d50f81f-ffc2-4bb2-9f95-e33877252506.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `一位年轻亚洲女网红站在布满锈迹的岩石结构上，以低角度仰视角度拍摄增强了她的存在感。她身着这个服装，左手持黑色相机，右手插在裤兜中，姿态放松却透着专注。人物位于画面中景偏上位置，构图遵循三分法，岩石前景占据下方五分之一区域，天空背景简洁留白，整体为竖幅构图，色调以柔和的冷色调为主，氛围宁静，光线来自侧上方，形成自然柔和的阴影，画面质感细腻，呈现出一种复古文艺的写实摄影风格，仿佛捕捉到了一个关于探索与记录的瞬间，整体明亮却不刺眼，通过人物的衣着与背景的简洁天空营造出悠闲又略带沉思的情绪。`,
      userPrompt: `一位年轻亚洲女网红站在布满锈迹的岩石结构上，以低角度仰视角度拍摄增强了她的存在感。她身着这个服装，左手持黑色相机，右手插在裤兜中，姿态放松却透着专注。人物位于画面中景偏上位置，构图遵循三分法，岩石前景占据下方五分之一区域，天空背景简洁留白，整体为竖幅构图，色调以柔和的冷色调为主，氛围宁静，光线来自侧上方，形成自然柔和的阴影，画面质感细腻，呈现出一种复古文艺的写实摄影风格，仿佛捕捉到了一个关于探索与记录的瞬间，整体明亮却不刺眼，通过人物的衣着与背景的简洁天空营造出悠闲又略带沉思的情绪。`,
      finalPrompt: `一位年轻亚洲女网红站在布满锈迹的岩石结构上，以低角度仰视角度拍摄增强了她的存在感。她身着这个服装，左手持黑色相机，右手插在裤兜中，姿态放松却透着专注。人物位于画面中景偏上位置，构图遵循三分法，岩石前景占据下方五分之一区域，天空背景简洁留白，整体为竖幅构图，色调以柔和的冷色调为主，氛围宁静，光线来自侧上方，形成自然柔和的阴影，画面质感细腻，呈现出一种复古文艺的写实摄影风格，仿佛捕捉到了一个关于探索与记录的瞬间，整体明亮却不刺眼，通过人物的衣着与背景的简洁天空营造出悠闲又略带沉思的情绪。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '2:3',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12708'],
    results: [
      {
        assetId: 'demo-yibai-12708',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7d50f81f-ffc2-4bb2-9f95-e33877252506.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7d50f81f-ffc2-4bb2-9f95-e33877252506.png',
        width: 1024,
        height: 1365,
        finalPrompt: `一位年轻亚洲女网红站在布满锈迹的岩石结构上，以低角度仰视角度拍摄增强了她的存在感。她身着这个服装，左手持黑色相机，右手插在裤兜中，姿态放松却透着专注。人物位于画面中景偏上位置，构图遵循三分法，岩石前景占据下方五分之一区域，天空背景简洁留白，整体为竖幅构图，色调以柔和的冷色调为主，氛围宁静，光线来自侧上方，形成自然柔和的阴影，画面质感细腻，呈现出一种复古文艺的写实摄影风格，仿佛捕捉到了一个关于探索与记录的瞬间，整体明亮却不刺眼，通过人物的衣着与背景的简洁天空营造出悠闲又略带沉思的情绪。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12705 ratio=2:3
    taskId: 'demo-yibai-fashion-12705',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12705-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12705-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12705.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7ea4def0-a2b3-4488-9505-e054ffc3014f.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `这是一幅写实风格的摄影作品，采用竖幅构图，主体人物位于画面中央位置。人物是一位身着这个服装的年轻亚洲女网红，她侧身背对镜头站立在滨海混凝土护岸（堤岸挡墙）的顶面，双手插在裤袋中，微微回头看向画面左侧，姿态放松自然，头发自然垂落，眼神望向远方（画面左侧）。背景是开阔的海景，海面平静，远处是带有岩石和植被的山丘，天空布满柔和的云层，整体色调以柔和的冷色调为主，蓝色的海水、天空与白色的衣物形成柔和对比，色彩饱和度适中，传达出宁静悠远的情绪。光线柔和，似乎来自侧前方，没有强烈的阴影，整体亮度均匀，营造出清新自然的氛围。画面中景的岩石海岸与远景的山峦构成层次感，引导视线向远方延伸，人物与自然环境和谐相融，给人一种悠闲惬意、放空思绪的感觉，画面细节丰富，人物衣着的质感、岩石的纹理、水面的波纹等都清晰可见，具有电影感的逼真渲染效果，整体氛围宁静而治愈。`,
      userPrompt: `这是一幅写实风格的摄影作品，采用竖幅构图，主体人物位于画面中央位置。人物是一位身着这个服装的年轻亚洲女网红，她侧身背对镜头站立在滨海混凝土护岸（堤岸挡墙）的顶面，双手插在裤袋中，微微回头看向画面左侧，姿态放松自然，头发自然垂落，眼神望向远方（画面左侧）。背景是开阔的海景，海面平静，远处是带有岩石和植被的山丘，天空布满柔和的云层，整体色调以柔和的冷色调为主，蓝色的海水、天空与白色的衣物形成柔和对比，色彩饱和度适中，传达出宁静悠远的情绪。光线柔和，似乎来自侧前方，没有强烈的阴影，整体亮度均匀，营造出清新自然的氛围。画面中景的岩石海岸与远景的山峦构成层次感，引导视线向远方延伸，人物与自然环境和谐相融，给人一种悠闲惬意、放空思绪的感觉，画面细节丰富，人物衣着的质感、岩石的纹理、水面的波纹等都清晰可见，具有电影感的逼真渲染效果，整体氛围宁静而治愈。`,
      finalPrompt: `这是一幅写实风格的摄影作品，采用竖幅构图，主体人物位于画面中央位置。人物是一位身着这个服装的年轻亚洲女网红，她侧身背对镜头站立在滨海混凝土护岸（堤岸挡墙）的顶面，双手插在裤袋中，微微回头看向画面左侧，姿态放松自然，头发自然垂落，眼神望向远方（画面左侧）。背景是开阔的海景，海面平静，远处是带有岩石和植被的山丘，天空布满柔和的云层，整体色调以柔和的冷色调为主，蓝色的海水、天空与白色的衣物形成柔和对比，色彩饱和度适中，传达出宁静悠远的情绪。光线柔和，似乎来自侧前方，没有强烈的阴影，整体亮度均匀，营造出清新自然的氛围。画面中景的岩石海岸与远景的山峦构成层次感，引导视线向远方延伸，人物与自然环境和谐相融，给人一种悠闲惬意、放空思绪的感觉，画面细节丰富，人物衣着的质感、岩石的纹理、水面的波纹等都清晰可见，具有电影感的逼真渲染效果，整体氛围宁静而治愈。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '2:3',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12705'],
    results: [
      {
        assetId: 'demo-yibai-12705',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7ea4def0-a2b3-4488-9505-e054ffc3014f.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260429/7ea4def0-a2b3-4488-9505-e054ffc3014f.png',
        width: 1024,
        height: 1365,
        finalPrompt: `这是一幅写实风格的摄影作品，采用竖幅构图，主体人物位于画面中央位置。人物是一位身着这个服装的年轻亚洲女网红，她侧身背对镜头站立在滨海混凝土护岸（堤岸挡墙）的顶面，双手插在裤袋中，微微回头看向画面左侧，姿态放松自然，头发自然垂落，眼神望向远方（画面左侧）。背景是开阔的海景，海面平静，远处是带有岩石和植被的山丘，天空布满柔和的云层，整体色调以柔和的冷色调为主，蓝色的海水、天空与白色的衣物形成柔和对比，色彩饱和度适中，传达出宁静悠远的情绪。光线柔和，似乎来自侧前方，没有强烈的阴影，整体亮度均匀，营造出清新自然的氛围。画面中景的岩石海岸与远景的山峦构成层次感，引导视线向远方延伸，人物与自然环境和谐相融，给人一种悠闲惬意、放空思绪的感觉，画面细节丰富，人物衣着的质感、岩石的纹理、水面的波纹等都清晰可见，具有电影感的逼真渲染效果，整体氛围宁静而治愈。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=12024 ratio=1:1
    taskId: 'demo-yibai-fashion-12024',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-12024-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-12024-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-12024.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260420/c6de9d53-94c7-48e8-be56-69e497de8b45.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `近景头像照，这是一张低饱和写实风格的摄影照片，整体画面采用高清晰度写实滤镜，聚焦一位中国女性超模的静谧姿态。（高级，大片模特，身材非常纤细高挑（模特身高180cm，体重80斤），头小（八头身，比例匀称，头比例小，长相大气。）穿着图上的这个服装，以展示服装为视觉核心，融入在画面之中，自然和谐，光线统一，

画面背景呈快速抓拍的模糊拉丝的现城市街道场景：核心区域是浅米色（或白色）的欧式建筑（墙面平整，带有装饰性檐口与窗户，建筑细节精致，部分商铺可见红黑配色的遮阳篷，增添生活气息）；右侧是城市街道，可见黑白相间的斑马线（线条规整，地面为灰色铺装，夹杂零星落叶），交通标志杆上有蓝色箭头标识，远处隐约可见车辆与行人轮廓，整体环境兼具都市建筑的精致感与街道的日常感。

光影以明亮的自然光为主导（光线方向推测为斜上方或侧面），强度适中且柔和。建筑墙面与街道设施呈现自然明暗过渡（如建筑阴影区浅淡，街道铺装反光细腻），人物及背景的影子清晰但边缘柔和（无强烈硬阴影），整体光影既凸显城市街道的真实质感，又通过均匀光线赋予场景清新明亮的日常氛围。
不要出现文字

她以侧身站立姿态呈现，右手持图上这个包，左手轻触唇部，身体微侧，头部转向镜头方向，整体面向镜头区域。头部微侧，面部朝向镜头，目光直视，神情专注。头发为深色（黑色）长发，发丝自然垂落，纹理清晰。背景是城市街道与建筑，整体氛围时尚且具街头感。`,
      userPrompt: `近景头像照，这是一张低饱和写实风格的摄影照片，整体画面采用高清晰度写实滤镜，聚焦一位中国女性超模的静谧姿态。（高级，大片模特，身材非常纤细高挑（模特身高180cm，体重80斤），头小（八头身，比例匀称，头比例小，长相大气。）穿着图上的这个服装，以展示服装为视觉核心，融入在画面之中，自然和谐，光线统一，

画面背景呈快速抓拍的模糊拉丝的现城市街道场景：核心区域是浅米色（或白色）的欧式建筑（墙面平整，带有装饰性檐口与窗户，建筑细节精致，部分商铺可见红黑配色的遮阳篷，增添生活气息）；右侧是城市街道，可见黑白相间的斑马线（线条规整，地面为灰色铺装，夹杂零星落叶），交通标志杆上有蓝色箭头标识，远处隐约可见车辆与行人轮廓，整体环境兼具都市建筑的精致感与街道的日常感。

光影以明亮的自然光为主导（光线方向推测为斜上方或侧面），强度适中且柔和。建筑墙面与街道设施呈现自然明暗过渡（如建筑阴影区浅淡，街道铺装反光细腻），人物及背景的影子清晰但边缘柔和（无强烈硬阴影），整体光影既凸显城市街道的真实质感，又通过均匀光线赋予场景清新明亮的日常氛围。
不要出现文字

她以侧身站立姿态呈现，右手持图上这个包，左手轻触唇部，身体微侧，头部转向镜头方向，整体面向镜头区域。头部微侧，面部朝向镜头，目光直视，神情专注。头发为深色（黑色）长发，发丝自然垂落，纹理清晰。背景是城市街道与建筑，整体氛围时尚且具街头感。`,
      finalPrompt: `近景头像照，这是一张低饱和写实风格的摄影照片，整体画面采用高清晰度写实滤镜，聚焦一位中国女性超模的静谧姿态。（高级，大片模特，身材非常纤细高挑（模特身高180cm，体重80斤），头小（八头身，比例匀称，头比例小，长相大气。）穿着图上的这个服装，以展示服装为视觉核心，融入在画面之中，自然和谐，光线统一，

画面背景呈快速抓拍的模糊拉丝的现城市街道场景：核心区域是浅米色（或白色）的欧式建筑（墙面平整，带有装饰性檐口与窗户，建筑细节精致，部分商铺可见红黑配色的遮阳篷，增添生活气息）；右侧是城市街道，可见黑白相间的斑马线（线条规整，地面为灰色铺装，夹杂零星落叶），交通标志杆上有蓝色箭头标识，远处隐约可见车辆与行人轮廓，整体环境兼具都市建筑的精致感与街道的日常感。

光影以明亮的自然光为主导（光线方向推测为斜上方或侧面），强度适中且柔和。建筑墙面与街道设施呈现自然明暗过渡（如建筑阴影区浅淡，街道铺装反光细腻），人物及背景的影子清晰但边缘柔和（无强烈硬阴影），整体光影既凸显城市街道的真实质感，又通过均匀光线赋予场景清新明亮的日常氛围。
不要出现文字

她以侧身站立姿态呈现，右手持图上这个包，左手轻触唇部，身体微侧，头部转向镜头方向，整体面向镜头区域。头部微侧，面部朝向镜头，目光直视，神情专注。头发为深色（黑色）长发，发丝自然垂落，纹理清晰。背景是城市街道与建筑，整体氛围时尚且具街头感。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '1:1',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-12024'],
    results: [
      {
        assetId: 'demo-yibai-12024',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260420/c6de9d53-94c7-48e8-be56-69e497de8b45.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260420/c6de9d53-94c7-48e8-be56-69e497de8b45.png',
        width: 1024,
        height: 1365,
        finalPrompt: `近景头像照，这是一张低饱和写实风格的摄影照片，整体画面采用高清晰度写实滤镜，聚焦一位中国女性超模的静谧姿态。（高级，大片模特，身材非常纤细高挑（模特身高180cm，体重80斤），头小（八头身，比例匀称，头比例小，长相大气。）穿着图上的这个服装，以展示服装为视觉核心，融入在画面之中，自然和谐，光线统一，

画面背景呈快速抓拍的模糊拉丝的现城市街道场景：核心区域是浅米色（或白色）的欧式建筑（墙面平整，带有装饰性檐口与窗户，建筑细节精致，部分商铺可见红黑配色的遮阳篷，增添生活气息）；右侧是城市街道，可见黑白相间的斑马线（线条规整，地面为灰色铺装，夹杂零星落叶），交通标志杆上有蓝色箭头标识，远处隐约可见车辆与行人轮廓，整体环境兼具都市建筑的精致感与街道的日常感。

光影以明亮的自然光为主导（光线方向推测为斜上方或侧面），强度适中且柔和。建筑墙面与街道设施呈现自然明暗过渡（如建筑阴影区浅淡，街道铺装反光细腻），人物及背景的影子清晰但边缘柔和（无强烈硬阴影），整体光影既凸显城市街道的真实质感，又通过均匀光线赋予场景清新明亮的日常氛围。
不要出现文字

她以侧身站立姿态呈现，右手持图上这个包，左手轻触唇部，身体微侧，头部转向镜头方向，整体面向镜头区域。头部微侧，面部朝向镜头，目光直视，神情专注。头发为深色（黑色）长发，发丝自然垂落，纹理清晰。背景是城市街道与建筑，整体氛围时尚且具街头感。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
  {
    // yibai id=10746 ratio=4:5  // 原始 4:5 → 回退 3:4
    taskId: 'demo-yibai-fashion-10746',
    featureType: 'ai-fashion-photo',
    workflowId: 'ai_fashion_photo_v1',
    inputAssetIds: ['demo-yibai-10746-ref'],
    inputAssets: [
      {
        assetId: 'demo-yibai-10746-ref',
        userId: 'demo',
        projectId: 'demo',
        fileName: 'reference-10746.png',
        fileUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260402/54bec4ad-d912-4186-8585-eceafb2986d3.png',
        fileType: 'image/png',
        width: 1024,
        height: 1365,
        createdAt: '2026-05-12T00:00:00Z',
      },
    ],
    params: {
      prompt: `只拍摄到脚部，未拍摄到大腿，大片质感，光影厚重，聚焦两位欧美青年女模特的静谧姿态。模特皮肤白皙光滑，穿着图上的这个服装，这张图片呈现了图上这个鞋的写真的场景。焦点在图上这个鞋，重点突出鞋的材质感，写实风格时尚产品摄影

画面背景为户外网球场场景，黑色编织状球网占据主要视觉区域，网格结构清晰，网后可见绿色草皮与红色场地区域，色彩对比鲜明，草皮纹理自然，红色区域带有白色标线，呈现出标准网球场的运动质感。地面为绿色人造草皮，带有白色运动标线，质感细腻且富有颗粒感，凸显运动场地的真实感。

光影方面，整体光线明亮均匀，属于晴朗天气下的自然光，光线以漫射为主，阴影清晰柔和，无强烈明暗对比。草皮与球网在光线照射下呈现出自然的明暗层次，白色网球表面有轻微高光，人物（腿部）的皮肤与衣物阴影过渡自然，光线方向似来自侧上方，既增强了场景的立体感，又避免了过强阴影干扰，整体氛围清新活力，契合运动场景的轻松感。`,
      userPrompt: `只拍摄到脚部，未拍摄到大腿，大片质感，光影厚重，聚焦两位欧美青年女模特的静谧姿态。模特皮肤白皙光滑，穿着图上的这个服装，这张图片呈现了图上这个鞋的写真的场景。焦点在图上这个鞋，重点突出鞋的材质感，写实风格时尚产品摄影

画面背景为户外网球场场景，黑色编织状球网占据主要视觉区域，网格结构清晰，网后可见绿色草皮与红色场地区域，色彩对比鲜明，草皮纹理自然，红色区域带有白色标线，呈现出标准网球场的运动质感。地面为绿色人造草皮，带有白色运动标线，质感细腻且富有颗粒感，凸显运动场地的真实感。

光影方面，整体光线明亮均匀，属于晴朗天气下的自然光，光线以漫射为主，阴影清晰柔和，无强烈明暗对比。草皮与球网在光线照射下呈现出自然的明暗层次，白色网球表面有轻微高光，人物（腿部）的皮肤与衣物阴影过渡自然，光线方向似来自侧上方，既增强了场景的立体感，又避免了过强阴影干扰，整体氛围清新活力，契合运动场景的轻松感。`,
      finalPrompt: `只拍摄到脚部，未拍摄到大腿，大片质感，光影厚重，聚焦两位欧美青年女模特的静谧姿态。模特皮肤白皙光滑，穿着图上的这个服装，这张图片呈现了图上这个鞋的写真的场景。焦点在图上这个鞋，重点突出鞋的材质感，写实风格时尚产品摄影

画面背景为户外网球场场景，黑色编织状球网占据主要视觉区域，网格结构清晰，网后可见绿色草皮与红色场地区域，色彩对比鲜明，草皮纹理自然，红色区域带有白色标线，呈现出标准网球场的运动质感。地面为绿色人造草皮，带有白色运动标线，质感细腻且富有颗粒感，凸显运动场地的真实感。

光影方面，整体光线明亮均匀，属于晴朗天气下的自然光，光线以漫射为主，阴影清晰柔和，无强烈明暗对比。草皮与球网在光线照射下呈现出自然的明暗层次，白色网球表面有轻微高光，人物（腿部）的皮肤与衣物阴影过渡自然，光线方向似来自侧上方，既增强了场景的立体感，又避免了过强阴影干扰，整体氛围清新活力，契合运动场景的轻松感。`,
      promptMode: 'raw',
      model: 'gemini-3-pro-image-preview',
      referenceImageCount: 1,
      imageRatio: '3:4',
      resolution: '4k',
      resultCount: 1,
      creditsCost: 35,
    },
    status: 'success',
    progress: 100,
    message: '演示案例',
    resultAssetIds: ['demo-yibai-10746'],
    results: [
      {
        assetId: 'demo-yibai-10746',
        url: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260402/54bec4ad-d912-4186-8585-eceafb2986d3.png',
        downloadUrl: 'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260402/54bec4ad-d912-4186-8585-eceafb2986d3.png',
        width: 1024,
        height: 1365,
        finalPrompt: `只拍摄到脚部，未拍摄到大腿，大片质感，光影厚重，聚焦两位欧美青年女模特的静谧姿态。模特皮肤白皙光滑，穿着图上的这个服装，这张图片呈现了图上这个鞋的写真的场景。焦点在图上这个鞋，重点突出鞋的材质感，写实风格时尚产品摄影

画面背景为户外网球场场景，黑色编织状球网占据主要视觉区域，网格结构清晰，网后可见绿色草皮与红色场地区域，色彩对比鲜明，草皮纹理自然，红色区域带有白色标线，呈现出标准网球场的运动质感。地面为绿色人造草皮，带有白色运动标线，质感细腻且富有颗粒感，凸显运动场地的真实感。

光影方面，整体光线明亮均匀，属于晴朗天气下的自然光，光线以漫射为主，阴影清晰柔和，无强烈明暗对比。草皮与球网在光线照射下呈现出自然的明暗层次，白色网球表面有轻微高光，人物（腿部）的皮肤与衣物阴影过渡自然，光线方向似来自侧上方，既增强了场景的立体感，又避免了过强阴影干扰，整体氛围清新活力，契合运动场景的轻松感。`,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    finishedAt: '2026-05-12T00:00:00Z',
    creditsUsed: 0,
  },
]

/**
 * 服装大片裂变演示 case：友商「上衣 9 宫格 16:9」原始套图。
 * 9 张套图来自 yibaiaigc ai-cloth-virality API 同一张参考图（白色 T 恤）+ promptId 12-20。
 * shotLabels 是本小姐根据成片视觉效果人工命名（实际 9 张 prompt 内容未在本地资料导出）。
 *
 * 图片资源走 yibaiaigc 阿里云 OSS 公开直链。
 */
export const YIBAI_PHOTO_FISSION_CASE_SHIRT_9GRID: PhotoFissionCase = {
  id: 'yibai-shirt-16-9-grid',
  featureType: 'photo-fission',
  name: '白T9宫格 16:9 户外',
  description:
    '友商演示案例：白色短袖 T 恤 + 9 个不同户外/室内场景，覆盖运动、街拍、棚拍等高频电商投流场景。',
  category: 'tops',
  mainImageUrl: 'https://yb-ai.oss-accelerate.aliyuncs.com/67377048-9eb7-4a06-b354-adfd87194c56.jpeg',
  resultImageUrls: [
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/90dd1c7a-b1f7-4591-8498-4300d464eb33.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/08cf8a90-5038-4e33-a740-ec3762710ee7.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/7110f0cb-398d-4f24-8fe8-1f7bbb467b4f.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/8e008832-963c-4821-9c57-9a2ab66f0171.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/8053789e-7f92-4d24-a8b1-db0233c670f8.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/36c96753-3644-4f17-9a51-34e8ac36af1b.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/e21063a4-55dd-4346-9a5c-ee39d4deeaa1.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/268243e2-e19f-4c5d-89de-91cb3992fe05.png',
    'https://yb-ai.oss-cn-hangzhou.aliyuncs.com/20260226/8c978061-66aa-485c-8a25-905489618e02.png',
  ],
  shotLabels: [
    '场景一',
    '场景二',
    '场景三',
    '场景四',
    '场景五',
    '场景六',
    '场景七',
    '场景八',
    '场景九',
  ],
  imageRatio: '16:9',
  resolution: '2k',
  modelId: 'gemini-3-pro-image-preview',
}
