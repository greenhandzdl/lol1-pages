# build-model-thumbs.py - 给 12 个 3D 模型各渲染一张缩略图
#
# 为什么要图：12 个 .glb 合计 3.6MB，读者现在只有点进 /3d/ 才知道模型长什么样。
# 卡片上一个 120px 的小图能先告诉人「这个人的手办是真的」，再决定要不要
# 下载模型、初始化 WebGL。
#
# 为什么产物进仓库而不是运行时生成：
# 运行时截图意味着每个访客都要先加载 three.js + glb 才能看到小图 --
# 为了省 100KB 的 PNG 花掉 3.6MB 的模型，本末倒置。
# 所以脚本只在改了模型之后手动跑一次，不进 CI。
#
# 用法（和测试用同一个 venv，不需要额外装东西）：
#   TEST_VENV=/tmp/pwenv ./scripts/build-model-thumbs.py
#   TEST_VENV=/tmp/pwenv ./scripts/build-model-thumbs.py sakura mint
#   HEADED=1 TEST_VENV=/tmp/pwenv ./scripts/build-model-thumbs.py
import http.server
import io
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img" / "models"
PORT = 8791
SIZE = 420  # 渲染尺寸。显示只有 128px，留 3 倍给高分屏

only = [a for a in sys.argv[1:] if not a.startswith("-")]


def serve():
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(  # noqa: E731
        *a, directory=str(ROOT), **kw
    )
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright

    chars = json.loads((ROOT / "assets/data/characters.json").read_text("utf-8"))["characters"]
    targets = [c for c in chars if c.get("model") and (not only or c["id"] in only)]
    if not targets:
        print("没有匹配的角色。可用：" + " ".join(c["id"] for c in chars))
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    httpd = serve()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                channel="chrome",
                headless=not os.environ.get("HEADED"),
                # 服务器上没有 GPU，走软件渲染。模型是低多边形，够用
                args=["--use-gl=angle", "--use-angle=swiftshader", "--no-sandbox"],
            )
            for c in targets:
                # device_scale_factor=2 出来的 PNG 一张 1.3MB，
                # 缩略图显示只有 128px，用不着。这里渲染 2 倍再交给 PIL 缩到 SIZE。
                page = browser.new_page(
                    viewport={"width": 760, "height": 760}, device_scale_factor=2
                )
                page.goto(
                    f"http://127.0.0.1:{PORT}/3d/?id={c['id']}", wait_until="networkidle"
                )
                # 等 viewer 真的把模型挂上去，而不是等一个固定秒数
                try:
                    page.wait_for_function(
                        "() => document.querySelector('.stage')?.dataset.state === 'ready'",
                        timeout=20000,
                    )
                except Exception:
                    print(f"  ⚠ {c['id']} 加载超时，仍然截图")

                # 关掉所有 UI：缩略图里只要模型本身
                page.add_style_tag(
                    content="""
                    .stage__panel, .stage__nav, #loading, .site-header,
                    .stage__hint, .stage__hud, .stage__error { display: none !important; }
                    .stage__viewport {
                      background: transparent !important;
                      box-shadow: none !important;
                      border: 0 !important;
                      border-radius: 0 !important;
                    }
                    html, body { background: transparent !important; }
                """
                )
                page.wait_for_timeout(700)

                # 画布是长方形的，取中间的正方形 -- 模型本来就居中
                box = page.locator("#viewport").bounding_box()
                side = min(box["width"], box["height"])
                clip = {
                    "x": box["x"] + (box["width"] - side) / 2,
                    "y": box["y"] + (box["height"] - side) / 2,
                    "width": side,
                    "height": side,
                }
                raw = page.screenshot(clip=clip, omit_background=True)
                # 缩小 + 转真彩 PNG：截出来是 2 倍尺寸的 RGBA，
                # 直接存一张 ~1.3MB，缩到 SIZE 后约 30KB
                img = Image.open(io.BytesIO(raw)).convert("RGBA")
                img = img.resize((SIZE, SIZE), Image.LANCZOS)
                # 模型是单色的低多边形，256 色调色板完全够用；
                # RGBA 直存约 400KB/张，量化后约 40KB
                img = img.quantize(colors=256, method=Image.FASTOCTREE)
                img.save(OUT / f"{c['id']}.png", optimize=True)
                page.close()
                print(f"  {c['id']}.png")
            browser.close()
    finally:
        httpd.shutdown()

    files = sorted(OUT.glob("*.png"))
    total = sum(f.stat().st_size for f in files)
    print(f"\n{len(files)} 张，合计 {round(total / 1024)}KB")
    if total > 400 * 1024:
        print("⚠ 合计超过 400KB，考虑把 SIZE 调小")
    return 0


if __name__ == "__main__":
    sys.exit(main())
