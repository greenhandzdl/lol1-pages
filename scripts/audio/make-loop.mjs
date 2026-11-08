#!/usr/bin/env node
/**
 * make-loop.mjs — 把生成的音乐裁成能无缝循环的一段，转码入库
 *
 * 三个必须处理的现实问题，都是实测出来的：
 *
 * 1. **ACE-Step 会自己收尾。**
 *    请求 48 秒，实际有声音的只有前 ~44 秒，最后 4 秒是 -62dB 的死静音。
 *    请求 16 秒更糟，中途就开始掉。所以别指望"生成时长 = 可用时长"，
 *    先按 2 秒一格量 RMS，找出真正有声的那一段，把尾巴切掉。
 *
 * 2. **四个时段响度差得很远。**
 *    实测 morning 平均 -25.8dB、night -37.5dB，差 12dB。
 *    直接放上去，切时段的时候音量会跳 —— 统一过 loudnorm 到一个目标值。
 *
 * 3. **直接 `<audio loop>` 会在接缝处断一下。**
 *    做法是把尾巴和开头做交叉淡化：取末尾 F 秒淡到开头 F 秒上，
 *    拼出来的循环长度是 L-F，接缝处没有跳变。
 *
 * 用法：
 *   node scripts/audio/make-loop.mjs morning_1000
 *   node scripts/audio/make-loop.mjs --all
 *   node scripts/audio/make-loop.mjs --publish morning_1000   # 写进 assets/audio/
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(ROOT, '.cache/bgm');
const DEST = path.join(ROOT, 'assets/audio');

/** 循环处理参数 */
const FADE = 3.0; // 接缝交叉淡化秒数
const TARGET_DB = -21; // 目标平均电平（volumedetect 的 mean_volume）
/**
 * 循环两端的封口长度。
 *
 * acrossfade 出来的 wav 接缝本来是干净的（实测跳变 0.00043），
 * 但 libmp3lame 在文件末尾会解出 0.2 的残帧 —— 循环回头就是一声"咔"。
 * 封 40ms 淡入淡出把它按掉：占 30 秒循环的千分之一，听不出来，
 * 而不封是实打实能听见的。
 */
const EDGE_FADE = 0.04;
const TARGET_TP = -3.0; // 峰值上限，给限幅器留 1dB 余量
const BITRATE = 64; // kbps 单声道

/** 判定"有声"的阈值：比该曲最响的一格低 15dB 以内 */
const GATE_DB = 15;

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const all = args.includes('--all');
const names = args.filter((a) => !a.startsWith('--'));

async function rmsEnvelope(file, window = 2) {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-af', `asetnsamples=${Math.round(48000 * window)},astats=metadata=1:reset=1,` +
      'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ], { maxBuffer: 1 << 26 });
  return [...stdout.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)]
    .map((m) => (m[1] === '-inf' ? -120 : Number(m[1])));
}

/**
 * 找出最长的一段连续有声区域，返回 [起, 止] 秒。
 * 用"相对最响一格"而不是绝对阈值 —— night 那版整体就安静，
 * 绝对阈值会把它整条判成静音。
 */
function sustainedSpan(env, window) {
  const loudest = Math.max(...env);
  const gate = loudest - GATE_DB;
  let best = null;
  let start = -1;
  for (let i = 0; i <= env.length; i++) {
    const on = i < env.length && env[i] >= gate;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const span = [start * window, i * window];
      if (!best || span[1] - span[0] > best[1] - best[0]) best = span;
      start = -1;
    }
  }
  return best;
}

async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  return Number(stdout.trim());
}

/**
 * 裁 → 归一 → 做接缝 → 转码，一次 ffmpeg 跑完。
 *
 * 接缝的做法（设裁出来长 L，淡化 F）：
 *   输出前 F 秒 = crossfade(原末尾 F 秒, 原开头 F 秒)
 *   输出随后   = 原 F 秒 到 L-F 秒
 * 总长 L-F，首尾相接没有电平跳变。
 */
/**
 * 裁 → 做接缝 → 恒定增益 → 转码。
 *
 * 接缝的做法（设裁出来长 L，淡化 F）：
 *   输出前 F 秒 = crossfade(原末尾 F 秒, 原开头 F 秒)
 *   输出随后   = 原 F 秒 到 L-F 秒
 * 总长 L-F，首尾相接没有电平跳变。
 *
 * ⚠ 响度归一化必须用 **恒定增益**（volume），不能用 loudnorm。
 * 实测踩过两次：
 *   · loudnorm 单遍（dynamic）：起头和结尾的增益不同，接缝两侧电平对不上，
 *     跳变 0.0004 → 0.207，循环点会"咔"一下。
 *   · loudnorm 两遍（linear=true）：一样会坏，跳变还是 0.207。
 * 只要是对时间轴做动态处理，循环点就保不住。所以：
 *   先量整条曲的 RMS，算出到目标电平要加多少 dB，一次性加上去，
 *   再串一个限幅器兜住峰值。
 */
async function measureRms(file) {
  const { stderr } = await run('ffmpeg', [
    '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ], { maxBuffer: 1 << 26 });
  const mean = Number(stderr.match(/mean_volume: (-?[\d.]+)/)?.[1]);
  const peak = Number(stderr.match(/max_volume: (-?[\d.]+)/)?.[1]);
  return { mean, peak };
}

async function buildLoop(src, name) {
  const env = await rmsEnvelope(src);
  const total = await duration(src);
  const span = sustainedSpan(env, 2);
  if (!span) throw new Error('整条都没声音，跳过');

  // 留 0.5 秒余量，避免把淡出还在衰减的地方当起点/终点
  const t0 = Math.max(0, span[0] - 0.5);
  const t1 = Math.min(total, span[1] + 0.5);
  const L = t1 - t0;
  if (L < FADE * 3) throw new Error(`可用长度只有 ${L.toFixed(1)}s，太短`);

  const d = L - FADE;
  const seamFilter =
    `[0:a]atrim=start=${t0}:end=${t1},asetpts=N/SR/TB,` +
    // 60Hz 以下切掉：笔记本和手机喇叭放不出来，只会糊住中频。
    // 频谱图上生成结果在 40Hz 附近有持续能量，白占码率。
    // 必须在测量之前滤，否则算出来的增益会偏高 —— 滤掉的能量没人补。
    `highpass=f=60:poles=2,` +
    `aformat=sample_rates=48000:channel_layouts=mono,asplit=3[a][b][c];` +
    `[a]atrim=start=${d},asetpts=N/SR/TB[tail];` +
    `[b]atrim=end=${FADE},asetpts=N/SR/TB[head];` +
    `[c]atrim=start=${FADE}:end=${d},asetpts=N/SR/TB[mid];` +
    `[tail][head]acrossfade=d=${FADE}:c1=tri:c2=tri[seam];` +
    `[seam][mid]concat=n=2:v=0:a=1[out]`;

  // 第一遍：只做接缝，落成中间 wav
  const pre = path.join(SRC, `${name}.pre.wav`);
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', src, '-filter_complex', seamFilter,
    '-map', '[out]', '-c:a', 'pcm_s16le', pre,
  ], { maxBuffer: 1 << 26 });

  // 第二遍：量电平 → 算恒定增益 → 限幅 → 转码
  const { mean, peak } = await measureRms(pre);
  // 目标平均电平；但增益别大到把峰值顶穿，留 1dB 给限幅器
  const wantGain = TARGET_DB - mean;
  const room = TARGET_TP - peak;
  const gain = Math.min(wantGain, room);

  const out = path.join(SRC, `${name}.loop.mp3`);
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', pre,
    '-af',
    `volume=${gain.toFixed(2)}dB,` +
      `afade=t=in:st=0:d=${EDGE_FADE},areverse,` +
      `afade=t=in:st=0:d=${EDGE_FADE},areverse,` +
      `alimiter=limit=${Math.pow(10, TARGET_TP / 20).toFixed(4)}:level=disabled`,
    '-c:a', 'libmp3lame', '-b:a', `${BITRATE}k`, '-ar', '48000', '-ac', '1',
    out,
  ], { maxBuffer: 1 << 26 });

  return { out, span, t0, t1, loopLen: d, gain, preMean: mean, prePeak: peak };
}

/** 接缝检查：末样本和首样本的电平应该接近，中间不该有静音洞 */
async function checkSeam(file) {
  const { stderr } = await run('ffmpeg', [
    '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ], { maxBuffer: 1 << 26 });
  const mean = Number(stderr.match(/mean_volume: (-?[\d.]+)/)?.[1]);
  const peak = Number(stderr.match(/max_volume: (-?[\d.]+)/)?.[1]);
  return { mean, peak };
}

if (!all && !names.length) {
  console.error('用法: node scripts/audio/make-loop.mjs --all [--publish]');
  process.exit(1);
}

const picks = all
  ? (await readdir(SRC)).filter((f) => f.endsWith('.wav')).map((f) => f.replace(/\.wav$/, ''))
  : names;

if (publish) await mkdir(DEST, { recursive: true });

const report = [];
for (const name of picks) {
  const src = path.join(SRC, `${name}.wav`);
  try {
    const r = await buildLoop(src, name);
    const { mean, peak } = await checkSeam(r.out);
    const bytes = (await readFile(r.out)).length;
    const dur = await duration(r.out);
    report.push({ name, loopLen: r.loopLen, dur, bytes, mean, peak, span: r.span });
    console.log(
      `✓ ${name.padEnd(16)} 有声 ${r.span[0]}–${r.span[1]}s → 循环 ${dur.toFixed(1)}s ` +
      `${(bytes / 1024).toFixed(0)}KB  gain ${r.gain >= 0 ? '+' : ''}${r.gain.toFixed(1)}dB  ` +
      `mean ${mean.toFixed(1)}dB peak ${peak.toFixed(1)}dB`,
    );
    if (publish) {
      const [, slot] = name.split('_');
      const slotName = name.split('_')[0];
      await run('cp', [r.out, path.join(DEST, `${slotName}.mp3`)]);
    }
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
  }
}

await writeFile(
  path.join(SRC, 'loop-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf-8',
);
const totalBytes = report.reduce((a, r) => a + r.bytes, 0);
console.log(`\n合计 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
