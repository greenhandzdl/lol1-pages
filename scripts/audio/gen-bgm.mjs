#!/usr/bin/env node
/**
 * gen-bgm.mjs — 用本机 ComfyUI 的 ACE-Step 1.5 出背景音乐
 *
 * 为什么是 ACE-Step：ComfyUI 里现成的音乐方向工作流有好几个
 * （ACE-Step 1.5 / MiniMax Music 3 / YuE2 / Stable Audio 3），但只有
 * ACE-Step 1.5 的模型全在本地（acestep_v1.5_turbo + ace_1.5_vae + qwen_0.6b/4b）。
 * 别的都要现下几 GB，而这一条 8 秒 31 秒就出片，先做它。
 *
 * 出图那套（scripts/3d/gen-reference.mjs）已经把 ComfyUI 的提交/轮询/取件
 * 摸清楚了，这里照抄那个范式，不另造一层。
 *
 * 分四个时段出，和首页「此刻」的早晨/白天/傍晚/夜里一一对应 ——
 * 那一段本来就是按读者本地时间切的，音乐跟着切才说得通。
 *
 * 用法：
 *   node scripts/audio/gen-bgm.mjs --slot=morning --n=3
 *   node scripts/audio/gen-bgm.mjs --all --n=3
 *   node scripts/audio/gen-bgm.mjs --all --n=3 --seconds=32
 *
 * 产物落在 .cache/bgm/，不入库。挑中的那一条再交给 make-loop.mjs 做无缝循环。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const OUT = path.join(ROOT, '.cache/bgm');

const args = process.argv.slice(2);
const num = (flag, dflt) => Number(args.find((a) => a.startsWith(`--${flag}=`))?.split('=')[1] ?? dflt);
const count = num('n', 3);
const seconds = num('seconds', 32);
const all = args.includes('--all');
const only = args.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 四个时段。
 *
 * tags 是 ACE-Step 的主要控制手段：调性、bpm 之外，还得写乐器。
 * 一律 instrumental、不写人声 —— 页面上的字已经够多了，音乐再带词会抢。
 * 调性跟着时段走：早上给人往上走的大调，夜里换小调，这是最省事的"时间感"。
 */
export const SLOTS = {
  morning: {
    label: '早晨',
    tags: [
      'warm ambient, solo felt piano, soft bells, light morning air',
      'instrumental, no vocals, gentle, hopeful, slow attack',
      'lo-fi, warm tape hiss, intimate, quiet',
    ].join(', '),
    bpm: 72,
    keyscale: 'C major',
  },
  day: {
    label: '白天',
    tags: [
      'gentle acoustic guitar, soft shaker, warm ambient pad',
      'instrumental, no vocals, calm, bright, unhurried',
      'lo-fi, clean, airy, easy listening',
    ].join(', '),
    bpm: 88,
    keyscale: 'G major',
  },
  evening: {
    label: '傍晚',
    tags: [
      'warm electric piano, soft strings, slow fade, dusk quiet',
      'instrumental, no vocals, nostalgic, tender, mellow',
      'lo-fi, warm, wide stereo, gentle',
    ].join(', '),
    bpm: 76,
    keyscale: 'F major',
  },
  night: {
    label: '夜里',
    tags: [
      'sparse celesta, soft pad, distant music box, night stillness',
      'instrumental, no vocals, dreamy, quiet, slowly breathing',
      'lo-fi, dark, intimate, minimal',
    ].join(', '),
    bpm: 64,
    keyscale: 'A minor',
  },
};

async function api(pathname, init) {
  const res = await fetch(`${COMFY}${pathname}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function freeVram() {
  await api('/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
  await sleep(3000);
}

/**
 * 建图。节点 id 和 ComfyUI 蓝图 `Text to Audio (ACE-Step 1.5)` 保持一致，
 * 出问题可以直接对着蓝图排查。
 *
 * 参数照抄蓝图（8 步 / euler / simple / cfg 1.0 / shift 3）——
 * turbo 模型是蒸馏过的，步数加多不会更好听，只会更慢。
 */
function graph(slot, seed, dur) {
  const cfg = SLOTS[slot];
  return {
    104: { class_type: 'UNETLoader', inputs: { unet_name: 'acestep_v1.5_turbo.safetensors', weight_dtype: 'default' } },
    105: {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: 'qwen_0.6b_ace15.safetensors',
        clip_name2: 'qwen_4b_ace15.safetensors',
        type: 'ace',
        device: 'default',
      },
    },
    106: { class_type: 'VAELoader', inputs: { vae_name: 'ace_1.5_vae.safetensors' } },
    78: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['104', 0], shift: 3 } },
    94: {
      class_type: 'TextEncodeAceStepAudio1.5',
      inputs: {
        clip: ['105', 0],
        tags: cfg.tags,
        lyrics: '', // 器乐，不给词
        seed,
        bpm: cfg.bpm,
        duration: dur,
        timesignature: '4',
        language: 'en',
        keyscale: cfg.keyscale,
        generate_audio_codes: true,
        cfg_scale: 0.85,
        temperature: 0.9,
        top_p: 0.9,
        top_k: 0,
        min_p: 0,
      },
    },
    47: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['94', 0] } },
    98: { class_type: 'EmptyAceStep1.5LatentAudio', inputs: { seconds: dur, batch_size: 1 } },
    3: {
      class_type: 'KSampler',
      inputs: {
        model: ['78', 0],
        positive: ['94', 0],
        negative: ['47', 0],
        latent_image: ['98', 0],
        seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    18: { class_type: 'VAEDecodeAudio', inputs: { samples: ['3', 0], vae: ['106', 0] } },
    // 先存无损 wav，转码和循环处理交给 ffmpeg —— 生成器只管出素材
    46: {
      class_type: 'SaveAudio',
      inputs: { audio: ['18', 0], filename_prefix: `bgm-${slot}-${seed}` },
    },
  };
}

async function generate(slot, seed, dur) {
  const { prompt_id } = await api('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph(slot, seed, dur), client_id: `bgm-${slot}-${seed}` }),
  });

  for (let i = 0; i < 240; i++) {
    await sleep(2000);
    const h = await api(`/history/${prompt_id}`);
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      throw new Error(`生成失败: ${JSON.stringify(entry.status).slice(0, 400)}`);
    }
    const files = entry.outputs?.[46]?.audio;
    if (!files?.length) continue;
    const f = files[0];
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    const buf = Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer());
    await mkdir(OUT, { recursive: true });
    const dest = path.join(OUT, `${slot}_${seed}.wav`);
    await writeFile(dest, buf);
    return dest;
  }
  throw new Error(`${slot}/${seed} 生成超时`);
}

const targets = all ? Object.keys(SLOTS) : only.length ? only : [];
if (!targets.length) {
  console.error('用法: node scripts/audio/gen-bgm.mjs --all --n=3');
  console.error(`可用时段: ${Object.keys(SLOTS).join(', ')}`);
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
await freeVram();

const manifestPath = path.join(OUT, 'manifest.json');
let manifest = {};
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
} catch {
  /* 第一次跑，没有清单 */
}

for (const slot of targets) {
  if (!SLOTS[slot]) {
    console.error(`跳过未知时段 ${slot}`);
    continue;
  }
  for (let i = 0; i < count; i++) {
    // seed 按时段和序号定死，重跑能复现同一批候选
    const seed = 1000 + Object.keys(SLOTS).indexOf(slot) * 100 + i;
    const t0 = Date.now();
    try {
      const dest = await generate(slot, seed, seconds);
      manifest[`${slot}_${seed}`] = { slot, seed, seconds, file: path.relative(ROOT, dest), at: Date.now() };
      console.log(`✓ ${slot} seed=${seed} → ${path.relative(ROOT, dest)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.error(`✗ ${slot} seed=${seed}: ${err.message}`);
    }
  }
}

await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`\n候选共 ${Object.keys(manifest).length} 条，清单: ${path.relative(ROOT, manifestPath)}`);
