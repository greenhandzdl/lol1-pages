"""元素图形与 accent 色的静态检查。

这两个文件是"错了完全看不出来"的重灾区：
  · 图形画错一个字符，SVG 仍然合法，页面上只是少一条线；
  · accent 算错，颜色照样渲染，只是对比度掉到 2:1；
  · mask 里的 SVG 少一个 xmlns，整张图被丢弃、只剩一个灰方块。
所以这里直接读源码算，不靠浏览器。
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GLYPHS = ROOT / "assets/js/glyphs.js"


def _node(script: str):
    """跑一段 Node，把 JS 模块的真实结果拿回来 —— 避免在 Python 里重写一遍算法。"""
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT, capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _data():
    return json.loads((ROOT / "assets/data/characters.json").read_text(encoding="utf-8"))["characters"]


def test_every_element_has_a_glyph():
    """数据里出现的每个元素都得有图形 —— 少一个，那一格就是空白。"""
    elements = sorted({c["element"] for c in _data()})
    have = _node("import('./assets/js/glyphs.js').then(m => console.log(JSON.stringify(m.ELEMENTS)))")
    missing = [e for e in elements if e not in have]
    assert missing == [], f"这些元素没有对应图形: {missing}"


def test_no_orphan_glyph():
    """反过来也要查：画了却没人用的图形，是删剩的垃圾，会让人以为加了新元素。"""
    elements = {c["element"] for c in _data()}
    have = _node("import('./assets/js/glyphs.js').then(m => console.log(JSON.stringify(m.ELEMENTS)))")
    orphans = [e for e in have if e not in elements]
    assert orphans == [], f"这些图形没有角色在用: {orphans}"


def test_glyph_paths_are_safe_to_inline():
    """图形会被直接拼进 HTML / 内联 SVG，不能带脚本或事件属性。"""
    src = GLYPHS.read_text(encoding="utf-8")
    body = src[src.index("export const GLYPHS"):src.index("};", src.index("export const GLYPHS"))]
    assert "<script" not in body.lower()
    assert not re.search(r"\son[a-z]+\s*=", body), "图形里出现了 on* 事件属性"
    assert "javascript:" not in body.lower()


def test_glyph_paths_stay_in_canvas():
    """所有绝对坐标（M/L/C 后面的成对数字）落在 0–24 内。

    只查绝对坐标：`c`/`m`/`a` 后面的相对偏移天然可能是负数（"-6.2 0" 就是从
    当前点往左走 6.2），拿它们判越界会全员误报 —— 第一版就是这么写的，
    一跑 10 个图形全红，原因是我把相对偏移当绝对坐标了。
    """
    res = _node("""
      import('./assets/js/glyphs.js').then(m => {
        const out = {};
        for (const [name, body] of Object.entries(m.GLYPHS)) {
          const bad = [];
          // 只取 M / L / C 段里的绝对坐标对
          for (const seg of body.matchAll(/[MLC]((?:\\s*-?\\d+(?:\\.\\d+)?){2,})/g)) {
            const nums = seg[1].trim().split(/\\s+/).map(Number);
            for (const n of nums) if (n < 0 || n > 24) bad.push(n);
          }
          if (bad.length) out[name] = bad;
        }
        console.log(JSON.stringify(out));
      });
    """)
    assert res == {}, f"这些图形的绝对坐标越界（会被 viewBox 裁掉）: {res}"


def test_accent_contrast_light_and_dark():
    """派生出来的 accent 必须真的能当文字用（浅色 ≥4.5:1，深色 ≥4.5:1）。"""
    res = _node("""
      Promise.all([import('./assets/js/accent.js'), import('node:fs')]).then(([A, fs]) => {
        const cs = JSON.parse(fs.readFileSync('assets/data/characters.json', 'utf8')).characters;
        console.log(JSON.stringify(cs.map(c => ({
          id: c.id,
          ink: A.contrast(A.inkFor(c.palette[0], c.palette[1]), '#fff8f4'),
          glow: A.contrast(A.glowFor(c.palette[0], c.palette[1]), '#1c1420'),
        }))));
      });
    """)
    bad = [r for r in res if r["ink"] < 4.5 or r["glow"] < 4.5]
    assert bad == [], f"accent 对比度不足: {bad}"


def test_accent_keeps_characters_distinguishable():
    """12 个 accent 不能糊成一大片。

    实测压到 4.5:1 时，樱井小春和花音的通道最大差值只有 2/255 ——
    两个页面看起来是同一个色调，"每人一个色"就成了空话。

    但也不能要求 12 个人两两都拉开：书织（#e8e1d6 / #b8a894）和奶油
    （#fff0e2 / #ffc9a3）的 palette 本来就是同一个灰杏色，硬掰开等于
    给奶油凭空换一个色 —— 这比撞色更假。所以按"亲戚组"分组检查：
    组内刻意接近是设计（都是暖杏系），跨组必须拉得开。
    """
    res = _node("""
      Promise.all([import('./assets/js/accent.js'), import('node:fs')]).then(([A, fs]) => {
        const cs = JSON.parse(fs.readFileSync('assets/data/characters.json', 'utf8')).characters;
        const hue = (h) => {
          const [r, g, b] = A.hexToRgb(h).map(v => v / 255);
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
          if (!d) return 0;
          let x;
          if (mx === r) x = ((g - b) / d) % 6;
          else if (mx === g) x = (b - r) / d + 2;
          else x = (r - g) / d + 4;
          return (x * 60 + 360) % 360;
        };
        console.log(JSON.stringify(cs.map(c => ({
          id: c.id, hue: hue(A.inkFor(c.palette[0], c.palette[1])),
        }))));
      });
    """)
    # 同一色系（数据里 palette 本身就接近）允许撞色
    FAMILIES = [
        {"shiori", "cream", "chacha", "suzuka", "yayoi"},   # 暖杏 / 棕
        {"sakura", "kanon"},                                 # 粉
        {"umi", "hibari", "yukino"},                         # 冷蓝
        {"mio"}, {"mint"},
    ]
    family_of = {cid: i for i, fam in enumerate(FAMILIES) for cid in fam}
    worst_cross = (999, None)
    for i in range(len(res)):
        for j in range(i + 1, len(res)):
            a, b = res[i]["id"], res[j]["id"]
            if family_of.get(a) == family_of.get(b):
                continue
            d = abs(res[i]["hue"] - res[j]["hue"])
            d = min(d, 360 - d)
            if d < worst_cross[0]:
                worst_cross = (d, f"{a}/{b}")
    assert worst_cross[0] >= 20, (
        f"{worst_cross[1]} 的 accent 色相只差 {worst_cross[0]:.1f}°，"
        "跨色系撞成了同一个颜色"
    )


def test_mask_svg_has_namespace():
    """CSS mask 用的 SVG 少了 xmlns 会被整张丢弃 —— 页面上只剩一个灰色方块。"""
    mask = _node("""
      import('./assets/js/glyphs.js').then(m =>
        console.log(JSON.stringify(decodeURIComponent(
          m.glyphMask('花').replace(/^url\\("data:image\\/svg\\+xml,/, '').replace(/"\\)$/, '')))));
    """)
    assert mask.startswith("<svg")
    assert 'xmlns="http://www.w3.org/2000/svg"' in mask
    # 描边不能是 currentColor：mask 图里取不到继承色，会变成 none，图形直接消失
    assert "currentColor" not in mask
    assert 'stroke="#000"' in mask
