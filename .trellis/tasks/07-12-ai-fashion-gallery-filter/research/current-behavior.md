# 当前行为调查

- `onlyCurrentFeature` 和 `onlyFavorites` 已存在，但前者没有参与列表渲染。
- AI 服装大片的 `current` Tab 当前无条件渲染 `FavoriteCasesGallery`，导致默认无法看到全部图片。
- `AiFashionMasonryGallery` 已能展示当前功能生成图片和演示图片。
- `/api/favorites/cases?feature=ai-fashion-photo` 已能返回对应功能收藏，无需修改后端。
- 收藏切换完成后已有刷新逻辑，可以让取消收藏的图片退出收藏列表。
- 历史记录已有 `batchSelectMode`、`selectedAssets`、`toggleImageSelection` 和 `downloadSelectedImages`，可直接复用统一交互。
- 案例库的两个画廊组件尚未接收批量选择状态；需要在选择模式下把卡片点击行为从预览切换为选中/取消选中，并隐藏普通悬浮操作。
- `GenerationDetailDialog` 已接收通用 `onDeleteResult`，但删除按钮被 `isPhotoFission` 条件限制，导致 AI 服装大片和姿势裂变详情缺少删除入口。
- `DELETE /api/tasks/[taskId]/results/[assetId]` 与 `deleteResultFromTask` 按 task/asset 通用处理，三个功能可复用，无需新增后端接口。
- 收藏案例使用独立的 `favoriteCases` state；删除成功后需要同步过滤该列表和本地 favorites，避免残留失效卡片。
- 生产服务器存在未提交但已上线的收藏热修：`GET /api/assets/favorites`、`listAllFavoritedAssetIds`、页面加载时服务端收藏覆盖/迁移，以及收藏图片加载失败时隐藏并取消收藏。部署前必须合并，不能用 GitHub 版本覆盖回退。
