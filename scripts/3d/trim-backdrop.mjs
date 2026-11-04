#!/usr/bin/env node
/**
 * trim-backdrop.mjs — 切掉模型背后的「背景板」
 *
 * 为什么会有背景板：
 * 插画里人物前后常有一块装饰性的背板（拱门、橱窗、彩带框）。Hunyuan3D 读的是
 * 正视图，无法区分「人物」和「人物身后的板」，于是把板也挤成一层薄壳，成品转动
 * 时背后挂着一片平面，怎么转都不像手办。
 *
 * 判据：手办主体在 Z 轴（前后轴）上应当有厚度，背景板则薄且贴在 Z 的两端。
 * 做法是把三角形按 Z 分 24 层，统计每层的 XY 投影面积，删掉「贴边且面积远大于
 * 平均」的层 —— 也就是板。实测插画背景板会独占约一半的投影面积，判据很稳。
 *
 * 既能当模块用（export trimBackdrop），也能当命令行工具用。
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const LAYERS = 24;
/** 贴边 2 层内，投影面积超过平均值的这个倍数，就认定是背景板 */
export const BACKDROP_RATIO = 1.8;

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {{ droppedLayers: number, triBefore: number, triAfter: number }}
 */
export function trimBackdrop(doc) {
  const root = doc.getRoot();
  const report = { droppedLayers: 0, triBefore: 0, triAfter: 0 };

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      if (!pos || !idx) continue;
      const src = idx.getArray();
      const triCount = src.length / 3;
      report.triBefore += triCount;

      const zc = new Float32Array(triCount);
      const area = new Float32Array(triCount);
      let zMin = Infinity;
      let zMax = -Infinity;
      for (let t = 0; t < triCount; t++) {
        const a = pos.getElement(src[t * 3], []);
        const b = pos.getElement(src[t * 3 + 1], []);
        const c = pos.getElement(src[t * 3 + 2], []);
        zc[t] = (a[2] + b[2] + c[2]) / 3;
        // XY 投影面积 = 叉积 z 分量的一半
        area[t] = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
        zMin = Math.min(zMin, zc[t]);
        zMax = Math.max(zMax, zc[t]);
      }

      const span = zMax - zMin || 1;
      const layerArea = new Float64Array(LAYERS);
      for (let t = 0; t < triCount; t++) {
        const l = Math.min(LAYERS - 1, Math.floor(((zc[t] - zMin) / span) * LAYERS));
        layerArea[l] += area[t];
      }
      const avgArea = layerArea.reduce((s, x) => s + x, 0) / LAYERS;

      const drop = new Uint8Array(LAYERS);
      let dropped = 0;
      for (let l = 0; l < LAYERS; l++) {
        const isEdge = l <= 1 || l >= LAYERS - 2;
        if (isEdge && layerArea[l] > avgArea * BACKDROP_RATIO) {
          drop[l] = 1;
          dropped++;
        }
      }
      if (!dropped) {
        report.triAfter += triCount;
        continue;
      }

      const keep = [];
      for (let t = 0; t < triCount; t++) {
        const l = Math.min(LAYERS - 1, Math.floor(((zc[t] - zMin) / span) * LAYERS));
        if (!drop[l]) keep.push(src[t * 3], src[t * 3 + 1], src[t * 3 + 2]);
      }
      if (!keep.length) {
        report.triAfter += triCount;
        continue;
      }

      // 只保留被引用的顶点，重映射索引
      const remap = new Int32Array(pos.getCount()).fill(-1);
      const newIdx = new Uint32Array(keep.length);
      let next = 0;
      for (let i = 0; i < keep.length; i++) {
        const old = keep[i];
        if (remap[old] === -1) remap[old] = next++;
        newIdx[i] = remap[old];
      }
      const newPos = new Float32Array(next * 3);
      const oldNormal = prim.getAttribute('NORMAL');
      const newNorm = oldNormal ? new Float32Array(next * 3) : null;
      for (let i = 0; i < pos.getCount(); i++) {
        if (remap[i] === -1) continue;
        const p = pos.getElement(i, []);
        newPos[remap[i] * 3] = p[0];
        newPos[remap[i] * 3 + 1] = p[1];
        newPos[remap[i] * 3 + 2] = p[2];
        if (newNorm) {
          const nv = oldNormal.getElement(i, []);
          newNorm[remap[i] * 3] = nv[0];
          newNorm[remap[i] * 3 + 1] = nv[1];
          newNorm[remap[i] * 3 + 2] = nv[2];
        }
      }

      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(newPos));
      if (newNorm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(newNorm));
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx));

      report.droppedLayers += dropped;
      report.triAfter += keep.length / 3;
    }
  }
  return report;
}

export function createIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

// ── 命令行入口 ──────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    console.error('用法: node scripts/3d/trim-backdrop.mjs <in.glb> <out.glb>');
    process.exit(1);
  }
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = createIO();
  const doc = await io.read(input);
  const r = trimBackdrop(doc);
  console.log(
    r.droppedLayers
      ? `  切掉 ${r.droppedLayers} 层背景板：三角面 ${r.triBefore} → ${r.triAfter}`
      : '  未发现背景板'
  );
  await io.write(output, doc);
}
