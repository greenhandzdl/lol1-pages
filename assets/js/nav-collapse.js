/**
 * nav-collapse.js — 移动端吸顶栏滚动收起
 *
 * 手机上一行 logo + 一行导航把吸顶栏顶到 ~92px，占了将近 11% 的可视高度。
 * 往下滚（看内容）时收起导航行，只留 logo 和图标；往回滚（找人）时再放出来。
 *
 * 独立成模块的原因：首页（main.js）和角色页（char-page.js）都要用。
 * 为了这一个行为去加载 main.js 整包（图鉴渲染、收藏、搜索…）不值得。
 *
 * 动画交给 CSS（.is-collapsed），JS 只切 class，避免滚动时每帧改样式。
 */

const THRESHOLD = 120;  // 太靠顶部就别收，避免刚滚动就跳
const JITTER = 6;       // 小于这个位移当作抖动，忽略

export function collapseNav() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    const y = window.scrollY;
    const dy = y - lastY;

    // 太靠近顶部就一律展开 —— 先判这个，别被下面的「抖动过滤」挡掉，
    // 否则贴近顶部时往回滚也展不开。
    if (y <= THRESHOLD) {
      header.classList.remove('is-collapsed');
      lastY = y;
      ticking = false;
      return;
    }

    // 忽略一两个像素的抖动，但要更新 lastY，
    // 否则小步滚动会一直累积不到阈值。
    if (Math.abs(dy) < JITTER) {
      ticking = false;
      return;
    }

    header.classList.toggle('is-collapsed', dy > 0); // 向下收，向上放
    lastY = y;
    ticking = false;
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
      header.classList.remove('is-collapsed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}
