import assert from "node:assert/strict";
import test from "node:test";
import { reorderUnpinnedFashionReferences } from "./fashion-reference-order";

const references = ["a", "b", "c", "d"].map((assetId) => ({ assetId }));

test("重排时固定素材始终占据原索引", () => {
  const next = reorderUnpinnedFashionReferences(
    references,
    "a",
    "d",
    new Set(["b"]),
  );

  assert.deepEqual(
    next.map((item) => item.assetId),
    ["c", "b", "d", "a"],
  );
  assert.equal(next[1], references[1]);
});

test("固定素材不能作为拖拽源或目标", () => {
  const pinned = new Set(["b"]);

  assert.equal(
    reorderUnpinnedFashionReferences(references, "b", "d", pinned),
    references,
  );
  assert.equal(
    reorderUnpinnedFashionReferences(references, "a", "b", pinned),
    references,
  );
});

test("多个固定槽位之间只交换可移动素材", () => {
  const next = reorderUnpinnedFashionReferences(
    references,
    "d",
    "a",
    new Set(["b", "c"]),
  );

  assert.deepEqual(
    next.map((item) => item.assetId),
    ["d", "b", "c", "a"],
  );
  assert.equal(next[1], references[1]);
  assert.equal(next[2], references[2]);
});
