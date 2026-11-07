#!/usr/bin/env node
/**
 * sync-theme-boot.mjs — 把所有静态页的「首帧主题」内联脚本换成唯一来源。
 *
 * 这段脚本曾经在 18 个页面里各写一遍，其中 17 份漏了 `?theme=` 查询参数。
 * 这份脚本把 assets/js/theme-boot.js 灌进每一页，之后只改那一处。
 *
 * 用法：
 *   node scripts/sync-theme-boot.mjs          # 改写文件
 *   node scripts/sync-theme-boot.mjs --check  # 只检查，不一致就退出 1
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { THEME_BOOT } from '../assets/js/theme-boot.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHECK = process.argv.includes('--check');

const PAGES = [
  'index.html',
  '404.html',
  '3d/index.html',
  'play/index.html',
  'shelf/index.html',
];

// 12 个角色页由 build-pages.mjs 生成，这里一并对齐
import { readdir } from 'node:fs/promises';
for (const d of await readdir(path.join(ROOT, 'c'), { withFileTypes: true })) {
  if (d.isDirectory()) PAGES.push(`c/${d.name}/index.html`);
}

/** 匹配「首帧前应用主题」那段内联脚本（各页写法不一，按特征定位） */
const BOOT_RE = /<script>\s*\n?\s*(?:\/\/[^\n]*\n\s*)?(?:\(function\s*\(\)\s*\{|try\s*\{)[\s\S]*?localStorage\.getItem\(['"]lol1:theme['"]\)[\s\S]*?<\/script>/;

const EXPECTED = `<script>\n${THEME_BOOT}\n  </script>`;

let bad = 0;
for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch {
    continue;
  }
  const m = src.match(BOOT_RE);
  if (!m) {
    console.error(`✗ ${rel}：找不到主题引导脚本`);
    bad++;
    continue;
  }
  if (m[0] === EXPECTED) continue;

  const hasQuery = m[0].includes('URLSearchParams');
  if (CHECK) {
    console.error(`✗ ${rel}：主题脚本与唯一来源不一致${hasQuery ? '' : '（缺 ?theme= 支持）'}`);
    bad++;
    continue;
  }
  await writeFile(file, src.replace(BOOT_RE, EXPECTED), 'utf8');
  console.log(`✓ ${rel}${hasQuery ? '' : '（补上 ?theme= 支持）'}`);
}

if (CHECK) {
  if (bad) {
    console.error(`\n${bad} 个页面的主题脚本落后于 assets/js/theme-boot.js`);
    process.exit(1);
  }
  console.log('✓ 所有页面的主题脚本一致');
}
