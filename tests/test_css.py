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
