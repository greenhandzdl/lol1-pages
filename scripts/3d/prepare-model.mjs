#!/usr/bin/env node
/**
 * prepare-model.mjs — 从角色插画生成可上网页的 3D 手办模型
 *
 * 流程：抠图(BiRefNet) → Hunyuan3D 2.1 → 简化 → meshopt/webp 压缩 → 校验
 *
 * 用法：
 *   node scripts/3d/prepare-model.mjs sakura
 *   node scripts/3d/prepare-model.mjs --all
 *   node scripts/3d/prepare-model.mjs sakura --no-compress   # 产出 Blender 也能导入的版本
 *
 * 实测踩坑（勿删）：
 *  1. 输入必须是白底单图，否则投影贴图会碎成纸片 —— 所以强制先过 BiRefNet 抠图
 *  2. 生成前要 POST /free 卸载显存残留，否则可用显存只有 ~1.6GB 直接 OOM
 *  3. meshopt 压缩产物 Blender 导不进（浏览器正常），本地验证请加 --no-compress
 *  4. 模型原点在中心、Z 轴向上，前端 rig 必须归一化，不要假设脚底为原点
 */
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIO, trimBackdrop } from './trim-backdrop.mjs';

const run = promisify(execFile);
/** gltf-transform 的读写器：必须注册 meshopt 扩展，否则读不了压缩过的 GLB */
const gltfIO = createIO();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMFY = process.env.COMFY_URL || 'http://127.0.0.1:8188';
const COMFY_INPUT = process.env.COMFY_INPUT || '/opt/comfyui/input';
const COMFY_OUTPUT = process.env.COMFY_OUTPUT || '/opt/comfyui/output';

const args = process.argv.slice(2);
const all = args.includes('--all');
const noCompress = args.includes('--no-compress');
const reprocess = args.includes('--reprocess');
const label = args.find((a) => a.startsWith('--label='))?.split('=')[1] || null;
/** 顶点预算：单模型约 250–300 KB，12 个合计约 3 MB */
const TARGET_VERTS = 36000;
const only = args.filter((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init) {
  const res = await fetch(`${COMFY}${pathname}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`);
  // /free 返回空 body，不能直接 res.json()
  return text ? JSON.parse(text) : {};
}

/** 2. 卸掉常驻模型，把显存还回来 —— 不做这步几乎必然 OOM */
async function freeVram() {
  await api('/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  });
  await sleep(3000);
}

async function submit(prompt) {
  const { prompt_id: id, node_errors: errs } = await api('/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (errs && Object.keys(errs).length) throw new Error(`节点校验失败: ${JSON.stringify(errs)}`);

  for (let i = 0; i < 300; i++) {
    const hist = await api(`/history/${id}`);
    if (hist[id]) {
      const st = hist[id].status;
      if (st.status_str === 'error') {
        const e = (st.messages || []).find((m) => m[0] === 'execution_error');
        throw new Error(`生成失败 @${e?.[1]?.node_type}: ${e?.[1]?.exception_message?.slice(0, 200)}`);
      }
      return hist[id].outputs;
    }
    await sleep(2000);
  }
  throw new Error('生成超时');
}

/** 1+3. 抠图成白底单图（Hunyuan3D 投影贴图的前提） */
const PAD = Number(process.env.HUNY_PAD ?? 1.05);
const GROW = Number(process.env.HUNY_GROW ?? 0);
const THRESH = Number(process.env.HUNY_THRESH ?? 0.6);
const OCTREE = Number(process.env.HUNY_OCTREE ?? 256);

async function isolate(id, srcFile) {
  const outputs = await submit({
    1: { class_type: 'LoadImage', inputs: { image: srcFile } },
    2: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    3: { class_type: 'RemoveBackground', inputs: { bg_removal_model: ['2', 0], image: ['1', 0] } },
    4: {
      class_type: 'ImageCropToMask',
      inputs: {
        images: ['1', 0], masks: ['3', 0], width: 1024, height: 1024,
        pad_factor: PAD, grow_mask: GROW, background: '#FFFFFF',
      },
    },
    5: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: `iso_${id}` } },
  });
  const [file] = outputs['5'].images;
  const abs = path.join(COMFY_OUTPUT, file.subfolder, file.filename);

  // 抠图会把悬空道具（风铃、吊灯、气球）一起留下来，Hunyuan3D 于是把它们也
  // 生成成立体物件，包围盒被撑高、人物缩在角落。所以再裁一次，只留人物。
  const staged = `iso_${id}.png`;
  const subject = path.join(COMFY_INPUT, `sub_${id}.png`);
  await run(process.execPath, [path.join(ROOT, 'scripts/3d/isolate-subject.mjs'), abs, subject], {
    cwd: ROOT,
  });
  return `sub_${id}.png`;
}

/** 4. Hunyuan3D 生成带色模型 */
async function generate(id, img, seed = 42, name = null) {
  const outputs = await submit({
    1: { class_type: 'LoadImage', inputs: { image: img } },
    2: { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: 'hunyuan_3d_v2.1.safetensors' } },
    3: { class_type: 'CLIPVisionEncode', inputs: { clip_vision: ['2', 1], image: ['1', 0], crop: 'center' } },
    4: { class_type: 'Hunyuan3Dv2Conditioning', inputs: { clip_vision_output: ['3', 0] } },
    5: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['2', 0], shift: 1.0 } },
    6: { class_type: 'EmptyLatentHunyuan3Dv2', inputs: { resolution: 4096, batch_size: 1 } },
    7: {
      class_type: 'KSampler',
      inputs: {
        model: ['5', 0], positive: ['4', 0], negative: ['4', 1], latent_image: ['6', 0],
        seed, steps: 30, cfg: 5.0, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
      },
    },
    8: { class_type: 'VAEDecodeHunyuan3D', inputs: { samples: ['7', 0], vae: ['2', 2], num_chunks: 5000, octree_resolution: OCTREE } },
    9: { class_type: 'VoxelToMesh', inputs: { voxel: ['8', 0], algorithm: 'surface net', threshold: THRESH } },
    10: { class_type: 'UnwrapMesh', inputs: { mesh: ['9', 0], segmenter: 'pec', resolution: 1024, padding: 1, weld_distance: 0.0 } },
    11: { class_type: 'ApplyTextureToMesh', inputs: { mesh: ['10', 0], base_color: ['1', 0] } },
    12: { class_type: 'MeshToFile3D', inputs: { mesh: ['11', 0] } },
    13: { class_type: 'Save3DAdvanced', inputs: { model_3d: ['12', 0], filename_prefix: `3d/huny_${name || id}`, viewport_state: {}, width: 1024, height: 1024 } },
  });
  const [file] = outputs['13']['3d'];
  return path.join(COMFY_OUTPUT, file.subfolder, file.filename);
}

const GL = ['npx', ['--yes', '@gltf-transform/cli@4.5.1']];
async function gltf(cmdArgs) {
  const [bin, pre] = GL;
  await run(bin, [...pre, ...cmdArgs], { cwd: ROOT, maxBuffer: 1 << 26 });
}

/**
 * 几何后处理：weld → 剥离贴图 → 简化 → 压缩
 *
 * 顺序不能换，每一步都有实测理由：
 *  1. weld 必须最先 —— Hunyuan3D 输出的网格每个面是独立顶点（148k 顶点里只有 34k 是唯一的），
 *     不焊接的话简化器无法合并任何三角形，ratio 设成 0.05 也只掉 5%（实测 148k→141k）
 *  2. 剥离贴图 —— 前端用素色着色，不采样贴图；同时删掉因此无用的 UV 属性
 *  3. 简化 —— 焊接后 ratio 0.6 即可从 34k 降到 19.6k，轮廓（发型/花枝/提篮）完整保留
 *  4. 最后压缩 —— meshopt 压几何，产物只能浏览器读，Blender 验证要用 --no-compress
 */
/** 读 GLB 里的顶点总数（直接解析 JSON chunk，不加载整份网格） */
async function vertexCount(file) {
  const buf = await readFile(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let n = 0;
  for (const m of json.meshes || []) {
    for (const pr of m.primitives || []) {
      const acc = json.accessors?.[pr.attributes?.POSITION];
      if (acc) n += acc.count;
    }
  }
  return n;
}

async function postprocess(input, target, { compress = true } = {}) {
  const tmpDir = path.join(ROOT, '.tmp-3d');
  await mkdir(tmpDir, { recursive: true });
  const stem = path.basename(input, '.glb');
  const welded = path.join(tmpDir, `${stem}-weld.glb`);
  const stripped = path.join(tmpDir, `${stem}-strip.glb`);
  const simplified = path.join(tmpDir, `${stem}-simplified.glb`);

  console.log('  · 焊接顶点…');
  await gltf(['weld', input, welded]);

  // 插画里人物身后常有装饰背板（拱门、橱窗、彩带框），Hunyuan3D 会把它也挤成
  // 一层薄壳挂在背后，转起来完全不像手办。按 Z 分层找「贴边且面积极大」的层切掉。
  console.log('  · 检查背景板…');
  const backdropDoc = await gltfIO.read(welded);
  const backdropReport = trimBackdrop(backdropDoc);
  if (backdropReport.droppedLayers) {
    await gltfIO.write(welded, backdropDoc);
    console.log(
      `    切掉 ${backdropReport.droppedLayers} 层背景板（三角面 ${backdropReport.triBefore} → ${backdropReport.triAfter}）`
    );
  } else {
    console.log('    未发现背景板');
  }

  console.log('  · 剥离贴图…');
  await run(process.execPath, [path.join(ROOT, 'scripts/3d/strip-texture.mjs'), welded, stripped], {
    cwd: ROOT,
  });

  // 自适应简化：各角色原始密度差一个数量级（cream 焊完 320 万，sakura 只有 3 万），
  // 固定 ratio 要么留下 16 万顶点、要么把细节刮光。而且 simplify 的 --error 是硬约束，
  // 达不到就提前停（umi 实测 ratio 0.32 只降到 6.7 万）。所以按顶点预算迭代，放宽误差。
  console.log('  · 简化…');
  let cur = stripped;
  let verts = await vertexCount(cur);
  for (let pass = 1; pass <= 4 && verts > TARGET_VERTS * 1.15; pass++) {
    const ratio = Math.max(0.004, Math.min(0.6, TARGET_VERTS / verts));
    const err = [0.01, 0.05, 0.2, 1.0][pass - 1] ?? 1.0;
    const out = path.join(tmpDir, `${stem}-pass${pass}.glb`);
    console.log(`    第 ${pass} 轮：${verts} 顶点 → ratio ${ratio.toFixed(3)} / error ${err}`);
    await gltf(['simplify', cur, out, '--ratio', String(ratio), '--error', String(err)]);
    if (cur !== stripped) await unlink(cur).catch(() => {});
    cur = out;
    const next = await vertexCount(cur);
    // 收敛不了就停：surface-net 网格由大量互不相连的壳组成，
    // meshoptimizer 只能逐壳简化，某些模型降到一半就再也压不动（suzuka 实测卡在 103 万）
    if (next > verts * 0.9) { verts = next; break; }
    verts = next;
  }
  await writeFile(simplified, await readFile(cur));
  if (cur !== simplified) await unlink(cur).catch(() => {});
  console.log(`    最终 ${verts} 顶点`);

  if (compress) {
    console.log('  · 压缩…');
    await gltf(['optimize', simplified, target, '--compress', 'meshopt']);
  } else {
    await writeFile(target, await readFile(simplified));
  }

  for (const f of [welded, stripped, simplified]) await unlink(f).catch(() => {});
}

async function prepareOne(charId) {
  const data = JSON.parse(await readFile(path.join(ROOT, 'assets/data/characters.json'), 'utf8'));
  const ch = data.characters.find((c) => c.id === charId);
  if (!ch) throw new Error(`未找到角色: ${charId}`);

  console.log(`\n▶ ${ch.name} (${charId})`);
  const src = path.basename(ch.image);
  // webp → png 之后塞进 ComfyUI 输入目录（ComfyUI 只读自己的 input/）
  await run('magick', [path.join(ROOT, ch.image), path.join(COMFY_INPUT, `src_${charId}.png`)], {
    cwd: ROOT,
  });

  // 先把源图复制进 ComfyUI 输入目录（ComfyUI 只能读自己的 input/）
  console.log('  · 抠图…');
  const iso = await isolate(charId, `src_${charId}.png`);

  const seed = Number(process.env.HUNY_SEED ?? ch.seed ?? 42);
  console.log(`  · Hunyuan3D 生成… (seed ${seed})`);
  const generated = await generate(charId, iso, seed, label ? `${charId}_${label}` : null);

  // 原始几何存进缓存：后处理（weld/简化）可重复执行而不会累积损失。
  // 直接对成品再简化一次，比例会叠乘，画质一路掉下去 —— 所以要留源。
  const cacheDir = path.join(ROOT, '.cache/3d-raw');
  await mkdir(cacheDir, { recursive: true });
  const raw = path.join(cacheDir, label ? `${label}.glb` : `${charId}.glb`);
  await writeFile(raw, await readFile(generated));

  const tmpDir = path.join(ROOT, '.tmp-3d');
  await mkdir(tmpDir, { recursive: true });
  const simplified = path.join(tmpDir, `${charId}-simplified.glb`);
  const target = path.join(ROOT, 'assets/models', `${charId}.glb`);

  await postprocess(raw, target, { compress: !noCompress });

  const buf = await readFile(target);
  const kb = buf.length / 1024;
  console.log(`  ✓ assets/models/${charId}.glb  ${kb.toFixed(0)} KB`);

  await unlink(simplified).catch(() => {});
  return { charId, kb };
}

try {
  // 只重跑几何后处理（weld/剥离/简化/压缩），不重新生成模型
  if (reprocess) {
    const dir = path.join(ROOT, 'assets/models');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.glb'));
    let total = 0;
    for (const f of files) {
      const abs = path.join(dir, f);
      const id = path.basename(f, '.glb');
      const source = path.join(ROOT, '.cache/3d-raw', f);
      if (!existsSync(source)) {
        console.log(`  – ${f} 跳过（无原始几何缓存，需重新生成）`);
        continue;
      }
      const before = (await readFile(abs)).length;
      await postprocess(source, abs, { compress: !noCompress });
      const after = (await readFile(abs)).length;
      total += after;
      console.log(`  ✓ ${f}  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB`);
    }
    console.log(`\n共 ${files.length} 个，合计 ${(total / 1024 / 1024).toFixed(2)} MB`);
    process.exit(0);
  }

  await freeVram();
  if (all) {
    const data = JSON.parse(await readFile(path.join(ROOT, 'assets/data/characters.json'), 'utf8'));
    const out = [];
    for (const c of data.characters) out.push(await prepareOne(c.id));
    const total = out.reduce((s, r) => s + r.kb, 0);
    console.log(`\n共 ${out.length} 个，合计 ${(total / 1024).toFixed(1)} MB`);
  } else {
    if (!only.length) throw new Error('请给出角色 id，或使用 --all');
    for (const id of only) await prepareOne(id);
  }
  await freeVram();
} catch (err) {
  console.error('\n✗', err.message);
  process.exit(1);
}
