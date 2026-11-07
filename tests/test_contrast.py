"""
对比度：小字必须读得出来。

为什么单独一个文件
------------------
这套站点的文字色几乎全是算出来的（每个角色一套 --pa / --pa-ink / --pa-glow），
而不是写死的。算出来的颜色有个特点：换个背景、加一个 opacity、调一下阈值，
对比度就会掉到看不见 —— 而截图里它只是"浅了一点"，评审看不出来。

已经踩过两次：
  · .region__who 加了 opacity: 0.82，12 张卡片全部掉到 2.96–3.63:1
  · --pa-ink 的 alsoOn 门槛是 3.4（"大字"标准），却被 11px 的小字用着

测法：像素采样，不用 getComputedStyle
-------------------------------------
getComputedStyle 读到 linear-gradient 背景会返回 transparent，于是往上找到
白色 body，得出一个乐观得离谱的比值（实测把 2.96 读成 11:1）。
所以这里直接截元素那一块，取最暗和最亮的像素 —— 文字是深色压在浅底上，
这两个像素就分别是字色和底色，天然把渐变、半透明、叠层全算对了。
"""
import io

import pytest
from PIL import Image

from conftest import BASE

AA_NORMAL = 4.5  # WCAG AA，正文/小字


def _luminance(px):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(px[0]) + 0.7152 * f(px[1]) + 0.0722 * f(px[2])


def _ratio(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _measure(page, locator):
    """截元素 → 最暗像素当字色、最亮像素当底色 → 比值。"""
    locator.scroll_into_view_if_needed()
    page.wait_for_timeout(120)
    box = locator.bounding_box()
    assert box and box["width"] > 0 and box["height"] > 0, "元素没有尺寸，量不到"
    im = Image.open(io.BytesIO(page.screenshot(clip=box))).convert("RGB")
    # 用 tobytes 而不是 getdata：Pillow 14 要删掉 getdata，而 tobytes 一直有
    raw = im.tobytes()
    px = [raw[i:i + 3] for i in range(0, len(raw), 3)]
    darkest = min(px, key=_luminance)
    lightest = max(px, key=_luminance)
    return _ratio(darkest, lightest), darkest, lightest


def _open_dialog(page):
    page.locator(".card__body").first.click()
    page.wait_for_selector("#detail-traits .traits__row")
    page.wait_for_timeout(300)


# ---------------------------------------------------------------- 地域卡

def test_region_card_text_is_readable(server, page):
    """12 张地域卡：地名、人名、元素标签都要过 AA。

    这条是回归测试 —— 人名曾经因为 opacity: 0.82 掉到 2.96:1。
    """
    failures = []
    for theme in ("light", "dark"):
        page.goto(f"{BASE}/?theme={theme}", wait_until="networkidle")
        page.wait_for_timeout(600)
        for sel, label in (
            (".region__name", "地名"),
            (".region__who", "人名"),
            (".region__el", "元素"),
        ):
            els = page.locator(sel)
            for i in range(els.count()):
                el = els.nth(i)
                who = el.locator("xpath=..").locator(".region__name").first.inner_text()
                ratio, dark, light = _measure(page, el)
                if ratio < AA_NORMAL:
                    failures.append(f"{theme} {who} 的{label} {ratio:.2f}:1 (字{dark} 底{light})")
    assert not failures, "对比度低于 4.5:1：\n  " + "\n  ".join(failures)


# ---------------------------------------------------------------- 弹窗

def test_dialog_traits_are_readable(server, page):
    """弹窗里的六维性格：维度名和条必须分得开。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    _open_dialog(page)
    ratio, dark, light = _measure(page, page.locator(".traits__name").first)
    assert ratio >= AA_NORMAL, f"弹窗性格维度名 {ratio:.2f}:1 (字{dark} 底{light})"


def test_dialog_inherits_character_accent(server, page):
    """弹窗里的性格条要跟着角色换色，不能永远是默认粉。

    第四轮承诺「12 个人有 12 种颜色」，但 #detail 一直没带 accent 变量，
    里面所有 --pa 都是空的，六根条恒定粉色。
    """
    page.goto(f"{BASE}/", wait_until="networkidle")
    fills = set()
    for i in (0, 2, 5):
        page.locator(".card__body").nth(i).click()
        page.wait_for_selector("#detail-traits .traits__row")
        page.wait_for_timeout(250)
        fills.add(
            page.evaluate(
                "() => getComputedStyle(document.querySelector('#detail-traits .traits__bar > i'))"
                ".backgroundImage"
            )
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    assert len(fills) == 3, f"三个角色的性格条颜色没有区分开：{fills}"
    assert not any("--pa" in f for f in fills)


# ---------------------------------------------------------------- 关系与故事

def test_relation_and_story_text_is_readable(server, page):
    """首页关系网的故事面板：人名、正文、关系标签。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.click(".webStory > summary")
    page.wait_for_timeout(300)
    failures = []
    for sel, label in (
        (".webStory__pair a", "人名"),
        (".webStory__pair span", "关系标签"),
        (".webStory__list p", "正文"),
    ):
        el = page.locator(sel).first
        if not el.count():
            continue
        ratio, dark, light = _measure(page, el)
        if ratio < AA_NORMAL:
            failures.append(f"{label} {ratio:.2f}:1 (字{dark} 底{light})")
    assert not failures, "对比度低于 4.5:1：\n  " + "\n  ".join(failures)


# ---------------------------------------------------------------- 小游戏

def test_quiz_comparison_is_readable_and_unclipped(server, page):
    """测完 7 题后的对照条：要读得出，也不能被下面的按钮压住。

    .traitCmp 的内容底边正好落在卡片内容区底边上，最后一行「好奇」
    视觉上像被三个按钮裁掉了 —— 实测底边到按钮顶是 0px。
    """
    page.set_viewport_size({"width": 900, "height": 1400})
    page.goto(f"{BASE}/play/", wait_until="networkidle")
    page.click("#quiz-start")
    for _ in range(7):
        page.locator("#play-body .quiz__opt").first.click()
        page.wait_for_timeout(150)
    page.wait_for_timeout(500)

    assert page.locator(".traitCmp").count(), "没出对照条"

    gap = page.evaluate(
        """() => {
            const cmp = document.querySelector('.traitCmp').getBoundingClientRect();
            const acts = document.querySelector('.quiz__acts').getBoundingClientRect();
            return Math.round(acts.top - cmp.bottom);
        }"""
    )
    assert gap >= 10, f"对照条底边距按钮只有 {gap}px，最后一行会被视觉裁掉"

    ratio, dark, light = _measure(page, page.locator(".traitCmp__name").first)
    assert ratio >= AA_NORMAL, f"对照条维度名 {ratio:.2f}:1 (字{dark} 底{light})"
