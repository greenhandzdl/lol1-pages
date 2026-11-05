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
