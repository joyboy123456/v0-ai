import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node 的原生 TypeScript 测试运行器要求显式扩展名。
import { getPoseFissionInputAssetLabel, isCurrentPoseFissionPose, readPoseFissionDetailPoses, resolvePoseFissionAssetSlotIndex } from "./pose-fission-detail.ts";

test("从 params.poses 读取姿势，跳过无 id/url 和重复项", () => {
  const poses = readPoseFissionDetailPoses({
    poses: [
      { id: "pose_1", url: "/kick.png", name: "踢腿", bodyPart: "lower" },
      { id: "pose_1", url: "/dup.png", name: "重复", bodyPart: "full" },
      { id: "pose_2", url: "", name: "空地址", bodyPart: "full" },
      { id: "", url: "/x.png", name: "空 id", bodyPart: "full" },
      { id: "pose_3", url: "/sit.png", name: "  ", bodyPart: "upper" },
      null,
      "bad",
    ],
  });

  assert.deepEqual(poses, [
    { id: "pose_1", url: "/kick.png", name: "踢腿", bodyPart: "lower" },
    { id: "pose_3", url: "/sit.png", name: "未命名姿势", bodyPart: "upper" },
  ]);
});

test("旧任务或非姿势裂变 params 返回空数组", () => {
  assert.deepEqual(readPoseFissionDetailPoses(undefined), []);
  assert.deepEqual(readPoseFissionDetailPoses({}), []);
  assert.deepEqual(readPoseFissionDetailPoses({ poses: "x" }), []);
});

test("服装参考图按主图/正面/背面角色标注", () => {
  assert.equal(
    getPoseFissionInputAssetLabel({
      index: 0,
      assetCount: 3,
      hasFrontDetail: true,
      hasBackDetail: true,
    }),
    "主图",
  );
  assert.equal(
    getPoseFissionInputAssetLabel({
      index: 1,
      assetCount: 3,
      hasFrontDetail: true,
      hasBackDetail: true,
    }),
    "正面细节",
  );
  assert.equal(
    getPoseFissionInputAssetLabel({
      index: 2,
      assetCount: 3,
      hasFrontDetail: true,
      hasBackDetail: true,
    }),
    "背面细节",
  );
  assert.equal(
    getPoseFissionInputAssetLabel({
      index: 1,
      assetCount: 2,
      hasFrontDetail: false,
      hasBackDetail: true,
    }),
    "背面细节",
  );
});

test("缺细节标记但正好 3 张参考图时按主图+正反细节推断", () => {
  assert.equal(
    getPoseFissionInputAssetLabel({ index: 1, assetCount: 3 }),
    "正面细节",
  );
  assert.equal(
    getPoseFissionInputAssetLabel({ index: 2, assetCount: 3 }),
    "背面细节",
  );
  assert.equal(
    getPoseFissionInputAssetLabel({ index: 1, assetCount: 2 }),
    "图2",
  );
});

test("当前结果按 shotId 对应姿势", () => {
  assert.equal(isCurrentPoseFissionPose("pose_1", "pose_1"), true);
  assert.equal(isCurrentPoseFissionPose("pose_1", "pose_2"), false);
  assert.equal(isCurrentPoseFissionPose("pose_1", null), false);
  assert.equal(isCurrentPoseFissionPose("pose_1", undefined), false);
});

test("缺正面细节时仍按原始槽位把背面标成背面细节", () => {
  const inputAssetIds = ["main", "front", "back"];
  const displayed = ["main", "back"];
  const labels = displayed.map((assetId, fallbackIndex) => {
    const index = resolvePoseFissionAssetSlotIndex(
      assetId,
      inputAssetIds,
      fallbackIndex,
    );
    return getPoseFissionInputAssetLabel({
      index,
      assetCount: inputAssetIds.length,
      hasFrontDetail: true,
      hasBackDetail: true,
    });
  });
  assert.deepEqual(labels, ["主图", "背面细节"]);
});
