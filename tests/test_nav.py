"""导航栏要能看出「你在哪」。

导航里混着两种东西：本页的几段（#gallery/#regions/#about/#policy）和
另外三个页面（3d/ shelf/ play/）。以前两者长得一模一样，当前所在的位置
也完全没有标记 —— aria-current="page" 写进了 HTML，但没有一条 CSS 用到它。
"""
import pytest

from conftest import BASE

PAGE_TABS = {"/3d/": "3D 手办台", "/shelf/": "收藏册", "/play/": "小游戏"}


def _current(page):
    """当前被标为 aria-current 的导航项文字。"""
    return [
        a.inner_text().strip()
        for a in page.locator(".nav__link[aria-current]").all()
    ]


@pytest.mark.parametrize("path,label", list(PAGE_TABS.items()))
def test_current_page_is_visibly_marked(server, page, path, label):
    """独立页面上，当前那一项要有可见变化 —— 不只是属性写对了。

    只查 aria-current 不够：属性一直都在，但没有样式时页面上毫无区别，
    这正是原来的状态。
    """
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)

    assert _current(page) == [label], f"{path} 应该只标出「{label}」"

    active = page.locator(f".nav__link[aria-current='page']").first
    idle = page.locator(".nav__link:not([aria-current])").first

    a_bg = active.evaluate("e => getComputedStyle(e).backgroundColor")
    i_bg = idle.evaluate("e => getComputedStyle(e).backgroundColor")
    assert a_bg != i_bg, f"当前项的底色和普通项一样（{a_bg}），看不出区别"

    a_w = active.evaluate("e => getComputedStyle(e).fontWeight")
    i_w = idle.evaluate("e => getComputedStyle(e).fontWeight")
    assert int(a_w) > int(i_w), f"当前项没有加粗（{a_w} vs {i_w}）"


def test_char_page_marks_nothing_as_current_page(server, page):
    """角色页不属于导航里的任何一项，不该乱标。

    硬把「图鉴」标成当前页会误导 —— 导航里那一条指向的是首页的图鉴区，
    点它会离开这一页。
    """
    page.goto(f"{BASE}/c/sakura/", wait_until="networkidle")
    page.wait_for_timeout(400)
    assert _current(page) == []


def test_scroll_spy_tracks_homepage_sections(server, page):
    """滚到首页的某一段，导航栏要跟上。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(900)

    def jump(sel):
        page.evaluate(
            """(s) => {
                const el = document.querySelector(s);
                const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
                window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - pad, behavior: 'instant' });
            }""",
            sel,
        )
        page.wait_for_timeout(250)
        return _current(page)

    expected = {
        "#gallery": "图鉴",
        "#regions": "地域",
        "#about": "关于",
        "#policy": "内容政策",
    }
    wrong = []
    for sel, label in expected.items():
        got = jump(sel)
        if got != [label]:
            wrong.append(f"滚到 {sel} 时标的是 {got}，应为「{label}」")
    assert not wrong, "\n  ".join(wrong)


def test_scroll_spy_marks_nothing_in_hero(server, page):
    """页面最顶上（hero 区）不属于任何一段，不要硬标一个。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(900)
    page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_timeout(300)
    assert _current(page) == [], "首页顶部不该出现「当前段」标记"


def test_scroll_spy_reaches_last_section_at_bottom(server, page):
    """滚到最底下要能选中最后一段。

    最后一段如果比视口矮，判定线永远进不去，「内容政策」就永远点不亮。
    """
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(900)
    page.evaluate("window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })")
    page.wait_for_timeout(300)
    assert _current(page) == ["内容政策"]


def test_in_page_anchors_are_distinguishable_from_page_links(server, page):
    """页内锚点和「另一个页面」要在结构上分得开。

    两者外观一样、行为完全不同：点前者留在本页，点后者换页。
    至少要让代码（和以后的样式）能分开它们。
    """
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(600)
    same = page.locator(".nav__link--samepage").all()
    assert len(same) == 4, f"首页应有 4 个页内锚点，实际 {len(same)}"
    for a in same:
        assert a.get_attribute("href").startswith("#"), "标成 samepage 的应该指向本页锚点"

    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(600)
    # 别的页面上的导航指向首页的锚点，不该被标成本页段
    assert page.locator(".nav__link--samepage").count() == 0


@pytest.mark.parametrize("path,label", list(PAGE_TABS.items()))
def test_current_page_marker_is_readable(server, page, path, label):
    """当前页胶囊上的字也要够清楚。

    13px 小字压在 --pink-soft 上，最初用 --pink-2 只有 4.55:1 ——
    刚过线，换一档配色就掉下去。这条把下限钉住。
    """
    from PIL import Image
    import io

    import test_contrast as tc

    page.goto(f"{BASE}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)
    el = page.locator(".nav__link[aria-current='page']").first
    ratio, fg, bg = tc._measure(page, el)
    assert ratio >= tc.AA_NORMAL, f"{path} 当前页标记只有 {ratio:.2f}:1（字 {fg} 底 {bg}）"
