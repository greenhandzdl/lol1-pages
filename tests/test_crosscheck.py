"""JS 与 Python 的算法必须给出同样结果。

上面 test_every_character_reachable 用 Python 重写了一遍匹配算法。
两次实现总有走样的可能（这次就差点被平局处理骗过去），
所以这里让 Node 真跑一遍线上用的逻辑，两边对答案。
"""
import json
import subprocess
import sys

import pytest

from conftest import BASE, ROOT

CHARS = json.loads((ROOT / "assets/data/characters.json").read_text(encoding="utf-8"))["characters"]


def _overflow(page) -> int:
    return page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")


NODE_SCRIPT = r"""
const q = require('./assets/data/quiz.json');
const chars = require('./assets/data/characters.json').characters;
const T = q.traits;
const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (const t of T) { d += a[t] * b[t]; na += a[t] ** 2; nb += b[t] ** 2; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
const tally = (ans) => {
  const v = {}; T.forEach((t) => (v[t] = 0));
  ans.forEach((oi, qi) => Object.entries(q.questions[qi].options[oi].w)
    .forEach(([k, x]) => (v[k] += x)));
  return v;
};
const rank = (v) => [...chars].sort((a, b) => cos(v, b.traits) - cos(v, a.traits))
  .slice(0, 3).map((c) => c.id);
const out = {};
for (const t of chars) {
  const ans = [];
  for (let qi = 0; qi < q.questions.length; qi++) {
    let bs = -1, bo = 0;
    q.questions[qi].options.forEach((o, oi) => {
      const s = cos(tally([...ans, oi]), t.traits);
      if (s > bs) { bs = s; bo = oi; }
    });
    ans.push(bo);
  }
  out[t.id] = { ans, top3: rank(tally(ans)) };
}
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def node_result():
    r = subprocess.run(
        ["node", "-e", NODE_SCRIPT], cwd=ROOT, capture_output=True, text=True, timeout=60
    )
    assert r.returncode == 0, f"Node 跑失败: {r.stderr}"
    return json.loads(r.stdout)


def test_node_covers_all(chars, node_result):
    assert set(node_result) == {c["id"] for c in chars}


def test_node_greedy_returns_self(node_result):
    """跟着线上算法走，每个人都要回到自己。"""
    bad = [f"{k} → {v['top3'][0]}" for k, v in node_result.items() if v["top3"][0] != k]
    assert not bad, f"JS 侧不可达: {bad}"


def test_python_matches_node(chars, node_result):
    """同一个答题序列，两边排出来的前三必须一样。"""
    quiz = json.loads((ROOT / "assets" / "data" / "quiz.json").read_text(encoding="utf-8"))
    T = quiz["traits"]

    def cos(a, b):
        d = sum(a[k] * b[k] for k in T)
        na = sum(a[k] ** 2 for k in T) ** 0.5
        nb = sum(b[k] ** 2 for k in T) ** 0.5
        return d / (na * nb) if na and nb else 0.0

    def tally(ans):
        v = {k: 0 for k in T}
        for qi, oi in enumerate(ans):
            for k, x in quiz["questions"][qi]["options"][oi]["w"].items():
                v[k] += x
        return v

    mismatched = []
    for cid, info in node_result.items():
        vec = tally(info["ans"])
        py_top3 = [c["id"] for c in sorted(chars, key=lambda c: -cos(vec, c["traits"]))[:3]]
        if py_top3 != info["top3"]:
            mismatched.append(f"{cid}: py={py_top3} js={info['top3']}")

    assert not mismatched, "两边算法不一致:\n" + "\n".join(mismatched)




def test_now_slots_cover_day_times(server, page):
    """「此刻」的四个时段必须能覆盖 day[] 里的全部 time 值，否则有档位是空的。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    slots = page.evaluate(
        "() => [...document.querySelectorAll('.now__btn')].map(b => b.dataset.slot)"
    )
    assert slots == ["morning", "day", "evening", "night"], slots

    # 这里用 Python 数一遍：数据是 12 位 × 4 档，任何一位缺档都会让某一档是空的
    missing = [c["id"] for c in CHARS if len(c.get("day", [])) != 4]
    assert missing == [], f"这些角色的 day 不是 4 档: {missing}"


def test_now_section_never_adds_horizontal_overflow(server, page):
    """区块必须紧凑：320px 上不能把文档撑宽（首页已经很高了）。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.evaluate("() => document.getElementById('now').scrollIntoView({block: 'start'})")
    page.wait_for_timeout(300)
    assert _overflow(page) == 0, f"#now 区块在 320px 上横向溢出 {_overflow(page)}px"


def test_now_switch_changes_content(server, page):
    """点不同时段，内容要真的变（不是只换标签）。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    first = page.locator("#now-card .now__text").text_content()
    page.click('.now__btn[data-slot="night"]')
    page.wait_for_timeout(400)
    second = page.locator("#now-card .now__text").text_content()
    assert first != second, "切换时段后文案没变"
    assert page.locator('.now__btn[data-slot="night"]').get_attribute("aria-pressed") == "true"
    assert page.locator('.now__btn[data-slot="day"]').get_attribute("aria-pressed") == "false"
