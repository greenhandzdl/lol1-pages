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
