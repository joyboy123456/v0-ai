#!/usr/bin/env python3
"""
批量生成姿势参考图脚本。

使用 GPT Image 2 图生图，以儿童模特为基底，为每个姿势模板生成参考图。
图片保存到 public/poses/<id>.jpg。

用法:
  python3 scripts/generate-pose-images.py [--start-index N] [--count N] [--skip-existing]

参数:
  --start-index N   从第 N 个姿势开始（0-indexed）
  --count N         只生成 N 张图（默认全部）
  --skip-existing   跳过已存在的图片（用于断点续跑）
  --dry-run         只打印要生成的姿势，不实际调用 API
"""

import argparse
import base64
import json
import os
import sys
import time

API_URL = "http://192.168.0.100:11436/v1/images/edits"
MODEL = "gpt-image-2"
IMAGE_SIZE = "896x1200"
TIMEOUT = 300
RETRY_ATTEMPTS = 2
OUTPUT_QUALITY = 85

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
BASE_IMAGE = os.path.join(PROJECT_DIR, "public", "poses", "_base-model.jpg")
OUTPUT_DIR = os.path.join(PROJECT_DIR, "public", "poses")

# 每个姿势的简化提示词（儿童友好、棚拍背景）
POSE_PROMPTS = [
    {
        "id": "pose-front-stand-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为正面站姿：双脚自然分开与肩同宽，双手自然下垂放在身体两侧，表情自然微笑，直视镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-front-stand-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为正面站姿：双手轻轻交叉在身前，头部微侧，表情自然放松。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-front-stand-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为正面站姿：一只手轻轻叉腰，另一只手自然下垂，微笑看向前方。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-front-stand-4",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为正面站姿：双手插在裤子口袋里，头部微侧看向镜头，表情自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-side-stand-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为侧身45度站立：一只手轻触下巴，另一只手自然垂落，头部微微转向镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-side-stand-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为侧身站立：双手自然下垂，目光看向镜头方向，姿态放松自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-side-stand-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为侧身站立：一只手臂搭在前方栏杆上，另一只手插在口袋里，侧脸看向镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-side-stand-4",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为侧身倚靠站姿：侧身倚靠在门框上，姿态放松，一手自然垂落，目光看向一侧。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-walking-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：正在向前行走，步伐自然，一手微微摆动，姿态生动。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-walking-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：侧身45度方向行走，步伐轻盈，姿态自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-walking-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：在走廊中自然行走，步伐从容，目光看向前方。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-walking-4",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：背对镜头向前行走，微微低头，姿态随性。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-sitting-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为坐姿：坐在椅子上，双腿自然交叠，双手放在腿上，神情从容自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-sitting-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为坐姿：坐在椅子上，一手搭在扶手上，双腿交叠，身体微微侧向一边。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-sitting-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为坐姿：坐在长椅上，姿态放松自然，双手放在膝盖上，微笑看向镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-sitting-4",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为坐姿：坐在台阶边缘，一条腿伸展，一条腿弯曲，姿态轻松。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-crouching-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为蹲姿：一只手撑在膝盖上，眼神专注看向一侧。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-crouching-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为蹲姿：蹲在地面上，一手托腮，姿态放松自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-crouching-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为蹲姿：半蹲姿势，双手自然放在膝盖上，表情自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-back-turn-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为回头：背对镜头回头，一只手轻轻抓住旁边的东西，转头看向镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-back-turn-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为回头：背对镜头，转头微笑看向镜头，姿态自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-back-turn-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为回头：背对镜头，微微侧头看向镜头，表情淡然松弛。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-hands-pocket-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为双手插兜站立：双手插在裤子口袋里，靠在墙上，姿态放松。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-hands-pocket-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为双手插兜站立：一手插在口袋中，另一手自然垂落，头部微微向一侧倾斜。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-hands-pocket-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为双手插兜站立：双手插在口袋里，自然站立，目光看向前方。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-arms-crossed-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抱胸站立：双臂交叉环抱在胸前，头部微微后仰，闭眼享受阳光，神态舒展。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-arms-crossed-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抱胸站立：双臂交叉环抱胸前，身体微微侧向一边，微笑看向镜头。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-arms-crossed-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抱胸站立：双臂交叉环抱胸前，微微侧身，表情自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-touch-face-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抚面：一只手托着脸颊，身体微微前倾，表情自然放松。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-touch-face-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抚面：一只手轻轻抚摸头发，另一只手自然垂落，微笑看向前方。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-touch-face-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抚面：一只手托腮，表情沉思，姿态自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-leg-up-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抬腿：一条腿抬起踩在栏杆或台阶上，姿态轻松自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-leg-up-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抬腿：坐在地上，双腿屈膝脚踩在地面，一只手高举挥动，闭眼微笑。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-leg-up-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为抬腿：一条腿抬起踩在台阶上，姿态活泼。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-cross-step-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为交叉腿站立：双腿交叉站立，一手轻触脖子附近的项链，一手自然放在身侧，头部转向一侧。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-cross-step-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为交叉腿站立：双腿交叉站立，姿态放松自然。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-cross-step-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为交叉腿站立：双腿交叉站立，双手自然下垂，目光看向前方。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-lean-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为倚靠：双手插兜靠在墙上，姿态自然放松。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-lean-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为倚靠：倚靠在墙边，一手插兜，一手自然垂落，姿态随性。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-lean-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为倚靠：倚靠在栏杆上，姿态放松，微微侧身。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-kid-stand-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：侧身45度行走，转头微笑看向镜头，步伐自然生动。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-kid-stand-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为站姿：双手举到脸边做调皮的表情，微笑，姿态活泼可爱。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-kid-stand-3",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为行走：向前行走，步伐自然，姿态可爱活泼。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-kid-action-1",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为动态站姿：双腿分开站立，面带笑意，姿态活泼。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
    {
        "id": "pose-kid-action-2",
        "prompt": "保持图中小朋友的外貌和服装不变。仅改变姿势为动态站姿：一手提起包，一手自然抬起，姿态随性活泼。背景简洁干净，纯色棚拍背景。电商高清质感。",
    },
]


def check_prerequisites():
    """检查前置条件。"""
    if not os.path.exists(BASE_IMAGE):
        print(f"错误: 基底图片不存在: {BASE_IMAGE}")
        print("请先将模特图片下载到该路径")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 测试 API 可达性
    import urllib.request

    try:
        urllib.request.urlopen(
            "http://192.168.0.100:11436/v1/models", timeout=10
        )
    except Exception as e:
        print(f"错误: Raycast 代理不可达: {e}")
        sys.exit(1)


def generate_image(pose, attempt=1):
    """调用 GPT Image 2 生成单张姿势图。"""
    import urllib.request

    output_path = os.path.join(OUTPUT_DIR, f"{pose['id']}.jpg")

    # 构造 multipart form data
    boundary = "----PythonFormBoundary7MA4YWxkTrZu0gW"
    lines = []

    # image file
    with open(BASE_IMAGE, "rb") as f:
        file_data = f.read()

    lines.append(f"--{boundary}".encode())
    lines.append(
        f'Content-Disposition: form-data; name="image"; filename="model.jpg"'.encode()
    )
    lines.append(b"Content-Type: image/jpeg")
    lines.append(b"")
    lines.append(file_data)

    # prompt
    lines.append(f"--{boundary}".encode())
    lines.append(f'Content-Disposition: form-data; name="prompt"'.encode())
    lines.append(b"")
    lines.append(pose["prompt"].encode("utf-8"))

    # model
    lines.append(f"--{boundary}".encode())
    lines.append(f'Content-Disposition: form-data; name="model"'.encode())
    lines.append(b"")
    lines.append(MODEL.encode())

    # n
    lines.append(f"--{boundary}".encode())
    lines.append(f'Content-Disposition: form-data; name="n"'.encode())
    lines.append(b"")
    lines.append(b"1")

    # size
    lines.append(f"--{boundary}".encode())
    lines.append(f'Content-Disposition: form-data; name="size"'.encode())
    lines.append(b"")
    lines.append(IMAGE_SIZE.encode())

    lines.append(f"--{boundary}--".encode())
    lines.append(b"")

    body = b"\r\n".join(lines)

    req = urllib.request.Request(
        API_URL,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - start_time

            if "data" in result and len(result["data"]) > 0:
                item = result["data"][0]
                if "b64_json" in item:
                    img_bytes = base64.b64decode(item["b64_json"])
                    with open(output_path, "wb") as f:
                        f.write(img_bytes)
                    return True, elapsed, len(img_bytes)
                elif "url" in item:
                    # 下载 URL
                    img_resp = urllib.request.urlopen(item["url"], timeout=60)
                    img_bytes = img_resp.read()
                    with open(output_path, "wb") as f:
                        f.write(img_bytes)
                    return True, elapsed, len(img_bytes)

            return False, elapsed, "No image data in response"
    except Exception as e:
        elapsed = time.time() - start_time
        return False, elapsed, str(e)


def compress_image(filepath):
    """使用 sips 压缩图片（macOS 内置工具）。"""
    try:
        import subprocess

        subprocess.run(
            ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80", filepath],
            capture_output=True,
            timeout=30,
        )
    except Exception:
        pass  # 压缩失败不影响主流程


def main():
    parser = argparse.ArgumentParser(description="批量生成姿势参考图")
    parser.add_argument("--start-index", type=int, default=0, help="从第 N 个姿势开始")
    parser.add_argument("--count", type=int, default=0, help="只生成 N 张图（0=全部）")
    parser.add_argument(
        "--skip-existing", action="store_true", help="跳过已存在的图片"
    )
    parser.add_argument("--dry-run", action="store_true", help="只打印计划，不实际生成")
    parser.add_argument("--no-compress", action="store_true", help="不压缩图片")
    args = parser.parse_args()

    poses = POSE_PROMPTS[args.start_index :]
    if args.count > 0:
        poses = poses[: args.count]

    print(f"=== 姿势参考图批量生成 ===")
    print(f"基底图片: {BASE_IMAGE}")
    print(f"输出目录: {OUTPUT_DIR}")
    print(f"待生成: {len(poses)} 张 (从索引 {args.start_index} 开始)")
    print(f"API: {API_URL} ({MODEL})")
    print()

    if args.dry_run:
        for i, pose in enumerate(poses):
            output_path = os.path.join(OUTPUT_DIR, f"{pose['id']}.jpg")
            exists = os.path.exists(output_path)
            print(
                f"  [{args.start_index + i}] {pose['id']}"
                f"{' (已存在)' if exists else ''}"
            )
        return

    check_prerequisites()

    success_count = 0
    fail_count = 0
    skip_count = 0
    total_start = time.time()

    for i, pose in enumerate(poses):
        global_index = args.start_index + i
        output_path = os.path.join(OUTPUT_DIR, f"{pose['id']}.jpg")

        # 跳过已存在
        if args.skip_existing and os.path.exists(output_path):
            existing_size = os.path.getsize(output_path)
            print(
                f"[{global_index + 1}/{len(POSE_PROMPTS)}] ⏭ {pose['id']} "
                f"(已存在, {existing_size // 1024}KB)"
            )
            skip_count += 1
            continue

        print(
            f"[{global_index + 1}/{len(POSE_PROMPTS)}] 🎨 {pose['id']} - {pose['prompt'][:30]}..."
        )

        ok = False
        last_error = None
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            if attempt > 1:
                print(f"  重试 {attempt}/{RETRY_ATTEMPTS}...")
                time.sleep(5)

            success, elapsed, info = generate_image(pose, attempt)
            if success:
                size_kb = info // 1024
                print(f"  ✅ 成功 ({elapsed:.1f}s, {size_kb}KB)")

                if not args.no_compress:
                    compress_image(output_path)
                    compressed_size = os.path.getsize(output_path)
                    print(f"  📦 压缩后 {compressed_size // 1024}KB")

                ok = True
                success_count += 1
                break
            else:
                last_error = info
                print(f"  ❌ 失败 ({elapsed:.1f}s): {str(last_error)[:100]}")

        if not ok:
            fail_count += 1
            print(f"  💀 {pose['id']} 全部重试失败: {last_error}")

        # 简短暂停避免过快
        if i < len(poses) - 1:
            time.sleep(2)

    total_elapsed = time.time() - total_start
    print()
    print(f"=== 生成完成 ===")
    print(f"成功: {success_count} | 失败: {fail_count} | 跳过: {skip_count}")
    print(f"总耗时: {total_elapsed / 60:.1f} 分钟")


if __name__ == "__main__":
    main()
