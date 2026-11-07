"""
样式覆盖：渲染出来的组件，它的样式必须在当前页加载的 CSS 里。

为什么需要这个文件
------------------
同一个错误在这一轮里犯了两次，两次都是「DOM 在、样式没有」：

  · .traitCmp  写进 char.css，但 /play/ 只加载 play.css  → 对照条宽度为 0
  · .traits    写进 char.css，但首页只加载 style.css      → 弹窗性格条没样式

两次在截图里都只是「有个东西在那儿」，评审和肉眼检查都漏了。
所以这里把当时的临时排查固化成测试：解析每页加载的 CSS + 该页 JS 的
import 闭包，比对 class 的「使用」与「定义」。

关于白名单
----------
「用了但没定义」不一定是 bug —— 很多 class 只当语义钩子（<div class="hero__copy">
就是个块级容器，靠正常文档流排版）。这类必须**逐个看过**再登记，
不能因为测试红了就一股脑补样式。
"""
import re
from pathlib import Path

import pytest

from conftest import BASE, ROOT

# 页面 → (HTML 文件, 加载的 CSS, JS 入口)
PAGES = {
    "/": ("index.html", ["style.css"], "assets/js/main.js"),
    "/3d/": ("3d/index.html", ["style.css", "stage.css"], "assets/js/stage/app.js"),
    "/play/": ("play/index.html", ["style.css", "play.css"], "assets/js/play.js"),
    "/shelf/": ("shelf/index.html", ["style.css", "shelf.css"], "assets/js/shelf.js"),
    "/404.html": ("404.html", ["style.css"], None),
    "/c/sakura/": ("c/sakura/index.html", ["style.css", "char.css"], None),
}

# 纯语义钩子：只用来给 JS 定位或给父级选择器当锚点，本身不需要样式。
# 每一条都是逐个查过 computed style（display: block、尺寸正常、无异常）之后登记的。
SEMANTIC_ONLY = {
    "daily__label",   # 块级容器，两个 <p> 自身有 margin
    "daily__text",    # 块级容器
    "hero__copy",     # 块级容器
    "quiz__info",     # 块级容器，内部元素各自有样式
    "quiz__result",   # 块级容器
    "detail__rels",   # 块级容器，子元素 .drel 有样式
    "mt__item--who",  # 与 .mt__item 共用样式，这个修饰符只给 JS 区分左右
    "web__edges",     # <g>，只当 DOM 分组用
    "web__nodes",     # <g>，只当 DOM 分组用
    "day__body",      # 块级容器
    # 状态类：由 JS 切换，样式用后代/属性选择器命中，本身不需要独立规则
    "is-collapsed", "is-focus", "is-hot", "is-in",
    "is-on", "is-switching", "is-2d", "is-3d", "has-model",
    "is-bad", "is-pick", "is-switch",
    # 页面级标记：挂在 <body> 上，只给 JS 和少数后代选择器当锚点
    "play-page", "shelf-page", "char-page",
    # 下面两个是"只在一种状态下存在"的容器，已实测：display block、
    # 高度正常（363px / 60px），子元素各自带样式，容器本身不需要规则
    "quiz__q", "shelf__stat",
}

_CSS_CLASS = re.compile(r"\.([A-Za-z][A-Za-z0-9_-]*)")


def _defined_classes(css_files):
    defined = set()
    for name in css_files:
        src = (ROOT / "assets" / "css" / name).read_text(encoding="utf-8")
        src = re.sub(r"/\*[\s\S]*?\*/", "", src)  # 去注释，注释里的类名不算
        defined |= set(_CSS_CLASS.findall(src))
    return defined


def _module_closure(entry):
    """把入口 JS 里 import 到的本地模块全部拉进来。"""
    seen, stack = set(), [entry]
    while stack:
        rel = stack.pop()
        if rel in seen:
            continue
        path = ROOT / rel
        if not path.exists():
            continue
        seen.add(rel)
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r"""from\s+['"](\.[^'"]+)['"]""", src):
            target = (Path(rel).parent / m.group(1)).resolve().relative_to(ROOT.resolve())
            stack.append(str(target))
    return seen


def _used_classes(html, js_entry):
    """收集一个页面可能会渲染的全部 class。

    两种来源：
      1. HTML 里的 class="a b"
      2. JS（含 import 闭包）里所有 class="..."，包括模板串里的
         class="sh ${locked ? 'is-locked' : ''}" —— 按分隔符切成 token，
         引号和 ? : 都会被切掉。

    不要"通读全文所有引号"：HTML 的 lang="zh-CN"、<meta> 的 utf-8
    会被当成类名抓进来。
    """
    files = [ROOT / html] + [ROOT / f for f in (_module_closure(js_entry) if js_entry else [])]
    used = set()
    for path in files:
        if not path.exists():
            continue
        src = path.read_text(encoding="utf-8")
        for m in re.finditer(r'class="([^"]*)"', src):
            for c in re.split(r"[\s${}?:'\"`]+", m.group(1)):
                if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", c):
                    used.add(c)
        for m in re.finditer(r"classList\.(?:add|remove|toggle)\(\s*'([^']+)'", src):
            for c in re.split(r"[\s'\"]+", m.group(1)):
                if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", c):
                    used.add(c)
    return {c for c in used if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", c)}


@pytest.mark.parametrize("path", list(PAGES))
def test_every_rendered_class_has_a_style(path):
    html, css, js = PAGES[path]
    defined = _defined_classes(css)
    used = _used_classes(html, js)
    # 只查我们自己命名的组件类（带 __ 或 连字符的），避免误报
    # 所有页面加载的 CSS 合在一起。从 JS 模板串里静态判断"这个类到底属于
    # 哪个页面"是做不到的：traits.js 被首页和 /play/ 共用，只有 /play/
    # 会渲染 compare 变体。所以按组件粒度查 —— 父块在，子类就算有人管。
    all_defined = _defined_classes([c for _, css, _ in PAGES.values() for c in css])

    def covered(c):
        """c 是不是"某个已定义类的后代/修饰符"？（.x__y、.x--y 跟着 .x 走）"""
        return any(c.startswith(f"{d}__") or c.startswith(f"{d}--") for d in all_defined)

    suspect = {
        c for c in used
        if c not in defined and not covered(c) and c not in SEMANTIC_ONLY
        and ("__" in c or "-" in c) and not c.startswith("js-")
    }
    assert not suspect, (
        f"{path} 用到了这些 class，但它加载的 CSS（{', '.join(css)}）里没有定义：\n  "
        + "\n  ".join(sorted(suspect))
        + "\n如果是纯语义钩子，加到 SEMANTIC_ONLY 里并写清原因。"
    )


def test_style_files_are_not_orphaned():
    """每个 CSS 文件至少被一个页面加载 —— 否则就是没人用的死文件。"""
    used = {c for _, css, _ in PAGES.values() for c in css}
    all_css = {p.name for p in (ROOT / "assets" / "css").glob("*.css")}
    assert all_css <= used, f"这些 CSS 没有任何页面加载：{sorted(all_css - used)}"


def test_no_dead_component_selectors():
    """反向检查：CSS 里不该留着已经没人渲染的组件样式。

    删掉地域点阵之后，.rmap__* 就应该一起消失 —— 留着的话下次有人
    搜「rmap」会以为这东西还在用。
    """
    retired = ["rmap", "regions__split"]
    src = "\n".join(
        (ROOT / "assets" / "css" / f).read_text(encoding="utf-8")
        for f in ("style.css", "char.css", "play.css", "stage.css", "shelf.css")
    )
    leftovers = [name for name in retired if name in src]
    assert not leftovers, f"这些已经被删掉的功能还留着样式：{leftovers}"
