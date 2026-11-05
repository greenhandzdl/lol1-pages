#!/usr/bin/env node
/**
 * build-srcset.mjs — 为插画生成多档宽度，供 srcset 使用
 *
 * 为什么需要这一步：
 * 插画原图是 768×1024。手机上一张卡片只占约 172px 宽（两列布局），
 * 却会把整张 768px 的图下载下来 —— 实测 4G 下首屏 5 张图共 518KB，
 * 其中约四分之三是多余分辨率。
 *
 * 这里按 400 / 600 / 768 三档导出 WebP。
 * 为什么不用 AVIF：实测 400px 档 AVIF 反而比 WebP 大（44.7KB vs 39.9KB），
 * 小尺寸下 AVIF 的头开销盖过了它本身的压缩优势，所以只出 WebP。
 *
 * 幂等：源图 mtime 没变则跳过，重复执行不会白跑。
 *
 * 用法：
 *   node scripts/img/build-srcset.mjs          # 增量构建
 *   node scripts/img/build-srcset.mjs --force  # 全部重出
 */
import { readFile, writeFile, stat, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC_DIR = path.join(ROOT, 'assets/img/works');
// 只出 400 / 600 两档。
// 原图本身就是 768，再导一份 -768 实测只小 2KB（98KB vs 100KB），
// 白白多 12 个文件，不如让 srcset 的最大档直接指向原图。
const WIDTHS = [400, 600];
const QUALITY = 82;
const force = process.argv.includes('--force');

/* ---------- 工具 ---------- */

/** magick 是否可用（项目里别的脚本都不依赖它，所以要显式检查） */
async function hasMagick() {
  try {
    await run('magick', ['-version']);
    return true;
  } catch {
    return false;
  }
}

/** 源图宽高，用来跳过「本来就比目标档小」的情况 */
async function dimensions(file) {
  const { stdout } = await run('magick', ['identify', '-format', '%w %h', file]);
  const [w, h] = stdout.trim().split(/\s+/).map(Number);
  return { w, h };
}

/** 目标文件是否需要重建 */
async function needsBuild(src, out) {
  if (force || !existsSync(out)) return true;
  const [s, o] = await Promise.all([stat(src), stat(out)]);
  return s.mtimeMs > o.mtimeMs;
}

/* ---------- 主流程 ---------- */

async function main() {
  if (!(await hasMagick())) {
    console.error('缺少 ImageMagick（magick 命令）。请先安装，或跳过本脚本。');
    process.exit(1);
  }

  const files = (await readdir(SRC_DIR)).filter(
    (f) => f.endsWith('.webp') && !/-\d+\.webp$/.test(f),
  );

  if (!files.length) {
    console.error(`在 ${SRC_DIR} 下没找到源插画`);
    process.exit(1);
  }

  let built = 0;
  let skipped = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const file of files.sort()) {
    const src = path.join(SRC_DIR, file);
    const base = path.basename(file, '.webp');
    const { w: srcW } = await dimensions(src);
    bytesBefore += (await stat(src)).size;

    for (const width of WIDTHS) {
      // 原图比目标档还窄就别放大，白白增加体积
      if (width > srcW) continue;

      const out = path.join(SRC_DIR, `${base}-${width}.webp`);
      if (!(await needsBuild(src, out))) {
        skipped += 1;
        bytesAfter += (await stat(out)).size;
        continue;
      }

      await run('magick', [
        src,
        '-resize', `${width}x`,
        '-quality', String(QUALITY),
        '-strip',           // 去掉元数据，还能再省一点
        out,
      ]);
      built += 1;
      bytesAfter += (await stat(out)).size;
      console.log(`  ${path.basename(out)}`);
    }
  }

  console.log(
    `\n生成 ${built} 个，跳过 ${skipped} 个。` +
      `源图合计 ${(bytesBefore / 1024).toFixed(0)}KB，` +
      `新档合计 ${(bytesAfter / 1024).toFixed(0)}KB。`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
