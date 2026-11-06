/**
 * accent.js — 每个角色自己的"墨色"
 *
 * characters.json 里的 palette 是给背景块用的浅色（#ffd9e6 之类），
 * 直接当文字色会掉到 1.3:1，白底上基本看不见。所以每个角色需要两个值：
 *
 *   --pa / --pb   原色，只做背景、水印、渐变
 *   --pa-ink      能在 --bg / --surface 上读出 ≥4.5:1 的深色版本
 *
 * 这里不引入颜色库：把色相与饱和度按同一步长往墨色（--ink）压，
 * 直到对比度够为止。压多少由算出来的数决定，不靠人眼调。
 */

/** #rrggbb → [r,g,b]（0–255） */
export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] → #rrggbb */
export function rgbToHex(rgb) {
  return `#${rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG 相对亮度 */
export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度，返回 1–21 */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 线性混色，t=0 取 a，t=1 取 b */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return a;
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

/**
 * 派生一个"能当文字用"的 accent。
 *
 * @param {string} light  palette 里的浅色
 * @param {string} deep   palette 里的深一档（色相参考，也决定往哪个方向压）
 * @param {object} opts
 * @param {string} opts.bg       要压到哪个背景上达标，浅色主题就是 --bg
 * @param {number} opts.ratio    目标对比度，正文小字用 4.5
 * @param {number} opts.hueBias  往 deep 借多少比重（0–1），让 12 个人各有各的色相
 * @returns {string} #rrggbb
 */
export function inkFor(light, deep, { bg = '#fff8f4', ratio = 4.6, hueBias = 0.62, alsoOn = [] } = {}) {
  const seed = mix(light, deep || light, hueBias);
  // 直接往墨色压会 12 个人最后都糊成同一个深灰（实测压到 4.5:1 时，
  // 樱井小春和花音的差值是 3/255，肉眼看就是同一个颜色）。
  // 所以底色先往 deep 多借一点饱和度，再压：达标那一刻才留得住各自的色相。
  let best = seed;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(seed, '#2b1b23', t);
    best = c;
    // 达标底不止页面底色：文字也会压在卡片自己的渐变色上（地域格子、
    // 角色页的引言竖线旁的浅色块）。只对 --bg 达标是不够的 ——
    // 实测最差的一组只有 2.17:1，肉眼就是"字没了"。
    if (contrast(c, bg) < ratio) continue;
    if (alsoOn.some((b) => contrast(c, b) < 3.4)) continue;
    return c;
  }
  return best;
}

/**
 * 一次算好一个角色需要的全部颜色变量，供 style 属性直接输出。
 *
 * 三个值各管一段，别混用：
 *   --pa / --pb  原色，只做背景、渐变、水印
 *   --pa-ink     浅色主题的文字色（对 --bg ≥4.6:1）
 *   --pa-glow    深色主题的文字色（对 #1c1420 ≥6.5:1）
 */
export function accentVars(palette, opts) {
  const [a, b] = palette || ['#ffd9e6', '#ffb7d5'];
  return {
    '--pa': a,
    '--pb': b,
    // 深色主题不要这个深色 accent（对 #1c1420 只有 3.6:1），
    // 所以额外给一个"提亮版"，深色主题的 CSS 直接用它。
    // 两个 palette 端点都当"底下压着什么"传进去 —— 卡片本身就是这么铺的。
    '--pa-ink': inkFor(a, b, { ...opts, alsoOn: [a, b] }),
    '--pa-glow': glowFor(a, b),
  };
}

/** 深色主题用的提亮版：往白里混到 4.6:1 以上，保住色相 */
export function glowFor(light, deep, { bg = '#1c1420', ratio = 6.5 } = {}) {
  const seed = mix(light, deep || light, 0.5);
  for (let t = 0.15; t <= 1.0001; t += 0.02) {
    const c = mix(seed, '#ffffff', t);
    if (contrast(c, bg) >= ratio) return c;
  }
  return '#e6dae2';
}

/** 输出成 style="" 的内容 */
export function accentStyle(palette, opts) {
  return Object.entries(accentVars(palette, opts))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}
