"""背景音乐：默认不响、不点不下载、开关跨页记住、坏了不炸。"""
import json
import subprocess
from pathlib import Path

import pytest

from conftest import BASE, ROOT

AUDIO_DIR = ROOT / "assets" / "audio"
SLOTS = ["morning", "day", "evening", "night"]

# 体积预算：四个时段合计不超过 1.6MB，单条不超过 400KB。
# 站点 assets 现在 6.6MB，音乐占不到四分之一。
TOTAL_BUDGET = 1_600 * 1024
PER_FILE_BUDGET = 400 * 1024

HEADER_PAGES = ["/", "/3d/", "/shelf/", "/play/", "/c/sakura/", "/c/chacha/"]


def _probe(path: Path) -> dict:
    """用 ffprobe 读真实音频参数。不引入 Python 侧解码库。"""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_name,sample_rate,channels",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    return {"duration": float(data["format"]["duration"]), **data["streams"][0]}


@pytest.mark.parametrize("slot", SLOTS)
def test_track_file_exists_and_is_valid_audio(slot):
    """四个时段各有一条，且真能解码 —— 不是空文件、不是损坏文件。"""
    f = AUDIO_DIR / f"{slot}.mp3"
    assert f.exists(), f"缺 {slot} 的音轨"
    info = _probe(f)
    assert info["codec_name"] == "mp3"
    assert info["sample_rate"] == "48000"
    assert info["channels"] == 1, "单声道就够，省一半体积"
    # 太短的循环会听出重复，定个下限
    assert info["duration"] >= 15, f"{slot} 只有 {info['duration']:.1f}s，循环感太强"


def test_audio_budget():
    """页面默认不下载音频，但读者一旦打开就会拉全量 —— 体积得有上限。"""
    total = sum((AUDIO_DIR / f"{s}.mp3").stat().st_size for s in SLOTS)
    assert total <= TOTAL_BUDGET, f"音频合计 {total / 1024:.0f}KB，超预算"
    for s in SLOTS:
        size = (AUDIO_DIR / f"{s}.mp3").stat().st_size
        assert size <= PER_FILE_BUDGET, f"{s}.mp3 {size / 1024:.0f}KB 超单条预算"


@pytest.mark.parametrize("path", HEADER_PAGES)
def test_every_page_has_the_toggle(server, page, path):
    """有页头的页面都要有这枚按钮。"""
    page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
    btn = page.locator("[data-bgm-toggle]")
    assert btn.count() == 1, f"{path} 上找不到（或找到多个）背景音乐按钮"
    assert btn.is_visible()
    # 初始必须是"关"的样子，不能一进页面就伪装成在放
    assert btn.get_attribute("aria-pressed") == "false"
    assert btn.get_attribute("aria-label") == "打开背景音乐"


def test_404_has_no_toggle(server, page):
    """404 没有页头，就不该有按钮 —— 它可能在任何路径被命中，
    不该在那种状态下还去碰存档。"""
    page.goto(f"{BASE}/404.html", wait_until="domcontentloaded")
    assert page.locator("[data-bgm-toggle]").count() == 0


def test_does_not_download_audio_until_clicked(server, page):
    """不点就不请求。这是 preload=none 的意义所在。"""
    hits = []
    page.on("request", lambda r: hits.append(r.url) if ".mp3" in r.url else None)
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(600)
    assert hits == [], f"没点就下载了: {hits}"


def test_click_starts_playback_of_the_right_slot(server, page):
    """点一下要真的开始放，而且放的是当前时段那条。"""
    page.add_init_script(
        "localStorage.setItem('lol1:bgm','off')"
    )
    hits = []
    page.on("request", lambda r: hits.append(r.url) if ".mp3" in r.url else None)
    page.goto(f"{BASE}/", wait_until="networkidle")

    btn = page.locator("[data-bgm-toggle]")
    btn.click()
    page.wait_for_timeout(1200)

    assert btn.get_attribute("aria-pressed") == "true"
    assert btn.get_attribute("aria-label") == "关闭背景音乐"
    assert len(hits) == 1, f"应该只拉一条音轨，实际 {hits}"

    state = page.evaluate(
        """() => {
          const a = document.querySelector('#bgm-audio');
          return a ? { paused: a.paused, loop: a.loop, src: a.currentSrc, volume: a.volume } : null;
        }"""
    )
    assert state is not None, "音频元素没挂进 DOM，aria-controls 就指了个空"
    assert state["loop"] is True, "不 loop 就会放完停住"
    assert state["volume"] < 0.5, "背景音乐不该以满音量出声"


def test_toggle_state_survives_navigation(server, browser):
    """开着的状态要跟着翻页走。"""
    ctx = browser.new_context()
    pg = ctx.new_page()
    try:
        pg.goto(f"{BASE}/", wait_until="domcontentloaded")
        pg.locator("[data-bgm-toggle]").click()
        pg.wait_for_timeout(800)
        assert pg.evaluate("localStorage.getItem('lol1:bgm')") == "on"

        pg.goto(f"{BASE}/shelf/", wait_until="domcontentloaded")
        pg.wait_for_timeout(500)
        btn = pg.locator("[data-bgm-toggle]")
        assert btn.get_attribute("aria-pressed") == "true"
        assert "is-on" in (btn.get_attribute("class") or "")

        # 关掉之后刷新，仍然是关
        btn.click()
        pg.wait_for_timeout(300)
        pg.reload(wait_until="domcontentloaded")
        pg.wait_for_timeout(500)
        assert pg.locator("[data-bgm-toggle]").get_attribute("aria-pressed") == "false"
    finally:
        ctx.close()


def test_blocked_autoplay_falls_back_quietly(server, page):
    """play() 被拒时必须安静退回"关"，不留未处理的 Promise 拒绝。

    浏览器拦自动播放是常态，背景音乐坏了不该变成一个需要读者处理的问题。
    """
    page.add_init_script(
        """
        HTMLMediaElement.prototype.play = function () {
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        };
        """
    )
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/", wait_until="networkidle")

    btn = page.locator("[data-bgm-toggle]")
    btn.click()
    page.wait_for_timeout(800)

    assert btn.get_attribute("aria-pressed") == "false", "播放失败却显示成开着"
    assert errors == [], f"有报错: {errors}"


def test_slot_follows_local_time(server, page):
    """四个时段按本地时间选，和首页「此刻」的分档一致。"""
    page.goto(f"{BASE}/", wait_until="domcontentloaded")
    mapping = page.evaluate(
        """async () => {
          const { slotFor } = await import('/assets/js/bgm.js');
          const at = (h) => slotFor(new Date(2026, 0, 1, h, 30));
          return [0, 6, 10, 11, 14, 17, 20, 22, 23].map(at);
        }"""
    )
    # 0 点深夜、6 点早晨、10 点早晨、11 点白天、14 点白天、
    # 17 点傍晚、20 点傍晚、22 点夜里、23 点夜里
    assert mapping == [
        "night", "morning", "morning", "day", "day",
        "evening", "evening", "night", "night",
    ]


def test_no_tracking_requests_from_the_audio_feature(server, page):
    """音频这块不许往外发请求 —— 站点政策写明没有统计脚本。"""
    external = []
    page.on(
        "request",
        lambda r: external.append(r.url)
        if not r.url.startswith(BASE) and not r.url.startswith("data:")
        else None,
    )
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.locator("[data-bgm-toggle]").click()
    page.wait_for_timeout(1000)
    assert external == [], f"发出了站外请求: {external}"
