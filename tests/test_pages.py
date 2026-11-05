"""全站页面冒烟：每个页面、每个视口，都要能开、不溢出、不报错。"""
import pytest

from conftest import BASE, VIEWPORTS

STATIC_PAGES = [
    "/",
    "/c/sakura/",
    "/c/chacha/",
    "/c/hibari/",
    "/shelf/",
    "/play/",
    "/3d/",
    "/404.html",
]


def _overflow(page) -> int:
    """横向溢出像素数。0 表示没有横向滚动条。"""
    return page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )


@pytest.mark.parametrize("path", STATIC_PAGES)
@pytest.mark.parametrize("vp", list(VIEWPORTS))
def test_page_loads(browser, server, path, vp):
    """每个页面在每种视口下：200、无横向溢出、无 JS 错误。"""
    ctx = browser.new_context(viewport=VIEWPORTS[vp], is_mobile=vp != "1440")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.on("console",
            lambda m: errs.append(f"console: {m.text}") if m.type == "error" else None)

    resp = page.goto(BASE + path, wait_until="networkidle")
    page.wait_for_timeout(500)

    assert resp.status == 200, f"{path} 返回 {resp.status}"
    assert _overflow(page) == 0, f"{path} @ {vp}px 横向溢出 {_overflow(page)}px"
    assert not errs, f"{path} @ {vp}px 有报错: {errs}"

    ctx.close()


EXPECTED_NAV = ["图鉴", "地域", "3D 手办台", "收藏册", "小游戏", "关于", "内容政策"]


@pytest.mark.parametrize("path", ["/", "/shelf/", "/play/", "/3d/", "/c/sakura/"])
def test_nav_consistent(server, page, path):
    """所有页面的主导航项数、文字、顺序必须完全一致。

    这条测试是有来历的：四轮迭代里用"插到某个锚点之后"的方式加链接，
    结果三个页面长出了三种顺序（3D 手办台一会儿在中间一会儿在最后）。
    顺序不影响功能，但会让人觉得站点是拼起来的。
    """
    page.goto(BASE + path, wait_until="networkidle")
    links = page.eval_on_selector_all(
        ".nav__links .nav__link", "els => els.map(e => e.textContent.trim())"
    )
    assert links == EXPECTED_NAV, f"{path} 导航不一致: {links}"


@pytest.mark.parametrize("path", ["/", "/3d/", "/shelf/", "/play/"])
def test_theme_toggle(server, page, path):
    """明暗切换要真的改掉 dataset.theme，并且写进 localStorage。"""
    page.goto(BASE + path, wait_until="networkidle")
    before = page.evaluate("() => document.documentElement.dataset.theme")
    assert before in ("light", "dark")

    btn = page.query_selector("#theme-toggle, #theme-btn")
    assert btn, f"{path} 找不到主题按钮"
    btn.click()
    page.wait_for_timeout(150)

    after = page.evaluate("() => document.documentElement.dataset.theme")
    assert after != before, f"{path} 点击后主题没变"
    stored = page.evaluate("() => localStorage.getItem('lol1:theme')")
    assert stored == after, f"{path} 主题没存进 localStorage"


def test_theme_persists_across_pages(server, page):
    """在一页切暗色，去另一页应该还是暗色（读的是同一个键）。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.click("#theme-toggle")
    page.wait_for_timeout(150)
    page.goto(BASE + "/shelf/", wait_until="networkidle")
    assert page.evaluate("() => document.documentElement.dataset.theme") == "dark"
