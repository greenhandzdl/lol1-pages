/**
 * nav-spy.js — 导航栏标出「你现在在哪一段」
 *
 * 首页的导航里混着两种东西：
 *   · #gallery #regions #about #policy  —— 本页的四段
 *   · 3d/ shelf/ play/                  —— 另外三个页面
 *
 * 后一种靠 aria-current="page" 标出（见 style.css）。前一种没人管 ——
 * 滚到「地域」那一段，导航栏毫无反应，看不出自己在哪。
 *
 * 这一条负责给页内的那几段打 aria-current="true"。
 *
 * 为什么不是「谁最靠近视口顶部就是谁」：这样在段与段之间会来回跳，
 * 而且在页面底部，最后几段根本进不了视口顶部。改成看**视口顶部往下
 * 一条线**（不用 0，因为吸顶栏占了 --nav-h）落在哪一段里。
 *
 * 为什么不用 IntersectionObserver：它只告诉你某段的可见比例变化，
 * 而我们要的是「顶部这条线穿过谁」，用 observer 反推要维护一堆状态，
 * 反而不如直接读 getBoundingClientRect 清楚。段数只有四个，开销可忽略。
 */

/** 顶部判定线再多下移一点，让「刚滚进这一段」比「刚好压线」更早成立 */
const LINE_OFFSET = 8;
/** 滚到最底下时，强行选中最后一段 —— 否则短的最后一段可能永远选不中 */
const BOTTOM_SLACK = 4;

export function spyNav() {
  const links = Array.from(document.querySelectorAll('.nav__link[data-spy]'));
  if (!links.length) return;

  // data-spy 的值就是 section 的 id
  const sections = links
    .map((a) => ({ link: a, el: document.getElementById(a.dataset.spy) }))
    .filter((s) => s.el);
  if (!sections.length) return;

  // 吸顶栏高度从 CSS 变量读，别在这里写死 72
  const navH =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 72;

  let current = null;
  let ticking = false;

  const apply = (active) => {
    if (active === current) return;
    current = active;
    for (const { link } of sections) {
      if (link === active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };

  const update = () => {
    ticking = false;

    // 判定线放在哪，不能拍脑袋用 --nav-h。
    // 首页给 section 设了 scroll-padding-top: 88px，点导航或跳到锚点之后，
    // 目标段的 top 正好落在 88 —— 线要是画在 80，就穿不到它，停在上一段。
    // 所以从样式里读实际值，再往下让一点。
    const root = document.documentElement;
    const pad = parseFloat(getComputedStyle(root).scrollPaddingTop);
    const line = (Number.isFinite(pad) && pad > navH ? pad : navH) + LINE_OFFSET;

    // 每一段的"辖区"从它自己开始，到下一段开始为止。
    // 段与段之间夹着不在导航里的内容（今日一句、关系网…），
    // 那些内容归前一段管 —— 否则滚到中间地带会一条都不亮，
    // 或者提前亮起下一段，两种都像坏了。
    const tops = sections.map(({ el }) => el.getBoundingClientRect().top + window.scrollY);
    const atBottom =
      window.innerHeight + window.scrollY >= root.scrollHeight - BOTTOM_SLACK;

    let active = null;
    if (atBottom) {
      active = sections[sections.length - 1].link;
    } else {
      // 线还没到第一段 → 首页开头是 hero，不属于任何一段，不标。
      const cursor = window.scrollY + line;
      for (let i = 0; i < tops.length; i++) {
        const nextTop = i + 1 < tops.length ? tops[i + 1] : Infinity;
        if (cursor >= tops[i] && cursor < nextTop) {
          active = sections[i].link;
          break;
        }
      }
    }
    apply(active);
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // 图片加载完会改变文档高度，底部判定要重算一次
  window.addEventListener('load', update, { once: true });
  update();
}
