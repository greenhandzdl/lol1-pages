"""
测试基础设施。

要点：
- 自己起一个静态服务器（不用外部的），测试才能独立跑
- 用固定端口 + 端口探测，避免和开发中的服务器打架
- 浏览器复用（session 级），每个测试独立 context，避免 localStorage 互相污染
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("TEST_PORT", "8899"))
BASE = f"http://127.0.0.1:{PORT}"

# 三个视口：最窄的、主流手机、桌面
VIEWPORTS = {
    "320": {"width": 320, "height": 800},
    "390": {"width": 390, "height": 844},
    "1440": {"width": 1440, "height": 900},
}


def _port_free(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


@pytest.fixture(scope="session")
def server():
    """站点根目录起 http.server，测试结束关掉。"""
    if not _port_free(PORT):
        pytest.exit(f"端口 {PORT} 被占用，换个 TEST_PORT 再跑", returncode=1)

    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # 轮询直到真的能连上，不要盲 sleep
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{BASE}/index.html", timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.exit("静态服务器没起来", returncode=1)

    yield BASE
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch(
            channel="chrome",
            headless=True,
            args=["--use-gl=egl", "--ignore-gpu-blocklist",
                  "--enable-unsafe-swiftshader", "--no-sandbox"],
        )
        yield b
        b.close()


@pytest.fixture
def context(browser):
    """每个测试一个干净 context —— localStorage 不能串。"""
    ctx = browser.new_context(viewport=VIEWPORTS["1440"])
    yield ctx
    ctx.close()


@pytest.fixture
def page(context):
    return context.new_page()


@pytest.fixture(scope="session")
def chars():
    """角色数据，只读一次。"""
    import json
    with open(ROOT / "assets" / "data" / "characters.json", encoding="utf-8") as f:
        return json.load(f)["characters"]


class PageErrors:
    """收集页面上的 JS 报错。

    只收 pageerror 和 console.error —— 前者是真崩了，
    后者是代码自己认定的问题。警告不管（噪音太多）。
    """

    def __init__(self, page):
        self.items = []
        page.on("pageerror", lambda e: self.items.append(f"pageerror: {e}"))
        page.on(
            "console",
            lambda m: self.items.append(f"console: {m.text}") if m.type == "error" else None,
        )


@pytest.fixture
def errors(page):
    return PageErrors(page)
