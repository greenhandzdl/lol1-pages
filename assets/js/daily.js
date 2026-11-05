/**
 * daily.js — 每日一抽
 *
 * 设计上刻意不追求"随机感"：同一天进来看到的永远是同一个人。
 * 理由是没有后端，真随机就意味着刷新一次换一个，反而没有"今天是她"这件事。
 * 用日期做确定性种子，不需要服务器，也不会伪造随机。
 *
 * 日期取浏览器本地时区 —— 统一时区反而会让某些人眼里的"今天"对不上。
 */

/** 把日期字符串散列成一个稳定的整数（FNV-1a 变体，够用且短） */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 今天是谁。same day → same id，跨天 → 换人。
 * 额外混入角色总数，这样加减角色时分布不会整体塌到一个位置。
 */
export function pickOfDay(all, dateKey) {
  if (!all.length) return null;
  const i = hash(`${dateKey}::${all.length}`) % all.length;
  return all[i];
}

/** 当天限定的一句话 —— 同一天固定，跨天变化 */
const LINES = [
  '今天她会把最小的那块留给你。',
  '她今天心情不错，愿意多说两句话。',
  '她刚从外面回来，袖口还带着风。',
  '今天适合什么也不做，就坐着。',
  '她好像有话想说，但又咽回去了。',
  '今天的她比平时安静一点。',
  '她把手里的东西分了一半给你。',
  '她说今天可以晚一点回家。',
  '她今天特别想被人找到。',
  '她假装没在等你，其实站了很久。',
];

export function lineOfDay(dateKey) {
  return LINES[hash(`line::${dateKey}`) % LINES.length];
}
