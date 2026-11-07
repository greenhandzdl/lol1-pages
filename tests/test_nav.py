"""导航栏要能看出「你在哪」，也要分得清层次。

导航原先 7 项平铺：图鉴 / 地域 / 3D 手办台 / 收藏册 / 小游戏 / 关于 / 内容政策。
其中 4 项只是首页里的某一段，和另外 3 个独立页面同级、同字号、同颜色 ——
层次是平的，所以读起来模糊。

现在主导航只放 4 个「真正能独立打开的页面」；地域 / 关于 / 内容政策
的入口移到页脚。当前位置用「下划线 + 加粗 + 变色」标出。
"""
import pytest

from conftest import BASE

PAGE_TABS = {
    "/": "图鉴",
    "/3d/": "3D 手办台",
    "/shelf/": "收藏册",
    "/play/": "小游戏",
}


def _current(page):
    """当前被标为 aria-current 的导航项文字。"""
    return [
        a.inner_text().strip()
        for a in page.locator(".nav__link[aria-current]").all()
    ]


@pytest.mark.parametrize("path,label", list(PAGE_TABS.items()))
def test_current_page_is_visibly_marked(server, page, path, label):
    """当前那一项要有可见变化 —— 不只是属性写对了。

    只查 aria-current 不够：属性一直都在，但没有样式时页面上毫无区别，
    这正是原来的状态。

    现在用的是「加粗 + 变色 + 下划线」这一套（不用底色块：底色和 hover
    撞形状，hover 是"你手正指着它"，current 是"你在这儿"）。
    所以这里查的也必须是这三样，而不是底色。
    """
    page.goto(f"{BASE}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)

    assert _current(page) == [label], f"{path} 应该只标出「{label}」"

    active = page.locator(".nav__link[aria-current]").first
    idle = page.locator(".nav__link:not([aria-current])").first

    a_w = active.evaluate("e => getComputedStyle(e).fontWeight")
    i_w = idle.evaluate("e => getComputedStyle(e).fontWeight")
    assert int(a_w) > int(i_w), f"当前项没有加粗（{a_w} vs {i_w}）"

    a_c = active.evaluate("e => getComputedStyle(e).color")
    i_c = idle.evaluate("e => getComputedStyle(e).color")
    assert a_c != i_c, f"当前项和普通项同色（{a_c}）"

    # 下划线：::after 要真的有宽度、有背景色
    mark = active.evaluate(
        """e => {
            const cs = getComputedStyle(e, '::after');
            return { content: cs.content, bg: cs.backgroundColor, h: cs.height };
        }"""
    )
    assert mark["content"] not in ("none", "normal", ""), "当前项没有下划线"
    assert mark["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"), f"下划线没有颜色：{mark}"


def test_char_page_marks_nothing_as_current_page(server, page):
    """角色页不属于导航里的任何一项，不该乱标。

    硬把「图鉴」标成当前页会误导 —— 导航里那一条指向的是首页的图鉴区，
    点它会离开这一页。
    """
    page.goto(f"{BASE}/c/sakura/", wait_until="networkidle")
    page.wait_for_timeout(400)
    assert _current(page) == []


def test_nav_only_lists_real_pages(server, page):
    """主导航只放「真正的页面」，不放首页里的某一段。

    原先 7 项平铺：图鉴 / 地域 / 3D 手办台 / 收藏册 / 小游戏 / 关于 / 内容政策。
    其中 4 项只是首页里的某一段，和另外 3 个页面同级、同字号、同颜色 ——
    层次是平的，所以"模糊"。现在只留 4 个真的能独立打开的页面。

    这条同时守住两件事：不能退回 7 项，也不能把某个页面漏掉。
    """
    expected = ["图鉴", "3D 手办台", "收藏册", "小游戏"]
    paths = ["/", "/3d/", "/shelf/", "/play/", "/c/sakura/"]
    wrong = []
    for path in paths:
        page.goto(f"{BASE}{path}", wait_until="networkidle")
        page.wait_for_timeout(300)
        got = [a.inner_text().strip() for a in page.locator(".nav__link").all()]
        if got != expected:
            wrong.append(f"{path} 导航是 {got}，应为 {expected}")
    assert not wrong, "\n  ".join(wrong)


def test_nav_targets_are_all_real_destinations(server, page):
    """导航里的每一项都要指向能独立打开的地址，不能是纯锚点。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(300)
    anchors = [
        a.get_attribute("href")
        for a in page.locator(".nav__link").all()
        if a.get_attribute("href").startswith("#")
    ]
    # 唯一允许的例外：#gallery 是首页图鉴区，它就是"图鉴"这一项的落点
    assert anchors in ([], ["#gallery"]), f"导航里还有纯页内锚点：{anchors}"


def test_footer_carries_the_sections_dropped_from_nav(server, page):
    """从导航里拿掉的段，页脚必须有入口 —— 否则等于删掉了入口。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(300)
    footer = page.locator("footer").first.inner_html()
    for anchor in ("#regions", "#about", "#policy"):
        assert anchor in footer, f"页脚里没有 {anchor} 的入口"


@pytest.mark.parametrize("path,label", list(PAGE_TABS.items()))
def test_current_page_marker_is_readable(server, page, path, label):
    """当前页的下划线标记，字也要够清楚。

    下划线本身是装饰，不算对比度对象；这里的字色是正文级小字，
    必须过 4.5:1。
    """
    import test_contrast as tc

    page.goto(f"{BASE}{path}", wait_until="networkidle")
    page.wait_for_timeout(500)
    el = page.locator(".nav__link[aria-current]").first
    ratio, fg, bg = tc._measure(page, el)
    assert ratio >= tc.AA_NORMAL, f"{path} 当前页标记只有 {ratio:.2f}:1（字 {fg} 底 {bg}）"


def test_only_one_item_is_marked_current(server, page):
    """任何一页都只能有一个"当前"，两个会让人不知道自己在哪。"""
    for path in ["/", "/3d/", "/shelf/", "/play/", "/c/sakura/", "/404.html"]:
        page.goto(f"{BASE}{path}", wait_until="networkidle")
        page.wait_for_timeout(250)
        n = page.locator(".nav__link[aria-current]").count()
        if path == "/c/sakura/" or path == "/404.html":
            assert n == 0, f"{path} 不该有当前页标记（它不属于导航里任何一项）"
        else:
            assert n == 1, f"{path} 有 {n} 个当前页标记"
