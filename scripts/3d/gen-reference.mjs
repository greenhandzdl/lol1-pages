#!/usr/bin/env node
/**
 * gen-reference.mjs — 为 3D 流水线出「构图板」
 *
 * 为什么需要这个：Hunyuan3D 吃的是单张图，它看不到「这是坐姿」。
 * 原始插画里人物和桌椅/货架/宠物长在一起时，抠图分不开，生成出来就是
 * 一团糊 —— 茶茶坐椅子上、铃鹿旁边蹲着猫，都属于这种情况。
 *
 * 所以单独出一张只给机器看的构图板：站姿、正面、四肢分开、干净背景、
 * 不带任何会挡到身体的道具。这张图不入站、替代不了插画，
 * 只是 characters.json 里 modelSource 字段指过去的那张。
 *
 * 模型与参数照抄 ComfyUI 历史里跑通的 Anima 任务（别乱改，画风会飘）：
 *   unet  anima-preview3-base.safetensors
 *   clip  qwen_3_06b_base.safetensors (type=stable_diffusion)
 *   vae   qwen_image_vae.safetensors
 *   30 步 / cfg 4.0 / er_sde / simple
 *
 * 用法：
 *   node scripts/3d/gen-reference.mjs chacha --n=6
 *   node scripts/3d/gen-reference.mjs --all
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const OUT = path.join(ROOT, '.cache/3d-refs');

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const count = Number(args.find((a) => a.startsWith('--n='))?.split('=')[1] || 4);
const all = args.includes('--all');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 构图板的统一约束。这些词是这张图唯一的目的：让抠图和建模都能干净地
 * 拿到一个人。少一条都可能退回「和背景粘一起」的老问题。
 */
const FRAMING = [
  'solo, one girl',
  'standing, full body, head to toe',
  'facing viewer, arms slightly away from body, legs apart',
  'simple white background, no props, no furniture, no animals',
  'flat even lighting, no cast shadow on ground',
  // 脸要能被 Hunyuan3D 推出起伏：刘海别盖住眼睛，五官用清晰的深色线条
  'clear facial features, visible eyes, no hair covering eyes',
  'anime illustration, clean lineart, soft pastel colors, high quality',
].join(', ');

/** 统一的负面词 —— 都是历史上真出过的问题 */
const NEGATIVE = [
  'worst quality, low quality, blurry, jpeg artifacts',
  'multiple girls, extra limbs, bad hands, fused fingers',
  'sitting, kneeling, lying, chair, table, furniture',
  'animal, cat, pet, staff, wand, cup, food',
  'busy background, scenery, window, frame, shelf',
  'text, watermark, signature, cropped, out of frame',
].join(', ');

/** 角色外观：从 characters.json 的设计描述转成出图提示词 */
const LOOK = {
  chacha:
    'light brown twin tails with rose hair ornaments, brown eyes, ' +
    'cream lace lolita dress with rose motifs, puff sleeves, ' +
    'white ankle socks, cream mary jane shoes, gentle smile',
  suzuka:
    'short orange bob hair, orange cat ears, gold eyes, ' +
    'black witch hat with orange ribbon, orange capelet over striped shirt, ' +
    'pumpkin-orange puffy skirt, black ankle boots, cheerful smile',
};

async function api(pathname, init) {
  const res = await fetch(`${COMFY}${pathname}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`);
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

/** 建图。节点 id 保持和原 workflow 一致，方便对着历史记录排查。 */
function graph(positive, seed) {
  return {
    44: { class_type: 'UNETLoader', inputs: { unet_name: 'anima-preview3-base.safetensors', weight_dtype: 'default' } },
    45: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion', device: 'default' } },
    15: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    11: { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: positive } },
    12: { class_type: 'CLIPTextEncode', inputs: { clip: ['45', 0], text: NEGATIVE } },
    28: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    19: {
      class_type: 'KSampler',
      inputs: {
        model: ['44', 0],
        positive: ['11', 0],
        negative: ['12', 0],
        latent_image: ['28', 0],
        seed,
        steps: 30,
        cfg: 4.0,
        sampler_name: 'er_sde',
        scheduler: 'simple',
        denoise: 1.0,
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['19', 0], vae: ['15', 0] } },
    46: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'ref' } },
  };
}

async function generate(id, look, seed) {
  const positive = `${FRAMING}, ${look}`;
  const { prompt_id } = await api('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph(positive, seed), client_id: `ref-${id}-${seed}` }),
  });

  for (let i = 0; i < 200; i++) {
    await sleep(1500);
    const h = await api(`/history/${prompt_id}`);
    const entry = h[prompt_id];
    if (!entry) continue;
    if (entry.status?.status_str === 'error') {
      throw new Error(`生成失败: ${JSON.stringify(entry.status).slice(0, 300)}`);
    }
    const imgs = entry.outputs?.[46]?.images;
    if (!imgs?.length) continue;
    const img = imgs[0];
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
    const buf = Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer());
    await mkdir(OUT, { recursive: true });
    const dest = path.join(OUT, `${id}_${seed}.png`);
    await writeFile(dest, buf);
    return dest;
  }
  throw new Error('生成超时');
}

await freeVram();

const data = JSON.parse(await readFile(path.join(ROOT, 'assets/data/characters.json'), 'utf8'));
const ids = all ? Object.keys(LOOK) : only;
if (!ids.length) throw new Error('请给出角色 id，或 --all');

for (const id of ids) {
  const ch = data.characters.find((c) => c.id === id);
  const look = LOOK[id];
  if (!ch || !look) throw new Error(`未知角色: ${id}`);
  const base = Number(ch.seed ?? 1000);
  console.log(`\n▶ ${ch.name} (${id}) × ${count}`);
  for (let i = 0; i < count; i++) {
    const seed = base * 10 + i;
    const p = await generate(id, look, seed);
    console.log(`  ✓ seed ${seed} → ${path.relative(ROOT, p)}`);
  }
}

await freeVram();
