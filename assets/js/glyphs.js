/**
 * glyphs.js — 12 个元素的图形
 *
 * 为什么要自建这组图标：
 * 站点有 12 个元素（花/星/森/茶/猫/海/书/雪/夜/春/甜/风），但除了地域底色和
 * 3D 手办配色之外，这 12 个区分度最高的信息**一处都没画出来**。地域格、关系网、
 * 卡片全靠文字区分，于是 12 张卡长得一样。
 *
 * 规范（改的时候请一起守）：
 *   · 24×24 画布，图形落在 3~21 之间，留 3px 呼吸
 *   · 只用描边，stroke-width 1.6，linecap/linejoin 圆角
 *   · 不写 fill、不写颜色 —— 颜色交给 currentColor，才能跟着语境变
 *   · 一条图形线尽量不超过 2 个 path，多了在小尺寸下就糊了
 *
 * 单一来源：main.js 运行期用，build-pages.mjs 构建期直接 import，
 * 所以角色页的静态 SVG 和首页的运行时 SVG 一定长得一样。
 */

/** @type {Record<string, string>} 元素 → 内部 path（不含 <svg> 外壳） */
export const GLYPHS = {
  花: '<path d="M12 12C6.6 8.6 5.8 5.4 12 3.2C18.2 5.4 17.4 8.6 12 12ZM12 12C13.56 5.81 16.36 4.06 20.37 9.28C20.19 15.86 16.9 16.09 12 12ZM12 12C18.37 11.58 20.9 13.7 17.17 19.12C10.86 20.98 9.63 17.92 12 12ZM12 12C14.37 17.92 13.14 20.98 6.83 19.12C3.1 13.7 5.63 11.58 12 12ZM12 12C7.1 16.09 3.81 15.86 3.63 9.28C7.64 4.06 10.44 5.81 12 12ZM12 12.6v4.6"/>',
  星: '<path d="M12 3.2 14 9.4l6.4.1-5.1 3.9 1.9 6.2-5.2-3.7-5.2 3.7 1.9-6.2L3.6 9.5l6.4-.1z"/>',
  森: '<path d="M12 3.4 8.4 8.6h7.2z"/><path d="M12 7.2 7.2 13.4h9.6z"/><path d="M12 11.4 6 18.2h12z"/><path d="M12 18.2V21"/>',
  茶: '<path d="M5 9.4h11.2v5.2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16.2 10.8h1.9a2.4 2.4 0 0 1 0 4.8h-1.9"/><path d="M4 21h14"/>',
  猫: '<path d="M6.2 20.4v-6.2a5.8 5.8 0 0 1 11.6 0v6.2"/><path d="M6.2 14.2 5.6 7.6l4 2.3M17.8 14.2l.6-6.6-4 2.3"/><path d="M9.8 16.6h.01M14.2 16.6h.01"/>',
  海: '<path d="M3 10.4c2.4-2.2 4.2-2.2 6.6 0s4.2 2.2 6.6 0 3.6-1.6 4.8-.8"/><path d="M3 15.4c2.4-2.2 4.2-2.2 6.6 0s4.2 2.2 6.6 0 3.6-1.6 4.8-.8"/><path d="M3 20.4c2.4-2.2 4.2-2.2 6.6 0s4.2 2.2 6.6 0 3.6-1.6 4.8-.8"/>',
  书: '<path d="M12 6.4C10.4 5 8.2 4.4 4.6 4.6v13.2c3.6-.2 5.8.4 7.4 1.8 1.6-1.4 3.8-2 7.4-1.8V4.6c-3.6-.2-5.8.4-7.4 1.8z"/><path d="M12 6.4v13.2"/>',
  雪: '<path d="M12 3.2v17.6M4.4 7.6l15.2 8.8M19.6 7.6 4.4 16.4"/><path d="M9.6 5.2 12 7.4l2.4-2.2M9.6 18.8 12 16.6l2.4 2.2"/>',
  夜: '<path d="M19.8 14.6A8.4 8.4 0 0 1 9.4 4.2a8.4 8.4 0 1 0 10.4 10.4z"/><path d="M17.4 4.4l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z"/>',
  // 一枝两芽：先试的是"两条细线"，16px 下缩成 Y 字、和「风」撞脸，
  // 改成两片闭合叶形 —— 有面积才认得出
  春: '<path d="M12 21c0-4.2 0-7.6 0-10.8"/><path d="M12 13.8c-.4-3.4-2.4-5.6-5.6-6.4-.5 3.5 1.6 6 5.6 6.4z"/><path d="M12 9.6c.4-2.8 2-4.5 4.6-5.1.4 2.9-1.2 4.8-4.6 5.1z"/>',
  // 杯子蛋糕：三条褶线 + 圆顶 + 樱桃，比"扁圆顶+把手"更像蛋糕、不像茶壶
  甜: '<path d="M6 12.6h12l-1.4 6.2a2 2 0 0 1-2 1.6H9.4a2 2 0 0 1-2-1.6z"/><path d="M9.4 12.6v7.8M12 12.6v7.8M14.6 12.6v7.8"/><path d="M6.4 12.6a5.6 5.6 0 0 1 11.2 0"/><path d="M12 6.9V4.7"/>',
  风: '<path d="M3.6 8.6h9.8a2.6 2.6 0 1 0-2.6-2.6"/><path d="M3.6 15.4h12.8a2.6 2.6 0 1 1-2.6 2.6"/><path d="M3.6 12h15"/>',
};

/** 白名单：只有这些元素能画，其余一律不渲染（防止数据里出现怪值直接进 innerHTML） */
export const ELEMENTS = Object.keys(GLYPHS);

/**
 * 取一个元素的图形字串。未知元素返回 ''，
 * 调用方据此决定要不要留空位 —— 不猜、不兜底画个问号。
 */
export function glyphOf(element) {
  return GLYPHS[element] || '';
}

/**
 * 完整 <svg> 外壳，给运行时和构建期共用。
 * size 只影响 width/height，viewBox 恒定 24，所以 16px 与 64px 是同一张图。
 * decorative 默认 true：图形旁边一定已经有文字（元素名/地名/角色名），
 * 再给一遍 alt 只会让读屏把同一件事念两次。
 */
export function glyphSvg(element, { className = 'glyph', size = 24, strokeWidth = 1.6 } = {}) {
  const inner = glyphOf(element);
  if (!inner) return '';
  return `<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"
    fill="none" stroke="currentColor" stroke-width="${strokeWidth}"
    stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/**
 * 给 CSS mask 用的图形：独立 SVG（带 xmlns、描边写死 #000）。
 *
 * 为什么不复用 glyphSvg：
 *   · mask 里的 SVG 是当图片载入的，必须有 xmlns，否则整个图被丢弃；
 *   · 它不继承 currentColor，描边要写死 —— mask 只认 alpha，
 *     黑的白的都一样，颜色由 background + opacity 决定。
 * 实测两次踩坑：没 xmlns → 图形不出现，块照画（看着像"灰色方块"）；
 * 用 currentColor → 描边是 none，同样只剩块。所以这里单独一份。
 */
export function glyphMask(element) {
  const inner = glyphOf(element);
  if (!inner) return '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
    + 'stroke="#000" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
    + `${inner}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
