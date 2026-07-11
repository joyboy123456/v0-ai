# 参考图顺序契约与视频交互核对

## 视频交互

- 用户从 Finder 拖入一张或多张图片到图片输入区域。
- 上传后图片以横向/网格缩略图队列显示。
- 缩略图具有 1、2、3 等序号角标。
- 用户可再次拖动缩略图调整顺序，序号随新位置更新。
- 添加按钮在未满上限时持续可用。

## 当前代码契约

- 顶层状态是 `Workbench` 中的 `fashionReferences: FashionReferenceImage[]`。
- 添加参考图使用数组尾部追加，删除使用 assetId 过滤。
- `LeftPanel.getInputAssetDescriptors()` 对 `fashionReferences` 按当前数组顺序 map。
- `POST /api/tasks` 的 `inputAssetIds` 来自上述 descriptors，因此数组顺序就是上传给模型的真实顺序。
- `FashionReferenceUploader` 当前只支持隐藏 file input 点击上传，已有多选和 10 张上限。
- 模特库参考图与本地上传图都进入同一个 `fashionReferences` 数组。

## 实现约束

- 重排必须通过父级回调更新 `fashionReferences`。
- 外部文件拖入与内部缩略图排序要区分；内部拖动不得触发文件上传。
- 不引入 DnD 依赖，使用 `dataTransfer`、drag state 和数组 splice 完成。
