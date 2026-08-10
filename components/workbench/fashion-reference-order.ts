export interface FashionReferenceOrderItem {
  assetId: string;
}

/**
 * 固定项始终留在原索引，只调整其余索引中的可移动项顺序。
 * 固定项不能作为拖拽源或目标。
 */
export function reorderUnpinnedFashionReferences<
  T extends FashionReferenceOrderItem,
>(
  items: T[],
  sourceAssetId: string,
  targetAssetId: string,
  pinnedAssetIds: ReadonlySet<string>,
): T[] {
  if (
    sourceAssetId === targetAssetId ||
    pinnedAssetIds.has(sourceAssetId) ||
    pinnedAssetIds.has(targetAssetId)
  ) {
    return items;
  }

  const movableItems = items.filter((item) => !pinnedAssetIds.has(item.assetId));
  const sourceIndex = movableItems.findIndex(
    (item) => item.assetId === sourceAssetId,
  );
  const targetIndex = movableItems.findIndex(
    (item) => item.assetId === targetAssetId,
  );
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items;
  }

  const reorderedMovableItems = movableItems.slice();
  const [movedItem] = reorderedMovableItems.splice(sourceIndex, 1);
  reorderedMovableItems.splice(targetIndex, 0, movedItem);

  let movableIndex = 0;
  return items.map((item) => {
    if (pinnedAssetIds.has(item.assetId)) return item;
    const nextItem = reorderedMovableItems[movableIndex];
    movableIndex += 1;
    return nextItem;
  });
}
