"""全站页面冒烟：每个页面、每个视口，都要能开、不溢出、不报错。"""
import re

import pytest

from conftest import BASE, ROOT as ROOT_FOR_TESTS, VIEWPORTS

ROOT = ROOT_FOR_TESTS

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


# 主导航只放「真正能独立打开的页面」。
# 地域 / 关于 / 内容政策 是首页里的某一段，入口在页脚 ——
# 它们和独立页面同级平铺，正是导航"层次不对、读起来模糊"的根源。
EXPECTED_NAV = ["图鉴", "3D 手办台", "收藏册", "小游戏"]


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
    # 关系收在「更多资料」里（弹窗分层，见 test_dialog_folds_reference_info）
    page.click(".detail__moreSummary")
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


def test_web_legend_counts_match_edges(server, page):
    """图例上的条数必须等于图上真实画出来的线。

    这里踩过一次：图例直接数了 characters.json 里的 directed 关系（38 条），
    而图上每条无向关系只画一根线（19 根）。于是图例加起来是 38、
    标题写着 19 —— 同一个区块自相矛盾，而且不报错。
    """
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    drawn = page.evaluate(
        "() => document.querySelectorAll('.web__svg .web__edge').length"
    )
    legend = page.evaluate(
        """() => [...document.querySelectorAll('.web__key')]
             .map(k => Number(k.querySelector('i').textContent))"""
    )
    kinds = page.evaluate(
        "() => new Set([...document.querySelectorAll('.web__key')].map(k => k.dataset.kind)).size"
    )
    assert legend, "图例没渲染出来"
    assert sum(legend) == drawn, f"图例合计 {sum(legend)} 条，图上实际 {drawn} 条"
    assert kinds == len(legend), "图例里同一关系种类出现了两次"


def test_web_edge_kinds_are_whitelisted(server, page):
    """每条线的 data-kind 都必须有对应的颜色规则，否则它会静默变成默认灰。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    colors = page.evaluate(
        """() => {
          const out = {};
          document.querySelectorAll('.web__svg .web__edge').forEach(l => {
            const k = l.dataset.kind;
            out[k] = getComputedStyle(l).stroke;
          });
          return out;
        }"""
    )
    assert colors, "没读到任何连线"
    missing = [k for k, v in colors.items() if not k]
    assert missing == [], f"有连线缺 data-kind: {missing}"
    # 6 种关系应该是 6 个不同颜色（灰也允许，但不能全部相同）
    assert len(set(colors.values())) >= 5, f"关系种类没有分色，实际只有 {len(set(colors.values()))} 种颜色"


def test_content_visible_without_javascript(server, browser):
    """关掉 JS，页面内容必须可见 —— reveal 不能把整页藏起来。

    实测踩过的真缺陷：`.reveal { opacity: 0 }` 靠 JS 加 `.is-in` 才显示，
    关掉 JS 后首屏 hero 以下全是空白，连 `<noscript>` 里的兜底内容
    （它自己也在 .reveal 里）一起被藏。现在改成渐进增强：
    只有 <html class="js"> 时才隐藏。
    """
    ctx = browser.new_context(viewport=VIEWPORTS["1440"], java_script_enabled=False)
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="load")
    page.wait_for_timeout(300)

    opacities = page.evaluate(
        "() => [...document.querySelectorAll('.reveal')].map(e => getComputedStyle(e).opacity)"
    )
    hidden = [o for o in opacities if o == "0"]
    assert hidden == [], f"关 JS 后还有 {len(hidden)} 个 .reveal 停在 opacity:0"

    # noscript 兜底卡片也得看得见
    cards = page.evaluate(
        """() => {
          const ns = [...document.querySelectorAll('noscript')];
          return ns.length;
        }"""
    )
    assert cards >= 1, "首页应该有 noscript 兜底"
    ctx.close()


def test_traits_visible_on_char_page(server, page):
    """六维性格必须出现在角色页上。

    第五轮之前 traits 只在 play.js 的余弦计算里当中间变量，
    界面上一次都没渲染过 —— 这是全站结构化程度最高的数据。
    """
    page.goto(BASE + "/c/sakura/", wait_until="networkidle")
    n = page.evaluate("() => document.querySelectorAll('#traits .traits__row').length")
    assert n == 6, f"期望 6 个性格维度，实际 {n}"


def test_trait_bars_have_accessible_names(server, page):
    """条本身是装饰，整块必须有一句可读的 aria-label，否则读屏读不到。"""
    page.goto(BASE + "/c/sakura/", wait_until="networkidle")
    label = page.evaluate(
        "() => document.querySelector('#traits .traits')?.getAttribute('aria-label') || ''"
    )
    assert "温柔" in label and "分" in label, f"性格块的 aria-label 不合格: {label!r}"


def test_quiz_shows_trait_comparison(server, page):
    """测试结果要给出「你 vs 她」的分项对照，而不只是一句结论。"""
    page.goto(BASE + "/play/", wait_until="networkidle")
    page.click("#quiz-start")
    for _ in range(7):
        page.locator("#play-body .quiz__opt").first.click()
        page.wait_for_timeout(120)
    page.wait_for_selector(".traitCmp", timeout=5000)
    rows = page.evaluate("() => document.querySelectorAll('.traitCmp__row').length")
    assert 2 <= rows <= 3, f"对照应只显示差异最大的 2–3 项，实际 {rows}"
    # 条必须真的有宽度 —— span 默认 inline，写错 display 时宽度会是 0
    w = page.evaluate(
        "() => document.querySelector('.traitCmp__bar').getBoundingClientRect().width"
    )
    assert w > 20, f"对照条宽度 {w}px，CSS 没生效"


def test_quote_strip_on_home(server, page):
    """首页「今天读一句」：有条目、指向某个人，且同一天不随刷新变化。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector("#quote-line .quote__text", timeout=5000)
    first = page.evaluate("() => document.querySelector('#quote-line').textContent")
    page.reload(wait_until="networkidle")
    page.wait_for_selector("#quote-line .quote__text", timeout=5000)
    second = page.evaluate("() => document.querySelector('#quote-line').textContent")
    assert first.strip() == second.strip(), "同一天两次打开读到的不一样"


def test_model_thumbs_exist_for_all_models(server):
    """每个有 glb 的角色都要有一张缩略图 —— 少一张就是页面上一个破图。"""
    import json

    chars = json.loads(
        (ROOT_FOR_TESTS / "assets/data/characters.json").read_text(encoding="utf-8")
    )["characters"]
    with_model = [c["id"] for c in chars if c.get("model")]
    assert with_model, "没有任何角色配了模型"
    missing = [
        cid
        for cid in with_model
        if not (ROOT_FOR_TESTS / f"assets/img/models/{cid}.png").exists()
    ]
    assert not missing, f"缺缩略图: {missing}"


def test_theme_query_works_on_every_page(server, page):
    """?theme=dark 必须在每一页生效。

    这段「首帧前应用主题」的内联脚本原本在 18 个页面里各抄一份，
    其中 17 份漏了查询参数那一行 —— 于是分享出去的暗色链接到别的页面
    就变回浅色，而且所有「暗色主题」的测试其实都在量浅色主题。
    """
    pages = ["/", "/3d/", "/play/", "/shelf/", "/404.html", "/c/sakura/"]
    bad = []
    for path in pages:
        for theme in ("light", "dark"):
            page.goto(f"{BASE}{path}?theme={theme}", wait_until="networkidle")
            page.wait_for_timeout(200)
            got = page.evaluate("document.documentElement.dataset.theme")
            if got != theme:
                bad.append(f"{path} 期望 {theme}，实际 {got}")
    assert not bad, "这些页面的 ?theme= 不生效：\n  " + "\n  ".join(bad)


def test_theme_boot_is_identical_on_every_page(server):
    """每一页的主题脚本必须逐字一致 —— 一旦有页面落后于来源，就是抄漏了。"""
    import subprocess, sys
    r = subprocess.run(
        ["node", "scripts/sync-theme-boot.mjs", "--check"],
        cwd=str(ROOT), capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr


def test_every_page_has_a_way_back():
    """内页都要有页脚，页脚里要有回首页的路。

    /3d/ 曾经是唯一没有页脚的页面 —— 从 3D 台点到别的页面突然多出一条底线，
    再点回来又没了，像少画了一块。这是手抄模板时漏掉的。

    两个例外，都有理由，所以按角色分开判：
      · 首页自己就是家，不需要"回首页"
      · 404 是刻意做成极简的一屏（没有导航也没有页脚），正文里有一个
        回到首页的主按钮就够了 —— 给它补页脚反而会破坏那种"走错了"的空旷感
    """
    import pathlib
    # 首页不入列：它自己就是家
    pages = ["3d/index.html", "play/index.html", "shelf/index.html"]
    pages += [f"c/{d.name}/index.html" for d in pathlib.Path(ROOT / "c").iterdir() if d.is_dir()]

    missing = []
    for rel in pages:
        html = (ROOT / rel).read_text(encoding="utf-8")
        if "<footer" not in html:
            missing.append(f"{rel}（没有页脚）")
            continue
        footer = html[html.index("<footer"):]
        footer = footer[: footer.index("</footer>")]
        if 'href="/"' not in footer and 'href="/index.html"' not in footer:
            missing.append(f"{rel}（页脚里没有回首页的链接）")

    # 404 单独判：正文里必须有回首页的路
    err = (ROOT / "404.html").read_text(encoding="utf-8")
    if 'href="/"' not in err:
        missing.append("404.html（找不到回首页的路）")

    assert not missing, "这些问题：\n  " + "\n  ".join(missing)


def test_pages_degrade_without_javascript(server, browser):
    """关掉 JS 也要有东西可读。

    这个站点是纯静态的，正文本来就该不依赖脚本 —— 但有几处靠 JS 渲染的区域
    在关掉脚本后会变成空白或破图：

      · /3d/ 的 noscript 兜底 <img> 没有 src，显示成一个 80×26 的破图框
      · /play/ 完全没有 noscript，只剩标题和一大块空白

    爬虫和屏蔽脚本的用户走的就是这条路，而且这是"看不清"而不是"报错"，
    平时开发根本不会注意到。
    """
    expectations = {
        "/": (300, "图鉴全表"),
        "/3d/": (180, "插画 + 说明"),
        "/play/": (180, "一条去图鉴的路"),
        "/shelf/": (150, "说明"),
        "/c/sakura/": (1000, "完整档案"),
    }
    thin = []
    for path, (min_chars, what) in expectations.items():
        ctx = browser.new_context(java_script_enabled=False, viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        try:
            pg.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            pg.wait_for_timeout(300)
            n = len(pg.inner_text("body"))
            if n < min_chars:
                thin.append(f"{path} 只有 {n} 字（至少要 {min_chars}，需要{what}）")
        finally:
            ctx.close()
    assert not thin, "关掉 JavaScript 后这些页面内容太少：\n  " + "\n  ".join(thin)


def test_noscript_images_all_have_a_source():
    """noscript 里的 <img> 必须有 src —— 否则关掉 JS 就是一个破图框。"""
    import pathlib
    bad = []
    for f in pathlib.Path(ROOT).rglob("*.html"):
        if "node_modules" in str(f):
            continue
        # 先去掉注释：注释里写「这个 <img> 原来没有 src」也会被当成标签
        html = re.sub(r"<!--[\s\S]*?-->", "", f.read_text(encoding="utf-8"))
        for m in re.finditer(r"<img\b[^>]*>", html):
            tag = m.group(0)
            # 只看 noscript 附近的：带 stage__fallback 或位于 noscript 块内
            idx = html.index(tag)
            head = html[:idx]
            if head.count("<noscript") > head.count("</noscript>"):
                if "src=" not in tag:
                    bad.append(f"{f.relative_to(ROOT)}: {tag[:80]}")
    assert not bad, "noscript 里的图片没有 src：\n  " + "\n  ".join(bad)


def test_3d_degrades_without_downloading_three(server, browser):
    """省流量 / 2G 时不该下载 three.js，但必须给出插画。

    capability.js 特意做成"不 import three"的小模块，就是为了让这条路
    真的省流量 —— 如果哪天有人顺手在里面 import 了 three，降级就形同虚设，
    而页面上看起来一切正常（插画照样显示），根本不会有人发现。
    所以这里既查"three 没下载"，也查"插画显示了"。
    """
    cases = {
        "save-data": "Object.defineProperty(navigator,'connection',{value:{saveData:true},configurable:true});",
        "slow-2g": "Object.defineProperty(navigator,'connection',{value:{effectiveType:'2g',saveData:false},configurable:true});",
    }
    problems = []
    for name, script in cases.items():
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        pg = ctx.new_page()
        pg.add_init_script(script)
        reqs, errs = [], []
        pg.on("request", lambda r: reqs.append(r.url))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        try:
            pg.goto(f"{BASE}/3d/", wait_until="networkidle")
            pg.wait_for_timeout(2000)
            three = [r for r in reqs if "three.bundle" in r]
            state = pg.evaluate("document.querySelector('.stage').dataset.state")
            has_img = pg.evaluate("!!document.querySelector('#fallback-img').getAttribute('src')")
            if three:
                problems.append(f"{name}：不该下载 three.js，实际下了 {len(three)} 次")
            if state != "fallback":
                problems.append(f"{name}：状态应为 fallback，实际 {state}")
            if not has_img:
                problems.append(f"{name}：没显示插画（整块空白）")
            if errs:
                problems.append(f"{name}：JS 报错 {errs[:1]}")
        finally:
            ctx.close()
    assert not problems, "降级路径有问题：\n  " + "\n  ".join(problems)


def test_capability_module_does_not_pull_in_three():
    """静态检查：capability.js 的 import 闭包里不能出现 three。

    这条比运行时检查更早失败 —— 一旦有人加了一句 import，构建阶段就知道。
    """
    import pathlib
    root = ROOT / "assets" / "js" / "stage"
    src = (root / "capability.js").read_text(encoding="utf-8")
    imports = re.findall(r"""^\s*import\s[\s\S]*?from\s+['"]([^'"]+)['"]""", src, re.M)
    assert not imports, f"capability.js 不该有任何 import，实际有：{imports}"
    # 动态 import 也不行：一样会把 three 拉进这一层
    assert "import(" not in src, "capability.js 里出现了动态 import"
