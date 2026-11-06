"""全站页面冒烟：每个页面、每个视口，都要能开、不溢出、不报错。"""
import re

import pytest

from conftest import BASE, ROOT as ROOT_FOR_TESTS, VIEWPORTS

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


# ---------- 主题筛选 / 关系网气泡 / noscript 兜底 ----------

THEME_COUNTS = {
    "花与四季": 4,
    "星光与咒语": 3,
    "茶与甜点": 3,
    "书页与静默": 4,
    "海风与高处": 3,
    "街角的熟客": 4,
    "认真做一件小事": 6,
}


def test_theme_chips_filter(server, page):
    """点主题芯片，剩下来的卡片数要正好等于那个主题的人数。

    这条挡的是"筛选看起来能用、实际筛不出东西"——上一版 tags 就是这个毛病，
    点完只剩一张卡，用户以为坏了。
    """
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#grid .card")
    assert len(page.query_selector_all("#grid .card")) == 12

    for theme, n in THEME_COUNTS.items():
        chip = page.query_selector(f'#chips .chip[data-theme="{theme}"]')
        assert chip, f"没有「{theme}」的芯片"
        chip.click()
        page.wait_for_timeout(120)
        cards = page.query_selector_all("#grid .card")
        assert len(cards) == n, f"「{theme}」筛出 {len(cards)} 张，应 {n} 张"
        # 芯片上写的人数也要对
        label = chip.inner_text()
        assert str(n) in label, f"「{theme}」芯片上没写对人数: {label}"


def test_card_theme_chip_filters(server, page):
    """卡片上的主题标签也能点，点了同样筛选，且不会顺带打开档案弹窗。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#grid .card")
    first = page.query_selector("#grid .card")
    chip = first.query_selector(".card__themes .chip")
    assert chip, "卡片上没有主题芯片"
    theme = chip.inner_text().strip()
    page.evaluate(
        "el => el.dispatchEvent(new MouseEvent('click', {bubbles: true}))", chip
    )
    page.wait_for_timeout(150)
    assert not page.evaluate("() => document.querySelector('#detail').open"), "点主题标签却打开了弹窗"
    assert len(page.query_selector_all("#grid .card")) == THEME_COUNTS[theme]


def test_legacy_tag_link(server, page):
    """老分享链接 ?tag=书 仍然要能筛到人。

    主题上线时把 ?tag= 的语义从"标签"换成了"主题"，历史链接不能变成空白。
    """
    page.goto(BASE + "/?tag=书", wait_until="networkidle")
    page.wait_for_selector("#grid .card")
    ids = page.eval_on_selector_all("#grid .card", "els => els.map(e => e.dataset.id)")
    assert ids == ["shiori"], f"?tag=书 筛出 {ids}"


def test_detail_relations(server, page):
    """详情弹窗要能列出关系，并且点关系能当场翻到那个人。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#grid .card")
    page.click("#grid .card:first-child .card__body")
    page.wait_for_timeout(200)

    rels = page.query_selector_all("#detail-rels .drel__item")
    assert len(rels) == 4, f"樱井小春应有 4 段关系，实际 {len(rels)}"
    assert "她和谁有关" in page.inner_text("#detail-rels")

    page.query_selector("#detail-rels .drel__item").click()
    page.wait_for_timeout(200)
    name = page.inner_text("#detail-name")
    assert name == "薄荷", f"点第一条关系应翻到薄荷，实际 {name}"
    assert page.evaluate("() => document.querySelector('#detail').open"), "翻档案时弹窗被关掉了"


def test_web_popover(server, page):
    """关系网节点点一下出气泡，再点一下收起。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#web-graph .web__node")
    node = page.query_selector('#web-graph .web__node[data-id="sakura"]')
    page.evaluate(
        "el => el.dispatchEvent(new MouseEvent('click', {bubbles: true}))", node
    )
    page.wait_for_timeout(150)

    pop = page.query_selector("#web-pop")
    assert pop and pop.is_visible(), "点节点没出气泡"
    text = pop.inner_text()
    assert "樱井小春" in text
    assert text.count("邻居") + text.count("同好") + text.count("旧识") >= 4
    assert node.get_attribute("aria-expanded") == "true"
    # 气泡里必须有去她档案页的路，否则跳转入口被吞掉了
    hrefs = [a.get_attribute("href") for a in pop.query_selector_all("a")]
    assert "/c/sakura/" in hrefs, f"气泡里没有档案页链接: {hrefs}"

    page.evaluate(
        "el => el.dispatchEvent(new MouseEvent('click', {bubbles: true}))", node
    )
    page.wait_for_timeout(150)
    assert not page.query_selector("#web-pop").is_visible(), "再点一次应该收起"
    assert node.get_attribute("aria-expanded") == "false"


def test_noscript_fallback():
    """index.html 静态源里要有 12 条角色的兜底链接。

    关 JS 的访客和一部分爬虫看到的就是这段。c/<id>/ 之所以存在就是为了
    "不执行 JS 也能读"，首页不该反过来是个空壳。
    """
    html = (ROOT_FOR_TESTS / "index.html").read_text(encoding="utf-8")
    ns = html[html.index('<noscript data-build="gallery">'):]
    ns = ns[:ns.index("</noscript>")]
    # 主题列表里也有角色链接，卡片区单独数
    cards = ns[ns.index('<ul class="ns__cards">'):]
    ids = set(re.findall(r'href="c/([\w-]+)/"', cards))
    assert len(ids) == 12, f"兜底卡片区只有 {len(ids)} 个角色"
    for theme in THEME_COUNTS:
        assert theme in ns, f"兜底里没有主题「{theme}」"
    # 地域与关系网两块的兜底
    regions = html[html.index('<noscript data-build="regions">'):]
    regions = regions[:regions.index("</noscript>")]
    assert regions.count('href="c/') == 12, "地域兜底链接数不对"
    web = html[html.index('<noscript data-build="web">'):]
    web = web[:web.index("</noscript>")]
    # 38 条有向关系（19 对），每条一行；少一条就说明数据或模板掉了
    n = web.count("—")
    assert n == 38, f"关系网兜底写了 {n} 条关系，应为 38 条有向关系"


def test_character_page_has_story_and_day(server, page):
    """角色页要真的把 story / day 渲染出来，而且不依赖 JS。

    这两块是构建期写进 HTML 的（`build-pages.mjs`），所以直接读源码断言，
    比开浏览器点开看更贴近"爬虫能不能读到"这个问题。
    """
    html = (ROOT_FOR_TESTS / "c" / "sakura" / "index.html").read_text(encoding="utf-8")
    assert 'id="story"' in html, "角色页没有 story 区块（站内锚点 /c/sakura/#story 会落空）"
    assert html.count('class="day__item"') == 4, "「她的一天」不是四段"
    for slot in ("早晨", "白天", "傍晚", "夜里"):
        assert slot in html, f"时间线缺时段「{slot}」"
    # story 正文里有具体细节，说明写的是场景不是概括
    assert "第三十七级" in html or "扫了三天" in html


def test_story_anchor_reachable(server, page):
    """详情弹窗里"读她的故事"要能落到 #story。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#grid .card")
    page.click("#grid .card:first-child .card__body")
    page.wait_for_timeout(200)
    href = page.get_attribute("#detail-story", "href")
    assert href == "c/sakura/#story", f"故事链接不对: {href}"
    resp = page.goto(BASE + "/c/sakura/#story")
    assert resp.status == 200
    assert page.query_selector("#story") is not None


def test_shelf_titles(server, page):
    """收藏册的分档称号要跟着存档变，且不越级。"""
    page.goto(BASE + "/shelf/", wait_until="networkidle")
    page.evaluate(
        """() => localStorage.setItem('lol1:save', JSON.stringify({
            v: 2, favs: ['sakura','mio','mint'],
            seen: ['sakura','mio','mint','chacha','umi','cream','shiori'],
            turned: ['sakura','mio','mint','chacha'],
            stars: {sakura:12, mio:9, mint:7, chacha:5, umi:3},
            spun: {}, at: Date.now()}))"""
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(300)
    titles = page.eval_on_selector_all(".shelf__title", "els => els.map(e => e.textContent)")
    # 看过 7 → 眼熟（6 档）；收藏 3 → 藏了一颗；转过 4 → 试了一次；寻星 5 → 找到一颗
    assert titles == ["眼熟", "藏了一颗", "试了一次", "找到一颗"], titles


def test_shelf_no_title_below_first_tier(server, page):
    """还没到第一档就不发称号 —— 一进门就给反而没有分量。"""
    page.goto(BASE + "/shelf/", wait_until="networkidle")
    page.evaluate("() => localStorage.removeItem('lol1:save')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(300)
    assert page.query_selector_all(".shelf__title") == []


def test_daily_suggestion(server, page):
    """每日卡片要给下一步，且同一天刷新不变。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector(".daily__suggest")
    first = page.inner_text(".daily__suggest")
    href = page.get_attribute(".daily__suggest", "href")
    assert first.startswith("今天适合："), first
    assert href and href.startswith("/"), href

    page.reload(wait_until="networkidle")
    page.wait_for_selector(".daily__suggest")
    assert page.inner_text(".daily__suggest") == first, "同一天刷新后建议变了"


@pytest.mark.parametrize("width", [320, 360, 390, 414, 480])
def test_nav_never_clips_on_narrow_screens(server, page, width):
    """窄屏上七项导航不能有一项被切掉。

    这一条不是假设的问题，是真的在线上出现过：390px 时「3D 手办台」被截成
    "3D 手"，而 overflowX 是 0、控制台没报错 —— 因为 flex 等分把整项压到比
    scrollWidth 还小，文字只是看不见，不产生滚动条。改成折行布局之后，
    断言 scrollWidth <= clientWidth 仍然不够，得逐格看内容到底有没有被切。
    """
    page.set_viewport_size({"width": width, "height": 800})
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(200)
    # 折叠态（滚动后）导航行高度归零，这一项本来就该为 0，不算被切
    for state in ("top", "scrolled"):
        if state == "scrolled":
            page.evaluate("() => window.scrollTo(0, 1200)")
            page.wait_for_timeout(500)
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(500)
        clipped = page.evaluate(
            """() => [...document.querySelectorAll('.nav__links .nav__link')]
              .filter(e => e.getBoundingClientRect().height > 0
                       && e.scrollWidth > e.clientWidth + 1)
              .map(e => e.textContent.trim())"""
        )
        assert clipped == [], f"{width}px {state} 时这些导航项被切掉: {clipped}"
    assert page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    ) == 0
