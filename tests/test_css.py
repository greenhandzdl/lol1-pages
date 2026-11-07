"""CSS 静态检查。

来历：有一版把 `var(--ink-1)` 用了 8 处，而这个变量根本不存在 ——
`color-mix()` 因此整体失效，首页完成度进度条的轨道直接看不见。
页面不报错、不溢出、JS 也没事，浏览器测试全绿，问题靠肉眼才发现。

所以这里直接读 CSS 源码，把"引用了未定义的变量"变成可自动发现的问题。
"""
import re
from pathlib import Path

import pytest

from conftest import BASE, ROOT

CSS_DIR = ROOT / "assets" / "css"
CSS_FILES = sorted(CSS_DIR.glob("*.css"))

# 引用了但可能定义在别处的变量（例如内联样式里设的）
DEFINE_RE = re.compile(r"(--[\w-]+)\s*:")
# 只匹配"没有 fallback"的引用：var(--x) 危险，var(--x, #fff) 安全
USE_RE = re.compile(r"var\(\s*(--[\w-]+)\s*\)")
# 变量也可能由 JS 内联写在 style="--x: ..." 上，从 JS 里收集
JS_STYLE_RE = re.compile(r"(--[\w-]+)\s*:")


def _js_defined() -> set:
    """JS 里通过 style="--x: ..." 或 setProperty 设的变量。"""
    found = set()
    for p in (ROOT / "assets" / "js").rglob("*.js"):
        found.update(JS_STYLE_RE.findall(p.read_text(encoding="utf-8")))
    return found


def _all_text():
    return {p.name: p.read_text(encoding="utf-8") for p in CSS_FILES}


def test_css_files_found():
    assert CSS_FILES, "一个 CSS 文件都没找到，路径不对"


def test_no_undefined_custom_properties():
    """每个 var(--x) 都要在某个 CSS 文件里被定义过。"""
    texts = _all_text()
    defined = set()
    for t in texts.values():
        defined.update(DEFINE_RE.findall(t))
    defined |= _js_defined()

    missing = {}
    for name, t in texts.items():
        for used in USE_RE.findall(t):
            if used not in defined:
                missing.setdefault(name, set()).add(used)

    assert not missing, (
        "以下变量在 `var(--x)` 里没有 fallback、也从未定义 "
        "(会导致该属性整体失效，且不报错。有 fallback 的引用不算):\n"
        + "\n".join(f"  {k}: {sorted(v)}" for k, v in missing.items())
    )


def test_no_undefined_vars_in_inline_styles():
    """HTML 内联 style 里也可能引用变量。"""
    defined = set()
    for p in CSS_FILES:
        defined.update(DEFINE_RE.findall(p.read_text(encoding="utf-8")))
    defined |= _js_defined()

    html_files = [p for p in ROOT.glob("**/*.html")
                  if ".git" not in p.parts and "node_modules" not in p.parts]
    bad = {}
    for p in html_files:
        used = set(USE_RE.findall(p.read_text(encoding="utf-8")))
        unknown = used - defined
        if unknown:
            bad[str(p.relative_to(ROOT))] = sorted(unknown)

    assert not bad, f"HTML 里引用了未定义变量: {bad}"


@pytest.mark.parametrize("name", ["style.css", "char.css", "shelf.css", "play.css"])
def test_css_braces_balanced(name):
    """括号不配对会让后面所有规则静默失效。"""
    text = (CSS_DIR / name).read_text(encoding="utf-8")
    # 粗略但有效：去掉注释和字符串后再数
    clean = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    clean = re.sub(r'"[^"]*"', "", clean)
    clean = re.sub(r"'[^']*'", "", clean)
    assert clean.count("{") == clean.count("}"), (
        f"{name} 括号不配对: {{ {clean.count('{')} 个, }} {clean.count('}')} 个"
    )


def test_no_dark_theme_gaps():
    """每个自定义属性若在 :root 定义，暗色主题不该漏掉关键的那几个。"""
    style = (CSS_DIR / "style.css").read_text(encoding="utf-8")
    # 找出 [data-theme='dark'] 块里重定义的变量
    dark_blocks = re.findall(
        r"\[data-theme=['\"]dark['\"]\][^{]*\{(.*?)\}", style, re.S
    )
    dark_vars = set()
    for b in dark_blocks:
        dark_vars.update(DEFINE_RE.findall(b))

    # 这几个是主题的核心，暗色必须重定义
    must_override = {"--bg", "--ink"}
    missing = must_override - dark_vars
    assert not missing, f"暗色主题没重定义: {missing}"


# ---------- 对比度 ----------

def _luminance(hex_color: str) -> float:
    """WCAG 相对亮度。"""
    def ch(i):
        v = int(hex_color[i:i + 2], 16) / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5)


def _contrast(a: str, b: str) -> float:
    la, lb = _luminance(a), _luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def _theme_vars(block_start: str) -> dict:
    """从 style.css 里取某个主题块的变量表。"""
    style = (CSS_DIR / "style.css").read_text(encoding="utf-8")
    i = style.index(block_start)
    seg = style[i:style.index("}", i)]
    return {
        m.group(1): m.group(2)
        for m in re.finditer(r"(--[\w-]+):\s*(#[0-9a-fA-F]{6})", seg)
    }


@pytest.mark.parametrize(
    "theme,block",
    [("light", ":root {"), ("dark", '[data-theme="dark"] {')],
)
def test_contrast_tokens(theme, block):
    """正文级文字对背景至少 4.5:1（WCAG AA）。

    这条是纯算术，不需要截图，所以和"不做像素级视觉回归"的决定不冲突。

    来历：--ink-3 原本是 #a98897，对 #fff8f4 只有 3.00:1 —— 用它画的
    小字（完成度标签、画师名、rel__note）在浅色主题下是糊的，
    而浏览器测试、溢出测试、JS 报错全都发现不了。
    """
    v = _theme_vars(block)
    bg = v["--bg"]
    for name in ("--ink", "--ink-2", "--ink-3", "--pink-ink"):
        assert name in v, f"{theme} 缺 {name}"
        ratio = _contrast(v[name], bg)
        assert ratio >= 4.5, f"{theme} {name}={v[name]} 对 --bg={bg} 只有 {ratio:.2f}:1"


def test_contrast_on_surface():
    """卡片底色（--surface-2）上的次要文字也得够 —— 关系卡、标签底色比 --bg 更浅。"""
    v = _theme_vars(":root {")
    for name in ("--ink-2", "--ink-3", "--pink-ink"):
        ratio = _contrast(v[name], v["--surface-2"])
        assert ratio >= 4.5, f"light {name} 对 --surface-2 只有 {ratio:.2f}:1"


def test_stage_viewport_follows_palette(server, page):
    """3D 台换人时，视口背景必须跟着 palette 走（之前是固定粉色渐变）。"""
    page.goto(BASE + "/3d/", wait_until="networkidle")
    page.wait_for_timeout(400)
    first = page.evaluate(
        "() => getComputedStyle(document.querySelector('.stage__viewport')).backgroundImage"
    )
    page.click("#next-btn")
    page.wait_for_timeout(600)
    second = page.evaluate(
        "() => getComputedStyle(document.querySelector('.stage__viewport')).backgroundImage"
    )
    assert first != second, "换人后视口背景没变"


def test_nav_does_not_flicker_on_jitter_scroll(server, page):
    """来回抖动 ±12px 时，吸顶栏的 class 不能每帧翻转。

    实机反馈"navbar 一直在闪"。根因是 nav-collapse.js 原来直接
    `toggle(className, dy > 0)`：触控板/惯性滚动会送进 ±10px 的抖动，
    dy 符号一变 class 就翻，1440px 下 8 次来回滚出了 10101010 ——
    也就是收起/展开动画每帧重播一次，看起来就是闪烁。
    现在改成"同方向累积 DEPTH 像素才认一次方向变化"。
    """
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    seq = page.evaluate("""async () => {
      const h = document.querySelector('.site-header');
      const out = [];
      let y = 400;
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 400));
      for (let i = 0; i < 10; i++) {
        y += (i % 2 === 0 ? 12 : -12);
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 200));
        out.push(h.classList.contains('is-collapsed') ? '1' : '0');
      }
      return out.join('');
    }""")
    assert len(set(seq)) == 1, f"抖动时吸顶栏在反复翻转: {seq}"


def test_nav_still_collapses_on_real_scroll(server, page):
    """修抖动不能把正常行为一起修没：真往一个方向滚，该收就得收。"""
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(500)
    seq = page.evaluate("""async () => {
      const h = document.querySelector('.site-header');
      const at = () => h.classList.contains('is-collapsed') ? '1' : '0';
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const out = [];
      window.scrollTo(0, 0); await wait(500);
      for (let y = 0; y <= 700; y += 70) { window.scrollTo(0, y); await wait(120); }
      await wait(400); out.push(['下滚', at()]);
      for (let y = 700; y >= 100; y -= 70) { window.scrollTo(0, y); await wait(120); }
      await wait(400); out.push(['上滚', at()]);
      window.scrollTo(0, 0); await wait(400); out.push(['顶部', at()]);
      return out;
    }""")
    got = dict(seq)
    assert got['下滚'] == '1', "一路下滚应该收起"
    assert got['上滚'] == '0', "一路上滚应该展开"
    assert got['顶部'] == '0', "回到顶部必须展开"


def test_grain_does_not_replace_page_glow(server, page):
    """颗粒必须挂在没被占用的伪元素上，不能顶掉底色光晕。

    实机反馈"navbar 一直在闪"排查时发现的连带问题：批次 I 把噪点写成
    `body::before`，和原本的底色光晕同选择器同属性，后写的赢 ——
    三条柔和径向渐变被整条吃掉，整站变成纯色 + 噪点。
    """
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    bg = page.evaluate("""() => {
      const s = getComputedStyle(document.body, '::before');
      return { image: s.backgroundImage, z: s.zIndex };
    }""")
    assert "radial-gradient" in bg["image"], "body::before 的底色光晕被覆盖了"

    grain = page.evaluate("""() => {
      const s = getComputedStyle(document.documentElement, '::after');
      return s.backgroundImage;
    }""")
    assert "svg" in grain, "颗粒层不见了"


def test_component_styles_load_on_every_page_that_uses_them(server, page):
    """渲染出来的组件，它的样式必须在当前页加载的 CSS 里。

    这个坑今天踩了两次：
      · .traitCmp 写进 char.css，但 /play/ 只加载 play.css —— 对照条宽度为 0
      · .traits  写进 char.css，但首页只加载 style.css —— 弹窗里的性格条没样式
    两次都是"看着有 DOM、实际没样式"，肉眼在截图里不明显，测试里也不好发现。
    所以这里改成按页面核对：组件出现了，它所在的样式文件就必须被加载。
    """
    checks = [
        ("/", ".traits", "assets/css/style.css"),
        ("/play/", ".traitCmp", "assets/css/play.css"),
        ("/c/sakura/", ".traits", "assets/css/style.css"),
    ]
    for path, selector, css in checks:
        page.goto(BASE + path, wait_until="networkidle")
        hrefs = page.evaluate(
            "() => [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'))"
        )
        assert any(css in (h or "") for h in hrefs), f"{path} 没有加载 {css}，{selector} 会没有样式"


def test_no_stray_top_level_braces():
    """CSS 里不能有落单的 `}`。

    括号配对检查（数 { 和 } 的个数）抓不住这个：多一个 } 配一个 }，
    数量仍然相等。但多出来的那个会**提前闭合前面的规则**，把紧随其后的
    规则甩到选择器外面，整块静默失效 —— 浏览器不报错，页面只是少了一块样式。

    实际踩过：一次编辑多留了一个 `}`，`.icon-btn` 的整条基础规则被甩出去，
    GitHub 图标和主题按钮都变回没有样式的裸元素（主题按钮甚至变回
    浏览器默认的方块按钮），而括号配对检查全绿。

    这里扫描「顶层出现非法字符」：在 depth==0 的位置只允许出现
    选择器、at-rule 或注释，出现孤立的 `}` 或裸声明就是错的。
    """
    import re
    import pathlib

    problems = []
    for f in sorted(pathlib.Path("assets/css").glob("*.css")):
        src = f.read_text(encoding="utf-8")
        # 去掉注释和字符串，避免误判
        src = re.sub(r"/\*[\s\S]*?\*/", "", src)
        src = re.sub(r'"[^"]*"|\'[^\']*\'', "", src)

        depth = 0
        for i, ch in enumerate(src):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth < 0:
                    line = src[:i].count("\n") + 1
                    problems.append(f"{f.name}:{line} 多余的 }}")
                    depth = 0
        if depth:
            problems.append(f"{f.name} 结尾还有 {depth} 个 {{ 没闭合")

        # 顶层裸声明：在 depth==0 出现 "xxx: yyy;" 而前面没有选择器
        depth = 0
        buf = ""
        for ch in src:
            if ch == "{":
                depth += 1
                buf = ""
            elif ch == "}":
                depth = max(0, depth - 1)
                buf = ""
            else:
                if depth == 0:
                    buf += ch
                    if ";" in buf:
                        stmt = buf.strip()
                        if re.search(r"^[a-z-]+\s*:", stmt):
                            problems.append(f"{f.name} 顶层出现裸声明：{stmt[:60]}")
                        buf = ""

    assert not problems, "CSS 结构有问题：\n  " + "\n  ".join(problems)
