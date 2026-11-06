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

/**
 * 今天适合做点什么。
 *
 * 每日卡片原本只给一句台词，看完就没有下一步 —— 让人知道"现在能去哪"
 * 比再加一句抒情更有用。同样用日期做种子，同一天永远是同一件。
 */
const SUGGEST = [
  { label: '去 3D 手办台转一圈', href: '/3d/' },
  { label: '玩一局地名配对', href: '/play/' },
  { label: '翻开收藏册，看看还差谁', href: '/shelf/' },
  { label: '读一段她的一天', href: '/c/' },
  { label: '在关系网里找找她', href: '/#web' },
  { label: '看看她们住在哪', href: '/#regions' },
];

export function suggestOfDay(dateKey, pick) {
  // 带上今天抽到的人：人会换，适合做的事也应该跟着换一点
  const i = hash(`suggest::${dateKey}::${pick ? pick.id : ''}`) % SUGGEST.length;
  const s = SUGGEST[i];
  // "/c/" 那条要落到今天这个人的专页上，别给一个泛泛的链接
  if (s.href === '/c/' && pick) {
    return { label: `读 ${pick.name} 的一天`, href: `/c/${pick.id}/#story` };
  }
  if (s.href === '/c/') return { label: '从图鉴里挑一个人读', href: '/#gallery' };
  return s;
}

/**
 * 今天读一句 —— 从全站 36 句台词里按日期挑一句。
 *
 * voice 是第四轮才加的数据，现在只在角色页出现：读者得点进某个人的
 * 档案才能看到她说的话。这里把其中一句提到首页，同一天固定。
 *
 * 刻意不用随机数：刷新一次换一句就没有"今天这句"这件事了。
 * 也不做「下一条」按钮 —— 能翻就不是"今天"了。
 */
export function quoteOfDay(all, dateKey) {
  // 把 (角色, 第几句) 摊平成一张表，这样每句都有自己的位置，
  // 不会因为某人写了三句就比只写一句的人更容易被抽到
  const pool = [];
  for (const c of all) {
    (c.voice || []).forEach((line, i) => pool.push({ c, line, i }));
  }
  if (!pool.length) return null;
  return pool[hash(`quote::${dateKey}::${pool.length}`) % pool.length];
}
