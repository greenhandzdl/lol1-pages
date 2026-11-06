#!/usr/bin/env node
/**
 * check-data.mjs — 校验 characters.json
 *
 * 为什么要这个：内容开始变厚之后，字段一多就容易写错 —— 关系指向一个不存在的
 * id、复制的 bio 忘了改、图片路径拼错。这些错在页面上不一定看得见（
 * 关系卡片会静默消失、图片 404 只在控制台报），但收集系统的完成度会跟着错。
 * 所以把它挡在构建之前。
 *
 * 用法：
 *   node scripts/check-data.mjs        # 有问题则非零退出
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'assets/data/characters.json');

const errors = [];
const warns = [];
const fail = (m) => errors.push(m);
const warn = (m) => warns.push(m);

/** 这些字段是玩法与页面结构依赖的，必须有 */
const REQUIRED = ['id', 'name', 'nameEn', 'title', 'tagline', 'voice', 'bio', 'story', 'day', 'region', 'element', 'tags', 'themes', 'image', 'palette', 'seed'];
/** 「她的一天」四个时段，顺序固定 —— 少了或多了都会让时间线读起来怪 */
const DAY_SLOTS = ['早晨', '白天', '傍晚', '夜里'];
/** 关系类型白名单 —— 新增要同时改这里，避免拼写漂移 */
const RELATION_KINDS = ['邻居', '挚友', '常客', '师承', '同好', '旧识'];

/**
 * 主题白名单 —— 首页筛选用的受控词表。
 *
 * 为什么不用 tags：35 个标签里 34 个只有一个人，点一下等于点名，
 * 筛选形同虚设。主题是「几个人的共同点」，每个都得覆盖多人。
 */
const THEMES = ['花与四季', '星光与咒语', '茶与甜点', '书页与静默', '海风与高处', '街角的熟客', '认真做一件小事'];
/** 一个主题至少要覆盖几个人 —— 少于这个数就不值得做成筛选项 */
const THEME_MIN_MEMBERS = 3;

const data = JSON.parse(await readFile(DATA, 'utf8'));
const list = data.characters;
if (!Array.isArray(list) || !list.length) {
  console.error('✗ characters.json 里没有 characters 数组');
  process.exit(1);
}

const ids = new Set();
const seenName = new Map();

for (const c of list) {
  const at = `[${c.id || '?'}]`;

  for (const k of REQUIRED) {
    if (c[k] === undefined || c[k] === null || c[k] === '') fail(`${at} 缺必填字段 ${k}`);
  }

  if (ids.has(c.id)) fail(`${at} id 重复`);
  ids.add(c.id);

  // 名字重复通常意味着复制粘贴没改 —— 内容扩写阶段最容易出这个错
  if (seenName.has(c.name)) fail(`${at} 名字「${c.name}」与 ${seenName.get(c.name)} 重复`);
  seenName.set(c.name, c.id);

  if (c.tags && (!Array.isArray(c.tags) || c.tags.length < 2)) fail(`${at} tags 至少 2 个`);

  // 主题：受控词表 + 每人 2~3 个。少于 2 个会出现"只属于一个主题"的人，
  // 从那个主题点进来就只剩他一个，和用 tags 当筛选没区别。
  if (c.themes) {
    if (!Array.isArray(c.themes)) fail(`${at} themes 必须是数组`);
    else {
      if (c.themes.length < 2 || c.themes.length > 3) {
        fail(`${at} themes 应为 2~3 个，现在 ${c.themes.length} 个`);
      }
      if (new Set(c.themes).size !== c.themes.length) fail(`${at} themes 有重复项`);
      for (const t of c.themes) {
        if (!THEMES.includes(t)) fail(`${at} 主题「${t}」不在白名单（${THEMES.join('/')}）`);
      }
    }
  }
  if (c.palette && (!Array.isArray(c.palette) || c.palette.length !== 2)) fail(`${at} palette 必须是 2 个色值`);
  for (const hex of c.palette || []) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) fail(`${at} 色值格式不对: ${hex}`);
  }

  // 文件必须真实存在，否则线上是 404 + 空白卡片
  for (const key of ['image', 'model', 'modelSource']) {
    if (!c[key]) continue;
    try {
      await access(path.join(ROOT, c[key]));
    } catch {
      fail(`${at} ${key} 指向的文件不存在: ${c[key]}`);
    }
  }

  // 关系完整性：指向不存在的 id 是最常见的错误
  for (const r of c.relations || []) {
    if (!r.id) fail(`${at} relations 里有条目缺 id`);
    else if (r.id === c.id) fail(`${at} 关系指向自己`);
    else if (!list.some((x) => x.id === r.id)) fail(`${at} 关系指向不存在的角色: ${r.id}`);
    if (r.kind && !RELATION_KINDS.includes(r.kind)) {
      fail(`${at} 关系类型「${r.kind}」不在白名单（${RELATION_KINDS.join('/')}）`);
    }
  }
}

// 关系应当大体双向：A 写了「和 B 是挚友」，B 那边也该有 A。
// 单向不算错（有人单方面认为是朋友反而有故事），但值得提醒。
for (const c of list) {
  for (const r of c.relations || []) {
    const other = list.find((x) => x.id === r.id);
    if (!other) continue;
    const back = (other.relations || []).some((x) => x.id === c.id);
    if (!back) warn(`[${c.id}] 单向关系：${c.id} → ${r.id}，对方没有回指`);
  }
}

// 内容厚度：bio 目标 ≥300 字（第一轮是 150，之后又扩了一轮）
for (const c of list) {
  const n = (c.bio || '').length;
  if (n < 300) warn(`[${c.id}] bio 只有 ${n} 字（目标 ≥300）`);
  const s = (c.story || '').length;
  if (s && s < 100) warn(`[${c.id}] story 只有 ${s} 字（目标 ≥100）`);
}

// story 与 bio 撞车通常意味着复制粘贴 —— 用字二元组重合率粗测
function bigrams(t) {
  const s = t.replace(/\s+/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}
for (const c of list) {
  const a = bigrams(c.bio || '');
  const b = bigrams(c.story || '');
  if (!a.size || !b.size) continue;
  const hit = [...b].filter((g) => a.has(g)).length;
  const rate = hit / b.size;
  if (rate > 0.6) fail(`[${c.id}] story 与 bio 重合 ${(rate * 100).toFixed(0)}%，像是复制来的`);
}

// 「她的一天」：恰好四段，时段固定，每段要有内容
for (const c of list) {
  const day = c.day;
  if (!Array.isArray(day) || day.length !== DAY_SLOTS.length) {
    fail(`[${c.id}] day 应为 ${DAY_SLOTS.length} 段，实际 ${Array.isArray(day) ? day.length : typeof day}`);
    continue;
  }
  day.forEach((d, i) => {
    if (!DAY_SLOTS.includes(d.time)) fail(`[${c.id}] day[${i}] 时段「${d.time}」不在白名单`);
    if (!d.title) fail(`[${c.id}] day[${i}] 缺 title`);
    if (!d.text || d.text.length < 20) fail(`[${c.id}] day[${i}] text 太短（${(d.text || '').length} 字）`);
  });
  const times = day.map((d) => d.time).join(',');
  if (times !== DAY_SLOTS.join(',')) fail(`[${c.id}] day 时段顺序应为 ${DAY_SLOTS.join('/')}，实际 ${times}`);
}

// 主题覆盖人数：白名单里的每个主题都得真的有人在用，且不能只有一两个人
for (const t of THEMES) {
  const members = list.filter((c) => (c.themes || []).includes(t));
  if (!members.length) fail(`主题「${t}」没有任何角色——要么补人，要么从白名单删掉`);
  else if (members.length < THEME_MIN_MEMBERS) {
    fail(`主题「${t}」只有 ${members.length} 人（至少 ${THEME_MIN_MEMBERS}）：${members.map((c) => c.id).join('/')}`);
  }
}
// 反过来：有没有人被漏在词表外（一个主题都没有 = 任何筛选都看不到他）
for (const c of list) {
  if (!(c.themes || []).length) fail(`[${c.id}] 没有任何主题，筛选时会消失`);
}

if (warns.length) {
  console.log(`\n⚠ ${warns.length} 条提醒：`);
  for (const w of warns) console.log('  ·', w);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} 个错误：`);
  for (const e of errors) console.error('  ·', e);
  process.exit(1);
}

console.log(`\n✓ ${list.length} 位角色数据校验通过`);
