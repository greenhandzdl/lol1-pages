"""
交互：把"只有点开才能看到"的东西挨个点一遍。

已有的 test_pages.py 只验证静态可见的结构（卡片在不在、文字对不对）。
这一轮加的组件几乎全是交互之后才出现的 —— 弹窗里的性格条、关系卡的
故事折叠、小游戏结束后的对照条。它们出问题时页面不会报错，只是"点了没反应"
或"反应了一半"，所以必须逐个点。
"""
import pytest

from conftest import BASE


def test_every_card_dialog_renders_traits(server, page):
    """12 张卡片逐个点开，弹窗里的六维性格必须满 6 行。

    这条是回归测试：弹窗的 --pa 曾经是空的（样式进错文件），
    六根条全部没样式，DOM 在、读不出东西。
    """
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    total = page.locator(".card__body").count()
    assert total == 12, f"卡片数不对：{total}"

    problems = []
    for i in range(total):
        page.locator(".card__body").nth(i).click()
        page.wait_for_selector("#detail-traits .traits__row")
        page.wait_for_timeout(200)
        info = page.evaluate(
            """() => {
                const rows = document.querySelectorAll('#detail-traits .traits__row');
                const bar = document.querySelector('#detail-traits .traits__bar > i');
                const box = bar ? bar.getBoundingClientRect() : null;
                return {
                    rows: rows.length,
                    name: document.querySelector('#detail-name').textContent,
                    barWidth: box ? Math.round(box.width) : 0,
                    barHeight: box ? Math.round(box.height) : 0,
                };
            }"""
        )
        if info["rows"] != 6 or info["barHeight"] < 3:
            problems.append(info)
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

    assert not problems, f"这些卡片的弹窗性格条没渲染好：{problems}"


def test_dialog_traits_bars_have_nonzero_width(server, page):
    """条要有长度 —— 宽度 0 是"样式没加载"最典型的表现。"""
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.locator(".card__body").first.click()
    page.wait_for_selector("#detail-traits .traits__row")
    page.wait_for_timeout(400)
    widths = page.evaluate(
        """() => [...document.querySelectorAll('#detail-traits .traits__bar > i')]
                 .map(i => Math.round(i.getBoundingClientRect().width))"""
    )
    assert len(widths) == 6
    assert all(w > 10 for w in widths), f"有性格条宽度接近 0：{widths}"
    assert len(set(widths)) > 1, f"六根条一样长，说明没按数据渲染：{widths}"


@pytest.mark.parametrize("char_id", ["sakura", "mio", "hibari"])
def test_relation_story_folds_open(server, page, char_id):
    """角色页关系卡里的「读她们的一件事」：展开后高度要变，且不能顶出横向滚动。"""
    page.goto(f"{BASE}/c/{char_id}/", wait_until="networkidle")
    page.wait_for_timeout(300)
    cards = page.locator(".rel")
    assert cards.count() >= 2, f"{char_id} 关系卡太少"

    before = page.evaluate("() => Math.round(document.querySelector('.rel').getBoundingClientRect().height)")
    page.locator(".rel details summary").first.click()
    page.wait_for_timeout(250)
    after = page.evaluate("() => Math.round(document.querySelector('.rel').getBoundingClientRect().height)")
    assert after > before + 20, f"展开后高度没变：{before} → {after}"

    text = page.locator(".rel details p").first.inner_text()
    assert len(text) > 40, f"故事太短：{text!r}"

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert overflow <= 0, f"展开故事后出现横向溢出 {overflow}px"


def test_story_panel_survives_filtering(server, page):
    """展开关系故事面板之后去筛选，面板不能被重渲染收回。

    #web 和筛选逻辑共享一次 renderGrid，很容易顺手把面板也重建。
    """
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.wait_for_timeout(800)
    page.click(".webStory > summary")
    page.wait_for_timeout(250)
    assert page.evaluate("() => document.querySelector('.webStory').open")

    page.fill("#search", "花")
    page.wait_for_timeout(400)
    still_open = page.evaluate(
        "() => { const d = document.querySelector('.webStory'); return d ? d.open : 'gone'; }"
    )
    assert still_open is True, f"筛选之后故事面板被收起来了：{still_open}"


def test_3d_strip_switches_model(server, page):
    """3D 台的缩略图条：点另一张要换模型，并且 aria-current 跟着走。"""
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(1500)
    thumbs = page.locator(".stage__thumb")
    assert thumbs.count() == 12, f"缩略图应该是 12 个，实际 {thumbs.count()}"

    page.locator(".stage__thumb").nth(3).click()
    page.wait_for_timeout(900)
    current = page.evaluate(
        """() => {
            const on = [...document.querySelectorAll('.stage__thumb')]
                .filter(t => t.getAttribute('aria-current') === 'true');
            return { count: on.length, id: on[0]?.dataset.id ?? null };
        }"""
    )
    assert current["count"] == 1, f"应当只有一个缩略图被标记为当前：{current}"
    assert current["id"] == page.locator(".stage__thumb").nth(3).get_attribute("data-id")


def test_quiz_comparison_bars_have_length(server, page):
    """答完 7 题：对照条要有宽度，且我/她两组都能画出来。"""
    page.goto(f"{BASE}/play/", wait_until="networkidle")
    page.click("#quiz-start")
    for _ in range(7):
        page.locator("#play-body .quiz__opt").first.click()
        page.wait_for_timeout(120)
    page.wait_for_timeout(500)

    bars = page.evaluate(
        """() => [...document.querySelectorAll('.traitCmp__bar > i')]
                 .map(i => Math.round(i.getBoundingClientRect().width))"""
    )
    assert len(bars) == 6, f"应该有 3 行 × 2 条，实际 {len(bars)}"
    assert all(w > 10 for w in bars), f"有条宽度接近 0（样式没加载？）：{bars}"


def _swipe(page, selector, dx, ms=200):
    """在某个元素上派发一次合成的横向触摸滑动。

    Playwright 的 touchscreen 只有 tap，滑动得自己造 TouchEvent。
    用真实的 target 元素，这样 closest('.stage__canvas') 的判断才会生效。
    """
    page.evaluate(
        """([sel, dx, ms]) => {
            const t0 = performance.now();
            const start = t0;
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            const cy = r.top + r.height / 2;
            const x0 = r.left + r.width / 2;
            const mk = (type, x) => {
                const t = new Touch({
                    identifier: 1, target: el, clientX: x, clientY: cy,
                    pageX: x, pageY: cy,
                });
                return new TouchEvent(type, {
                    touches: type === 'touchend' ? [] : [t],
                    targetTouches: type === 'touchend' ? [] : [t],
                    changedTouches: [t],
                    bubbles: true, cancelable: true,
                });
            };
            el.dispatchEvent(mk('touchstart', x0));
            el.dispatchEvent(mk('touchmove', x0 + dx / 2));
            el.dispatchEvent(mk('touchend', x0 + dx));
        }""",
        [selector, dx, ms],
    )


def test_swipe_on_canvas_does_not_change_character(server, page):
    """在手办台上转视角，不能把人换掉。

    这是真出过的 bug：canvas 铺满 viewport，横拖是**旋转视角**，
    但触摸滑动的处理器没判断手势从哪开始 —— 想转个角度看背面，
    人就被换成了下一个。横拖 70px 很容易达到，而转一圈常常拖 100px 以上。

    键盘那条路径一直有 closest('.stage__canvas') 的检查，触摸这里漏了。
    """
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    before = page.locator("#stage-name").inner_text().strip()
    _swipe(page, ".stage__canvas", -120)
    page.wait_for_timeout(1200)
    after = page.locator("#stage-name").inner_text().strip()

    assert after == before, f"转视角时换了人：{before} → {after}"


def test_swipe_outside_canvas_still_changes_character(server, page):
    """修过头也是 bug：canvas 之外横滑，还是得能换人。

    注意滑动目标必须在 #viewport 里面 —— 侧栏 .stage__panel 是它的兄弟节点，
    事件根本到不了监听器。viewport 里除 canvas 之外的可点区域是 .stage__hint。
    """
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    before = page.locator("#stage-name").inner_text().strip()
    _swipe(page, ".stage__hint", -160)
    page.wait_for_timeout(1400)
    after = page.locator("#stage-name").inner_text().strip()

    assert after != before, f"canvas 外横滑没有换人（{before} → {after}）"


def _glb_requests(page, record):
    return [u.split("/")[-1] for u in record if u.endswith(".glb")]


def test_revisiting_a_model_does_not_refetch(server, page):
    """看过的模型不该重新下载。

    原先每换一次人都 loadAsync 一遍：从 sakura 切走再切回来，
    220-470KB 的模型又下载、又解析一次。模型体积不小（合计 3.6MB），
    来回比较几个人是常见动作。
    """
    glbs = []
    page.on("request", lambda r: glbs.append(r.url) if r.url.endswith(".glb") else None)

    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)
    first = page.locator("#stage-name").inner_text().strip()
    first_file = _glb_requests(page, glbs)[0]
    n = len(glbs)

    page.locator("#next-btn").click()
    page.wait_for_timeout(1800)
    page.locator("#prev-btn").click()
    page.wait_for_timeout(1800)

    assert page.locator("#stage-name").inner_text().strip() == first, "没切回第一个人"
    again = [g for g in _glb_requests(page, glbs[n:]) if g == first_file]
    assert not again, f"切回来时又下载了一次 {first_file}"


def test_model_cache_is_bounded(server, page):
    """缓存要有上限 —— 12 个模型全常驻会吃掉大量显存。

    这条只验证"没泄漏"：连切很多人之后，往回走会重新下载
    （说明老条目被淘汰了）。若缓存无上限，往回走应该一次都不下载。
    """
    glbs = []
    page.on("request", lambda r: glbs.append(r.url) if r.url.endswith(".glb") else None)

    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    # 往后走 8 个人
    for _ in range(8):
        page.locator("#next-btn").click()
        page.wait_for_timeout(1100)
    n = len(glbs)

    # 再往回走 6 个人：如果缓存无上限，这里一个新请求都不该有
    for _ in range(6):
        page.locator("#prev-btn").click()
        page.wait_for_timeout(1100)

    refetched = _glb_requests(page, glbs[n:])
    assert refetched, "走了 8 个人再回来，一个模型都没重新下载 —— 缓存可能没有上限"


def test_stage_panel_shows_person_details(server, page):
    """3D 侧栏要有人物向的信息，不能只有元素/地域/标签。

    characters.json 里 likes / dislikes / habit 每个人都有，档案页也早就
    渲染了，但手办台的侧栏一直没展示 —— 切换人物时看完三行属性就没东西了。
    """
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    likes = page.locator("#stage-likes").inner_text().strip()
    dislikes = page.locator("#stage-dislikes").inner_text().strip()
    habit = page.locator("#stage-habit").inner_text().strip()

    assert likes and likes != "—", f"喜欢没渲染出来：{likes!r}"
    assert dislikes and dislikes != "—", f"不喜欢没渲染出来：{dislikes!r}"
    assert habit, "小习惯没渲染出来"

    # 换一个人，这几行要跟着换 —— 写死一次也会让上面几条通过
    page.locator("#next-btn").click()
    page.wait_for_timeout(1500)
    assert page.locator("#stage-likes").inner_text().strip() != likes, "换人后「喜欢」没变"


def test_stage_person_details_match_data(server, page):
    """侧栏显示的内容要和 characters.json 一致，不能是编的。"""
    import json

    data = json.loads(open("assets/data/characters.json", encoding="utf-8").read())
    by_name = {c["name"]: c for c in data["characters"]}

    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    for _ in range(4):
        name = page.locator("#stage-name").inner_text().strip()
        ch = by_name[name]
        got = page.locator("#stage-likes").inner_text().strip()
        want = " · ".join(ch["likes"])
        assert got == want, f"{name} 的喜欢显示成 {got!r}，应为 {want!r}"
        assert page.locator("#stage-habit").inner_text().strip() == ch["habit"]
        page.locator("#next-btn").click()
        page.wait_for_timeout(1200)


def test_double_click_resets_the_view(server, page):
    """拖到背面之后，双击应该回到正面。

    原来没有任何回正的办法 —— 只能朝反方向再拖同样多，拖多少算"回正"
    全靠手感。双击是这类视图的惯例（Google Maps、各种 3D 查看器都是）。
    """
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    canvas = page.locator(".stage__canvas")
    home = canvas.screenshot()

    # 转一下
    box = canvas.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    for i in range(10):
        page.mouse.move(cx + i * 20, cy)
    page.mouse.up()
    page.wait_for_timeout(1200)

    assert canvas.screenshot() != home, "拖动没有改变视角，这条测试就没意义了"

    canvas.dblclick(position={"x": 200, "y": 300})
    page.wait_for_timeout(1500)
    assert canvas.screenshot() == home, "双击没有回到初始视角"


def test_swapping_adds_a_transition_but_first_load_does_not(server, page):
    """换人时要有过渡，首次加载时不要。

    原来换人是硬切，上一秒一个人、下一秒另一个人，像页面闪了一下。
    但首次加载不能也加这个 —— 模型本来就在淡入，再叠一层会闪两下。
    """
    page.goto(f"{BASE}/3d/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    canvas = page.locator(".stage__canvas")
    assert "is-swapping" not in (canvas.get_attribute("class") or ""), "首次加载就播了换人动画"

    page.locator("#next-btn").click()
    page.wait_for_timeout(300)
    assert "is-swapping" in (canvas.get_attribute("class") or ""), "换人时没有过渡"


def test_transition_respects_reduced_motion(server, page, browser):
    """开了减少动效就不该再有这个动画。"""
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        reduced_motion="reduce",
    )
    p2 = ctx.new_page()
    p2.goto(f"{BASE}/3d/", wait_until="networkidle")
    p2.wait_for_timeout(2500)
    p2.locator("#next-btn").click()
    p2.wait_for_timeout(400)
    name = p2.evaluate(
        "() => getComputedStyle(document.querySelector('.stage__canvas')).animationName"
    )
    assert name == "none", f"减少动效下仍有动画：{name}"
    ctx.close()
