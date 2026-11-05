"""存档层的行为。这部分最难靠肉眼验证，出错了用户只会看到"进度没了"。"""
import json

import pytest

from conftest import BASE


def _save(page):
    raw = page.evaluate("() => localStorage.getItem('lol1:save')")
    return json.loads(raw) if raw else None


def test_migrates_legacy_keys(server, page):
    """旧的 lol1:favs / lol1:starhunt 要自动搬家，然后删掉。"""
    page.goto(BASE + "/?v=mig1", wait_until="domcontentloaded")
    page.evaluate("""() => {
        localStorage.clear();
        localStorage.setItem('lol1:favs', JSON.stringify(['sakura', 'mio']));
        localStorage.setItem('lol1:starhunt', '27');
    }""")
    page.goto(BASE + "/?v=mig2", wait_until="networkidle")
    page.wait_for_timeout(900)

    save = _save(page)
    assert save is not None, "迁移后应该出现 lol1:save"
    assert save["v"] == 2
    assert set(save["favs"]) == {"sakura", "mio"}
    assert save["stars"]["__all"] == 27

    leftover = page.evaluate(
        "() => [localStorage.getItem('lol1:favs'), localStorage.getItem('lol1:starhunt')]"
    )
    assert leftover == [None, None], f"旧键应被删除，实际还在: {leftover}"


def test_survives_corrupt_save(server, page):
    """存档被写坏（手改、版本回退）不能让页面崩掉。"""
    page.goto(BASE + "/?v=bad1", wait_until="domcontentloaded")
    page.evaluate("() => localStorage.setItem('lol1:save', '{{{ not json')")

    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(BASE + "/?v=bad2", wait_until="networkidle")
    page.wait_for_timeout(600)

    assert not errs, f"坏存档导致报错: {errs}"
    # 页面仍然可用 —— 卡片要渲染出来
    assert page.eval_on_selector_all(".card", "els => els.length") > 0


def test_works_without_localstorage(server, browser):
    """隐私模式 / 禁用存储时，功能降级但不能白屏。"""
    ctx = browser.new_context()
    ctx.add_init_script(
        "Object.defineProperty(window, 'localStorage', "
        "{ get() { throw new Error('storage disabled'); } });"
    )
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(700)

    cards = page.eval_on_selector_all(".card", "els => els.length")
    assert cards > 0, "禁用 localStorage 后图鉴应该照常显示"
    assert not errs, f"禁用 localStorage 导致报错: {errs}"
    ctx.close()


def test_shelf_reflects_save(server, page):
    """收藏册统计要和存档对得上。"""
    page.goto(BASE + "/shelf/?v=sh1", wait_until="domcontentloaded")
    page.evaluate("""() => {
        localStorage.setItem('lol1:save', JSON.stringify({
          v: 2,
          favs: ['sakura', 'umi', 'cream'],
          seen: ['sakura', 'mio', 'umi', 'chacha', 'mint'],
          turned: ['sakura', 'mio', 'umi'],
          spun: {}, stars: { sakura: 31, mio: 18 }, at: Date.now()
        }));
    }""")
    page.goto(BASE + "/shelf/?v=sh2", wait_until="networkidle")
    page.wait_for_timeout(700)

    nums = page.eval_on_selector_all(
        ".shelf__statNum", "els => els.map(e => e.textContent.trim())"
    )
    assert nums == ["5/12", "3/12", "3/12", "2/12"], f"统计不对: {nums}"

    # 解锁 = 在 seen/favs/turned/stars 里出现过，去重后 6 位
    # （sakura mio mint chacha umi cream），剩下 6 位锁定
    unlocked = set(page.eval_on_selector_all(
        ".sh:not(.is-locked)", "els => els.map(e => e.querySelector('.sh__name').textContent.trim())"
    ))
    assert unlocked == {"樱井小春", "星野澪", "薄荷", "茶茶", "小海", "奶油"}, \
        f"解锁集合不对: {unlocked}"
    assert page.eval_on_selector_all(".sh.is-locked", "els => els.length") == 6


def test_shelf_reset_needs_confirm(server, page):
    """清空不可逆，必须先确认。取消后数据要还在。"""
    page.goto(BASE + "/shelf/?v=rs1", wait_until="domcontentloaded")
    page.evaluate("""() => localStorage.setItem('lol1:save', JSON.stringify({
        v: 2, favs: ['sakura'], seen: [], turned: [], spun: {}, stars: {}
    }))""")
    page.goto(BASE + "/shelf/?v=rs2", wait_until="networkidle")
    page.wait_for_timeout(600)

    # 只挂一个 handler，用可变标志控制接受/取消。
    # 挂两个会导致第二次点击时两个都触发（"already handled" 报错）。
    decision = {"accept": False}
    page.on("dialog", lambda d: d.accept() if decision["accept"] else d.dismiss())

    page.click("#shelf-reset")
    page.wait_for_timeout(400)
    assert _save(page)["favs"] == ["sakura"], "取消后不该清空"

    decision["accept"] = True
    page.click("#shelf-reset")
    page.wait_for_timeout(400)
    # reset() 是整个键删掉，不是写入空数组 —— 所以这里是 None
    save = _save(page)
    assert save is None or save["favs"] == [], f"确认后应清空，实际: {save}"
    # 界面也要跟着归零
    nums = page.eval_on_selector_all(
        ".shelf__statNum", "els => els.map(e => e.textContent.trim())"
    )
    assert nums == ["0/12"] * 4, f"清空后统计没归零: {nums}"


def test_marking_seen_from_character_page(server, page):
    """直接访问角色页也算"看过"。"""
    page.goto(BASE + "/c/chacha/?v=cs1", wait_until="domcontentloaded")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "/c/chacha/?v=cs2", wait_until="networkidle")
    page.wait_for_timeout(600)

    save = _save(page)
    assert save and "chacha" in save["seen"], f"访问角色页没记 seen: {save}"
