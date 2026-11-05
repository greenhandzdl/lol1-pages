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
const REQUIRED = ['id', 'name', 'nameEn', 'title', 'tagline', 'bio', 'region', 'element', 'tags', 'image', 'palette', 'seed'];
/** 关系类型白名单 —— 新增要同时改这里，避免拼写漂移 */
const RELATION_KINDS = ['邻居', '挚友', '常客', '师承', '同好', '旧识'];

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

// 内容厚度：批次一的目标是每人 bio 至少 150 字
for (const c of list) {
  const n = (c.bio || '').length;
  if (n < 150) warn(`[${c.id}] bio 只有 ${n} 字（目标 ≥150）`);
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
