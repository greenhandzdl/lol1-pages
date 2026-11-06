/**
 * nav-collapse.js — 吸顶栏滚动收起
 *
 * 手机上一行 logo + 一行导航把吸顶栏顶到 ~92px，占了将近 11% 的可视高度。
 * 往下滚（看内容）时收起导航行，只留 logo 和图标；往回滚（找人）时再放出来。
 *
 * 独立成模块的原因：首页（main.js）和角色页（char-page.js）都要用。
 * 为了这一个行为去加载 main.js 整包（图鉴渲染、收藏、搜索…）不值得。
 *
 * 动画交给 CSS（.is-collapsed），JS 只切 class，避免滚动时每帧改样式。
 *
 * —— 为什么要有"方向累积"和"迟滞"——
 *
 * 最早的版本是 `toggle(className, dy > 0)`：只要这一帧位移是正的就收，
 * 负的就展。两个问题：
 *
 * 1. 触控板和惯性滚动会送进 ±8~15px 的来回抖动（手指停住时尤其明显），
 *    于是 class 每帧翻转一次 —— 导航栏一直在闪。实测 1440px 下 ±12px
 *    来回滚 8 次，class 序列是 10101010。
 * 2. JITTER 过滤原先是"小于 6px 直接 return 但不更新 lastY"，
 *    单帧看起来没问题，可是 dy 的正负号本身没被过滤 —— 抖动幅度一过 6px
 *    就照样翻转。
 *
 * 现在改成：把同一个方向的位移累积起来，超过 DEPTH 才认一次方向变化；
 * 并且两条判定线不对称（收起容易、展开难一点），也就是迟滞。
 */

const THRESHOLD = 120; // 太靠顶部就别收，避免刚滚动就跳
const DEPTH = 40; // 同方向要累积这么多像素才算"真的在往那边滚"
const SETTLE = 160; // 停下这么久之后，把累积的方向清零

export function collapseNav() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  let lastY = window.scrollY;
  let ticking = false;

  // 当前正在累积的方向：+1 向下、-1 向上、0 还没定
  let dir = 0;
  let acc = 0;
  let settleTimer = 0;

  const setCollapsed = (on) => {
    if (header.classList.contains('is-collapsed') === on) return;
    header.classList.toggle('is-collapsed', on);
  };

  const update = () => {
    const y = Math.max(0, window.scrollY);
    const dy = y - lastY;
    lastY = y;
    ticking = false;

    // 靠近顶部一律展开 —— 先判这个，别被下面的累积逻辑挡掉，
    // 否则贴着顶部往回滚也展不开。
    if (y <= THRESHOLD) {
      dir = 0;
      acc = 0;
      setCollapsed(false);
      return;
    }

    if (dy === 0) return;

    const sign = dy > 0 ? 1 : -1;

    // 方向反了：换方向从零开始累积。不把反向的位移减到旧累积上，
    // 否则一次大幅回弹会把累积拉回原点，等于没判断。
    if (sign !== dir) {
      dir = sign;
      acc = 0;
    }
    acc += Math.abs(dy);

    // 还没攒够一个"像样"的位移，先不动 class
    if (acc < DEPTH) {
      scheduleSettle();
      return;
    }

    acc = 0;
    // 迟滞：向下滚容易收（DEPTH），向上滚要多攒一段才展。
    // 收起只是少一行导航，误触代价小；展开会把内容往下推，误触更烦。
    if (dir > 0) setCollapsed(true);
    else setCollapsed(false);
    scheduleSettle();
  };

  // 停下之后把方向清掉：下次开始滚动时重新判断，
  // 而不是沿用上一次的方向去解释第一帧的位移。
  const scheduleSettle = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      dir = 0;
      acc = 0;
    }, SETTLE);
  };

  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    },
    { passive: true },
  );

  // 收起后导航项全没了，只能靠「往上滚」找回，不够明显。
  // 点 logo 在收起状态下先展开并回到顶部，而不是直接跳转。
  const logo = header.querySelector('.logo');
  logo?.addEventListener('click', (e) => {
    if (header.classList.contains('is-collapsed')) {
      e.preventDefault();
      setCollapsed(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
