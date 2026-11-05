/**
 * store.js — 统一的本地存档层
 *
 * 之前每个功能各存各的（lol1:favs、lol1:starhunt），加一个玩法就多一个键，
 * 谁也说不清站点到底在本地留了什么。这里收拢成一个带版本号的存档对象，
 * 并且负责把旧键迁移过来。
 *
 * 站点政策写明「没有统计脚本、收藏只留在本地」，所以：
 *  - 不往外发任何请求
 *  - 读不到 localStorage（无痕模式）时退回内存态，功能不炸
 *
 * 结构：
 *   { v: 2, favs: [], seen: [], turned: [], spun: {}, stars: {}, at: 时间戳 }
 *   seen   看过的角色 id —— 图鉴完成度要用
 *   turned 在 3D 台成功加载过模型的 id（和 looked 是两回事：转手办成本更高）
 *   spun  每日一抽的记录 { '2026-11-05': 'sakura' }
 *   stars 寻星最高分 { sakura: 27 }
 */

const KEY = 'lol1:save';
const VERSION = 2;

/** 旧键 → 新结构，迁移后删掉旧键 */
const LEGACY = {
  'lol1:favs': (raw, s) => {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) s.favs = [...new Set(arr)];
    } catch { /* 坏数据就当没有 */ }
  },
  'lol1:starhunt': (raw, s) => {
    const n = Number(raw);
    // 旧版只有一个总最高分，没有角色维度，只能记在通配键上
    if (Number.isFinite(n) && n > 0) s.stars.__all = n;
  },
};

const blank = () => ({ v: VERSION, favs: [], seen: [], turned: [], spun: {}, stars: {}, at: Date.now() });

let cache = null;

function read() {
  if (cache) return cache;
  let data = blank();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.v === VERSION) {
        data = { ...blank(), ...parsed };
      } else if (parsed && typeof parsed === 'object') {
        // 版本不同：保留能认得的字段，其余回到默认
        data = { ...blank(), ...parsed, v: VERSION };
      }
    } else {
      // 首次运行或从老版本升级：把旧键搬过来
      for (const [k, fn] of Object.entries(LEGACY)) {
        const old = localStorage.getItem(k);
        if (old !== null) {
          fn(old, data);
          localStorage.removeItem(k);
        }
      }
      if (data.favs.length || Object.keys(data.stars).length) write(data);
    }
  } catch {
    /* 无痕模式：用内存里的 blank，功能降级但不报错 */
  }
  cache = data;
  return data;
}

function write(data) {
  cache = data;
  try {
    data.at = Date.now();
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* 写不进去就只留在内存 */ }
}

/* ---------- 对外接口 ---------- */

export const store = {
  /** 收藏 */
  getFavs: () => new Set(read().favs),
  setFavs(set) {
    const d = read();
    d.favs = [...set];
    write(d);
  },
  hasFav: (id) => read().favs.includes(id),
  toggleFav(id) {
    const d = read();
    const i = d.favs.indexOf(id);
    if (i >= 0) d.favs.splice(i, 1);
    else d.favs.push(id);
    write(d);
    return i < 0;
  },

  /** 看过（打开过详情或角色页就算） */
  getSeen: () => new Set(read().seen),
  markSeen(id) {
    const d = read();
    if (!d.seen.includes(id)) {
      d.seen.push(id);
      write(d);
    }
  },

  /** 在 3D 台真的转过（模型加载成功才算） */
  getTurned: () => new Set(read().turned),
  markTurned(id) {
    const d = read();
    if (!d.turned.includes(id)) {
      d.turned.push(id);
      write(d);
    }
  },

  /** 每日一抽：按日期记，同一天只认第一次抽到的 */
  getSpin(dateKey) {
    return read().spun[dateKey] || null;
  },
  setSpin(dateKey, id) {
    const d = read();
    d.spun[dateKey] = id;
    write(d);
  },

  /** 寻星成绩 */
  getStars() {
    return { ...read().stars };
  },
  setStars(id, score) {
    const d = read();
    const prev = d.stars[id] || 0;
    if (score > prev) {
      d.stars[id] = score;
      write(d);
    }
    return Math.max(prev, score);
  },

  /** 供调试与「清空存档」用 */
  reset() {
    cache = blank();
    try {
      localStorage.removeItem(KEY);
      for (const k of Object.keys(LEGACY)) localStorage.removeItem(k);
    } catch { /* ignore */ }
  },

  raw: () => read(),
};

/** 本地日期键，YYYY-MM-DD。刻意用本地时区：没有后端可依，统一时区反而让"今天"对不上。 */
export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
