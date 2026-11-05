"""无障碍的基本底线。

不做完整 WCAG 审计（那要专门的工具和人），只钉住几条
"违反了就一定是 bug"的规则。
"""
import pytest

from conftest import BASE

PAGES = ["/", "/shelf/", "/play/", "/3d/", "/c/sakura/"]


@pytest.mark.parametrize("path", PAGES)
def test_lang_and_title(server, page, path):
    page.goto(BASE + path, wait_until="networkidle")
    assert page.get_attribute("html", "lang") == "zh-CN"
    title = page.title()
    assert title and "萝莉图鉴" in title, f"{path} 标题: {title}"


@pytest.mark.parametrize("path", PAGES)
def test_images_have_alt(server, page, path):
    """所有 img 必须有 alt 属性（可以是空串，用于纯装饰）。"""
    page.goto(BASE + path, wait_until="networkidle")
    page.wait_for_timeout(600)
    missing = page.eval_on_selector_all(
        "img:not([alt])",
        "els => els.map(e => e.getAttribute('src'))",
    )
    assert not missing, f"{path} 有图缺 alt: {missing[:3]}"


@pytest.mark.parametrize("path", PAGES)
def test_buttons_have_accessible_name(server, page, path):
    """按钮必须有可见文字或 aria-label，否则读屏念不出来。"""
    page.goto(BASE + path, wait_until="networkidle")
    page.wait_for_timeout(500)
    nameless = page.evaluate("""() => [...document.querySelectorAll('button')]
        .filter(b => !b.getAttribute('aria-label')
                  && !b.textContent.trim()
                  && !b.querySelector('title'))
        .map(b => b.id || b.className)""")
    assert not nameless, f"{path} 有无名按钮: {nameless[:3]}"


@pytest.mark.parametrize("path", PAGES)
def test_focus_visible(server, page, path):
    """Tab 走一圈，焦点必须落在有 outline 或明显样式的元素上。"""
    page.goto(BASE + path, wait_until="networkidle")
    page.wait_for_timeout(500)
    for _ in range(6):
        page.keyboard.press("Tab")
    info = page.evaluate("""() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName,
          outline: s.outlineWidth,
          shadow: s.boxShadow,
        };
    }""")
    assert info, f"{path} Tab 之后焦点没落在任何元素上"
    # 至少要有一个可见的焦点指示
    has_outline = info["outline"] not in ("0px", "", "none")
    has_shadow = info["shadow"] not in ("none", "")
    assert has_outline or has_shadow, f"{path} 焦点元素无可见指示: {info}"


def test_skip_link(server, page):
    """首页要能直接跳到正文，键盘用户不必走完整个导航。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.keyboard.press("Tab")
    first = page.evaluate(
        "() => document.activeElement?.textContent?.trim() || ''"
    )
    assert "跳" in first, f"第一个可聚焦元素应是跳转链接，实际是: {first}"


@pytest.mark.parametrize("path", PAGES)
def test_theme_button_state(server, page, path):
    """主题按钮要能说出自己当前是按下的还是弹起的。"""
    page.goto(BASE + path, wait_until="networkidle")
    btn = page.query_selector("#theme-toggle, #theme-btn")
    assert btn, f"{path} 没有主题按钮"
    pressed = btn.get_attribute("aria-pressed")
    assert pressed in ("true", "false"), f"{path} aria-pressed={pressed}"
    btn.click()
    page.wait_for_timeout(200)
    assert btn.get_attribute("aria-pressed") != pressed, f"{path} 点击后 aria-pressed 没变"


@pytest.mark.parametrize("path", ["/play/", "/shelf/"])
def test_live_region(server, page, path):
    """动态内容区应声明 aria-live，否则读屏用户不知道内容变了。"""
    page.goto(BASE + path, wait_until="networkidle")
    live = page.eval_on_selector_all("[aria-live]", "els => els.length")
    assert live > 0, f"{path} 没有 aria-live 区域"
