"""数据层断言。

check-data.mjs 是写内容时的守门员（构建期跑），这里是发布前的复核：
从"页面能不能正常工作"的角度看数据，而不是从"字段填没填"。
"""
import json
from pathlib import Path

import pytest

from conftest import ROOT

DATA = ROOT / "assets" / "data" / "characters.json"
QUIZ = ROOT / "assets" / "data" / "quiz.json"

TRAITS = ["温柔", "体贴", "活泼", "安静", "好奇", "独立"]


def test_characters_json_valid():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    assert "characters" in data
    assert len(data["characters"]) == 12


def test_required_fields(chars):
    required = ["id", "name", "nameEn", "title", "tagline", "bio",
                "region", "element", "tags", "image", "palette", "traits"]
    for c in chars:
        missing = [f for f in required if f not in c or c[f] in (None, "", [])]
        assert not missing, f"{c['id']} 缺字段: {missing}"


def test_ids_unique(chars):
    ids = [c["id"] for c in chars]
    assert len(ids) == len(set(ids)), f"id 重复: {ids}"
    names = [c["name"] for c in chars]
    assert len(names) == len(set(names)), f"名字重复: {names}"


def test_files_exist(chars):
    """插画和三档 srcset 都要真的存在 —— 路径写错线上才 404。"""
    for c in chars:
        base = ROOT / c["image"]
        assert base.exists(), f"{c['id']} 原图不存在: {c['image']}"
        stem = str(base).removesuffix(".webp")
        for w in ("400", "600"):
            p = Path(f"{stem}-{w}.webp")
            assert p.exists(), f"{c['id']} 缺 {w} 档: {p.name}"


def test_relations_resolve(chars):
    """关系必须指向真实存在的人，且不能指自己。"""
    ids = {c["id"] for c in chars}
    for c in chars:
        for r in c.get("relations", []):
            assert r["id"] in ids, f"{c['id']} 指向不存在的人 {r['id']}"
            assert r["id"] != c["id"], f"{c['id']} 指向自己"


def test_relations_bidirectional(chars):
    """关系应当双向。单向不致命，但多半是漏写，所以这里直接拦。"""
    by_id = {c["id"]: c for c in chars}
    problems = []
    for c in chars:
        for r in c.get("relations", []):
            back = [x["id"] for x in by_id[r["id"]].get("relations", [])]
            if c["id"] not in back:
                problems.append(f"{c['id']} → {r['id']} 但没回指")
    assert not problems, f"单向关系: {problems}"


def test_relation_kinds(chars):
    allowed = {"邻居", "挚友", "常客", "师承", "同好", "旧识"}
    for c in chars:
        for r in c.get("relations", []):
            assert r["kind"] in allowed, f"{c['id']} 关系类型非法: {r['kind']}"


def test_bio_length(chars):
    """bio 太短说明内容还没写够 —— 这是内容项目，不是字段项目。"""
    for c in chars:
        n = len(c["bio"])
        assert n >= 150, f"{c['id']} bio 只有 {n} 字"


def test_traits_complete(chars):
    """性格测试依赖 traits，缺维度会算出 NaN。"""
    for c in chars:
        t = c.get("traits", {})
        missing = [k for k in TRAITS if k not in t]
        assert not missing, f"{c['id']} 缺性格维度: {missing}"
        for k in TRAITS:
            assert isinstance(t[k], int) and 0 <= t[k] <= 3, \
                f"{c['id']}.{k} 超出 0-3: {t[k]}"


def test_regions_unique(chars):
    """地域是一对一的：一个人一个地方，重复会让地名配对游戏出错。"""
    regions = [c["region"] for c in chars]
    assert len(regions) == len(set(regions)), f"地域重复: {regions}"


def test_quiz_matches_characters(chars):
    """题库里提到的维度必须都存在于角色 traits 中。"""
    quiz = json.loads(QUIZ.read_text(encoding="utf-8"))
    assert quiz["traits"] == TRAITS, "题库维度与测试不一致"
    for qi, q in enumerate(quiz["questions"]):
        assert len(q["options"]) == 4, f"第 {qi} 题选项数不是 4"
        for oi, o in enumerate(q["options"]):
            for k in o["w"]:
                assert k in TRAITS, f"第 {qi} 题选项 {oi} 用了未知维度 {k}"


def test_every_character_reachable(chars):
    """每位角色都要"测得出来"。

    做法：模拟一个完全贴合某人的答题者 —— 每题选让相似度最高的选项，
    看最终结果是不是回到这个人。不是的话说明有人的画像被另一个人遮住了，
    在测试里永远出现不了。
    """
    quiz = json.loads(QUIZ.read_text(encoding="utf-8"))
    questions = quiz["questions"]

    def cosine(a, b):
        dot = sum(a[k] * b[k] for k in TRAITS)
        na = sum(a[k] ** 2 for k in TRAITS) ** 0.5
        nb = sum(b[k] ** 2 for k in TRAITS) ** 0.5
        return dot / (na * nb) if na and nb else 0.0

    def tally(answers):
        v = {k: 0 for k in TRAITS}
        for qi, oi in enumerate(answers):
            for k, x in questions[qi]["options"][oi]["w"].items():
                v[k] += x
        return v

    def best(vec):
        # 并列时取第一个，与 JS 侧 `if (s > bs)` 的严格比较保持一致。
        # 用 max(..., key=) 也会取第一个，但下面的答案选择不能用 max(tuple)，
        # 那会在相似度并列时按选项序号比大小，选出最后一个。
        return max(chars, key=lambda c: cosine(vec, c["traits"]))["id"]

    unreachable = []
    for target in chars:
        answers = []
        for qi in range(len(questions)):
            best_oi, best_sim = 0, -1.0
            for oi in range(len(questions[qi]["options"])):
                sim = cosine(tally(answers + [oi]), target["traits"])
                if sim > best_sim:        # 严格大于 = 并列取先出现的
                    best_oi, best_sim = oi, sim
            answers.append(best_oi)
        got = best(tally(answers))
        if got != target["id"]:
            unreachable.append(f"{target['id']} → {got}")

    assert not unreachable, f"这些角色永远测不出来: {unreachable}"


# ---------- 主题（首页筛选用）----------

THEMES = ["花与四季", "星光与咒语", "茶与甜点", "书页与静默", "海风与高处", "街角的熟客", "认真做一件小事"]


def test_themes_in_vocab(chars):
    """主题必须是受控词表里的值，且每人 2~3 个。

    来历：首页筛选用的是 tags —— 35 个标签里 34 个只对应一个人，
    点一下等于点名，筛选形同虚设。换成主题之后，"筛选"才有意义。
    """
    for c in chars:
        themes = c.get("themes")
        assert themes, f"{c['id']} 没有 themes"
        assert 2 <= len(themes) <= 3, f"{c['id']} themes 为 {len(themes)} 个（应 2~3）"
        for t in themes:
            assert t in THEMES, f"{c['id']} 主题「{t}」不在词表里"


def test_themes_coverage(chars):
    """每个主题至少 3 个人 —— 只有两个人的"主题"点进去还是像点名。"""
    for t in THEMES:
        n = sum(1 for c in chars if t in c.get("themes", []))
        assert n >= 3, f"主题「{t}」只有 {n} 人"


def test_themes_stable_order(chars):
    """词表里每个主题都得有人用，别留下死条目。"""
    used = {t for c in chars for t in c.get("themes", [])}
    assert used == set(THEMES), f"词表与实际使用不一致: 未使用 {set(THEMES) - used}"


def test_chip_counts_match_data(chars):
    """首页芯片上写的人数必须等于实际能筛出来的人数。

    这条是防"改数据忘了重建"：index.html 里的 noscript 兜底和
    chips 都由数据算出，数字对不上说明有地方没跟上。
    """
    home = (ROOT / "index.html").read_text(encoding="utf-8")
    for t in THEMES:
        n = sum(1 for c in chars if t in c.get("themes", []))
        assert f"<b>{t}</b>" in home, f"index.html 的 noscript 兜底里没有主题「{t}」"
        # 兜底列表里这一项应该正好有 n 个链接
        seg_start = home.index(f"<b>{t}</b>")
        seg_end = home.index("</li>", seg_start)
        links = home[seg_start:seg_end].count('href="c/')
        assert links == n, f"index.html 里「{t}」列了 {links} 人，数据里是 {n} 人（忘了 npm run pages？）"


# ---------- story / day（本轮新增的内容字段）----------

DAY_SLOTS = ["早晨", "白天", "傍晚", "夜里"]


def _bigrams(text: str) -> set:
    s = "".join(text.split())
    return {s[i:i + 2] for i in range(len(s) - 1)}


def test_story_length(chars):
    """story 是"一个小场景"，太短就退化成了 tagline。

    和 bio 分开写是有意的：bio 可以概括（她是怎样的人），
    story 必须具体到某一天、某一级台阶、某一页被折过的角。
    """
    for c in chars:
        n = len(c.get("story", ""))
        assert n >= 100, f"{c['id']} story 只有 {n} 字"


def test_story_not_repeating_bio(chars):
    """story 与 bio 的字二元组重合率要低 —— 高了就是复制粘贴。"""
    bad = []
    for c in chars:
        a, b = _bigrams(c["bio"]), _bigrams(c["story"])
        rate = len(a & b) / max(len(b), 1)
        if rate > 0.6:
            bad.append(f"{c['id']} {rate:.0%}")
    assert not bad, f"story 与 bio 重合过多: {bad}"


def test_day_slots(chars):
    """「她的一天」必须恰好四段，时段固定且有序，每段有标题和正文。"""
    for c in chars:
        day = c.get("day")
        assert isinstance(day, list) and len(day) == 4, f"{c['id']} day 不是 4 段"
        assert [d["time"] for d in day] == DAY_SLOTS, f"{c['id']} day 时段或顺序不对"
        for i, d in enumerate(day):
            assert d.get("title"), f"{c['id']} day[{i}] 缺 title"
            assert len(d.get("text", "")) >= 20, f"{c['id']} day[{i}] 正文太短"


def test_bio_raised_to_300(chars):
    """bio 这一轮从均值 189 扩到 300+，掉回去说明改动被覆盖了。"""
    short = [(c["id"], len(c["bio"])) for c in chars if len(c["bio"]) < 300]
    assert not short, f"这些角色 bio 不足 300 字: {short}"


def test_habits_unique(chars):
    """小习惯是"她和别人不一样的地方"，两个人一样就没意思了。"""
    habits = [c["habit"] for c in chars]
    assert len(habits) == len(set(habits)), "有小习惯重复"


def test_day_slot_titles_reasonably_unique(chars):
    """同一时段里，12 个人的标题不该大面积撞车（撞了就说明是模板凑的）。"""
    for slot_i, slot in enumerate(DAY_SLOTS):
        titles = [c["day"][slot_i]["title"] for c in chars]
        dup = [t for t in set(titles) if titles.count(t) > 1]
        assert not dup, f"「{slot}」时段标题重复: {dup}"




# ---------- voice（第一人称台词） ----------

def test_voice_exists_for_everyone(chars):
    """没有 voice 的角色，页面上就少一整块「她说过的话」。"""
    missing = [c["id"] for c in chars if not c.get("voice")]
    assert missing == [], f"这些角色没有 voice: {missing}"


def test_voice_is_first_person_and_distinct(chars):
    """voice 必须是三条、且不能和 tagline 撞。

    三条不是风格偏好，是结构上的区别：bio/story 是别人转述，
    voice 得是她自己说。太长会撑爆区块高度。
    """
    for c in chars:
        v = c.get("voice") or []
        assert len(v) == 3, f"{c['id']} 的 voice 有 {len(v)} 条，应该是 3"
        for line in v:
            assert 6 < len(line) <= 40, f"{c['id']} 的台词长度 {len(line)} 超出 6–40"
            assert line.strip() != c["tagline"].strip(), f"{c['id']} 的 voice 和 tagline 一模一样"


def test_voice_lines_are_unique_within_character(chars):
    """同一角色内的重复台词，多半是复制粘贴时没改干净。"""
    for c in chars:
        v = c.get("voice") or []
        assert len(set(v)) == len(v), f"{c['id']} 的 voice 里有重复台词"


def test_check_data_accepts_voice_field():
    """构建期的校验器必须认识 voice —— 新字段不进 REQUIRED，拼错也不会被发现。

    实测踩过：voice 加进数据后，check-data 一路绿灯，
    因为 REQUIRED 里没有它，字段拼错（voic / Voice）也不会报错。
    """
    src = (ROOT / "scripts/check-data.mjs").read_text(encoding="utf-8")
    required = src[src.index("const REQUIRED = ["):src.index("];", src.index("const REQUIRED = ["))]
    assert "'voice'" in required, "REQUIRED 里没有 voice：拼错的字段名不会被发现"
