"""两个玩法的交互。这部分逻辑分支最多，最容易坏。"""
import pytest

from conftest import BASE


def _open_play(page, mode=None, v="p1"):
    page.goto(f"{BASE}/play/?v={v}", wait_until="networkidle")
    page.wait_for_timeout(700)
    if mode:
        page.click(f'#play-tabs .chip[data-mode="{mode}"]')
        page.wait_for_timeout(500)


# ---------- 性格测试 ----------

def test_quiz_start(server, page):
    _open_play(page)
    assert page.query_selector("#quiz-start"), "开场按钮没渲染出来"
    page.click("#quiz-start")
    page.wait_for_timeout(300)
    assert page.query_selector(".quiz__title"), "没进入第一题"
    assert "第 1 / 7 题" in page.text_content(".quiz__count")


def test_quiz_progress_not_empty_on_first(server, page):
    """第 1 题的进度条不该是空的。"""
    _open_play(page)
    page.click("#quiz-start")
    page.wait_for_timeout(300)
    width = page.eval_on_selector(
        ".quiz__bar span", "el => parseFloat(el.style.width)"
    )
    assert width > 0, f"第 1 题进度条宽度是 {width}%"


def test_quiz_back_button(server, page):
    """回到上一题要真的退回去，并且清掉那题的答案。"""
    _open_play(page)
    page.click("#quiz-start")
    page.wait_for_timeout(250)
    assert not page.query_selector("#quiz-back"), "第 1 题不该有返回按钮"

    page.click('.quiz__opt[data-i="0"]')
    page.wait_for_timeout(300)
    assert page.query_selector("#quiz-back"), "第 2 题应该有返回按钮"

    page.click("#quiz-back")
    page.wait_for_timeout(300)
    assert "第 1 / 7 题" in page.text_content(".quiz__count")


@pytest.mark.parametrize("answer", [0, 1, 2, 3])
def test_quiz_result_renders(server, page, answer):
    """四种固定答法都能走完并给出结果。"""
    _open_play(page, v=f"q{answer}")
    page.click("#quiz-start")
    page.wait_for_timeout(250)
    for _ in range(7):
        page.click(f'.quiz__opt[data-i="{answer}"]')
        page.wait_for_timeout(180)

    assert page.query_selector(".quiz__name"), f"全选 {answer} 没有结果"
    name = page.text_content(".quiz__name").strip()
    assert name and name != "？？？"
    # 解释不能是空的 —— 这是结果页存在的意义
    why = page.text_content(".quiz__why").strip()
    assert len(why) > 10, f"解释太短: {why}"


def test_quiz_answer_patterns_differ(server, page):
    """全选 A 和全选 D 应该得到不同的人，否则题目没区分度。"""
    def run(a, v):
        _open_play(page, v=v)
        page.click("#quiz-start")
        page.wait_for_timeout(250)
        for _ in range(7):
            page.click(f'.quiz__opt[data-i="{a}"]')
            page.wait_for_timeout(160)
        return page.text_content(".quiz__name").strip()

    a = run(0, "diff_a")
    d = run(3, "diff_d")
    assert a != d, f"全选 A 和 D 都是 {a}，题目区分度有问题"


def test_quiz_again(server, page):
    _open_play(page)
    page.click("#quiz-start")
    page.wait_for_timeout(250)
    for _ in range(7):
        page.click('.quiz__opt[data-i="1"]')
        page.wait_for_timeout(160)
    page.click("#quiz-again")
    page.wait_for_timeout(400)
    assert page.query_selector("#quiz-start"), "再测一次应回到开场"


# ---------- 地名配对 ----------

def test_match_board(server, page):
    _open_play(page, mode="match")
    left = page.eval_on_selector_all("#mt-left .mt__item", "els => els.length")
    right = page.eval_on_selector_all("#mt-right .mt__item", "els => els.length")
    assert left == 6 and right == 6, f"应该是 6 对，实际 {left}/{right}"


def test_match_correct_pair(server, page):
    _open_play(page, mode="match")
    cid = page.eval_on_selector("#mt-left .mt__item", "el => el.dataset.id")
    page.click("#mt-left .mt__item")
    page.wait_for_timeout(150)
    page.click(f'#mt-right .mt__item[data-id="{cid}"]')
    page.wait_for_timeout(350)

    hud = page.text_content("#mt-hud")
    assert "已配对 1/6" in hud, f"配对成功但计数不对: {hud}"
    assert "失误 0" in hud, f"配对成功不该记失误: {hud}"


def test_match_wrong_pair(server, page):
    _open_play(page, mode="match")
    cid = page.eval_on_selector("#mt-left .mt__item", "el => el.dataset.id")
    other = page.evaluate(
        """(cid) => [...document.querySelectorAll('#mt-right .mt__item')]
             .find(e => e.dataset.id !== cid).dataset.id""",
        cid,
    )
    page.click("#mt-left .mt__item")
    page.wait_for_timeout(150)
    page.click(f'#mt-right .mt__item[data-id="{other}"]')
    page.wait_for_timeout(700)

    hud = page.text_content("#mt-hud")
    assert "已配对 0/6" in hud, f"配错不该记配对: {hud}"
    assert "失误 1" in hud, f"配错应记一次失误: {hud}"


def test_match_cannot_click_right_first(server, page):
    """必须先点地名，再点人 —— 反过来不该有反应。"""
    _open_play(page, mode="match")
    page.click("#mt-right .mt__item")
    page.wait_for_timeout(250)
    picked = page.eval_on_selector_all(".mt__item.is-pick", "els => els.length")
    assert picked == 0, "直接点右边不该选中任何东西"


def test_match_complete_all(server, page):
    """把 6 对全配完，应该出现完成提示。"""
    _open_play(page, mode="match")
    ids = page.eval_on_selector_all(
        "#mt-left .mt__item", "els => els.map(e => e.dataset.id)"
    )
    for cid in ids:
        page.click(f'#mt-left .mt__item[data-id="{cid}"]')
        page.wait_for_timeout(120)
        page.click(f'#mt-right .mt__item[data-id="{cid}"]')
        page.wait_for_timeout(200)

    # 完成后 HUD 会被完成语整个替换掉，不再显示"已配对 6/6"
    hud = page.text_content("#mt-hud").strip()
    assert "全部配对" in hud, f"完成后应有提示: {hud}"
    # 六张左卡都该被标记为已完成
    done = page.eval_on_selector_all("#mt-left .mt__item.is-done", "els => els.length")
    assert done == 6, f"应锁住 6 张，实际 {done}"


def test_mode_switch_updates_header(server, page):
    """切玩法时页头要跟着变，不能还写着"七个问题"。"""
    _open_play(page)
    quiz_title = page.text_content("#play-title")
    page.click('#play-tabs .chip[data-mode="match"]')
    page.wait_for_timeout(400)
    match_title = page.text_content("#play-title")
    assert quiz_title != match_title, f"页头没变，还是 {quiz_title}"
    assert "地名" in page.text_content("#play-desc") or "六个" in page.text_content("#play-desc")


def test_shelf_locked_cards_use_palette(server, page):
    """锁定卡片也得带自己的 palette —— 空态不该是一片灰。

    灰掉的卡片传达的是"没加载出来"或"被禁用"，
    和"还没解锁"是两回事；12 张灰卡会让人以为坏了。
    """
    page.goto(BASE + "/shelf/", wait_until="networkidle")
    page.wait_for_timeout(400)
    locked = page.locator(".sh.is-locked")
    assert locked.count() >= 1, "锁定卡片应该至少有一张（空存档时全部锁定）"
    styles = locked.first.get_attribute("style") or ""
    assert "--pa:" in styles and "--pb:" in styles, f"锁定卡片没有 palette: {styles}"


def test_shelf_locked_cards_have_element_glyph(server, page):
    """锁的显示用元素图形，不是问号 —— 图形至少说明了属性。"""
    page.goto(BASE + "/shelf/", wait_until="networkidle")
    page.wait_for_timeout(400)
    glyphs = page.locator(".sh.is-locked .sh__q .glyph")
    assert glyphs.count() >= 1, "锁定卡片上没有图形"
