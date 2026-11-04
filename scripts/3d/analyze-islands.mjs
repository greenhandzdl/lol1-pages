#!/usr/bin/env node
/**
 * analyze-islands.mjs — 看 GLB 由几个「不相连的块」组成
 *
 * 用途：Hunyuan3D 会把插画里的背景道具（风铃、桌椅、花架）一起生成为
 * 悬空孤岛，这些块既不在人身上、又会把包围盒撑大，导致前端归一化后
 * 人物被压到画面角落。这里把每块的位置和尺寸打出来，用于判断该剔除哪些。
 *
 * 用法：node scripts/3d/analyze-islands.mjs assets/models/foo.glb
 */
import { readFile } from 'node:fs/promises';

const file = process.argv[2];
const buf = await readFile(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8;

function accessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const start = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = a.count;
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n * 3; k++) out[k] = buf.readFloatLE(start + k * 4);
  return out;
}
function indices(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const start = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Uint32Array(a.count);
  const sz = { 5121: 1, 5123: 2, 5125: 4 }[a.componentType];
  for (let k = 0; k < a.count; k++) {
    out[k] = sz === 1 ? buf.readUInt8(start + k) : sz === 2 ? buf.readUInt16LE(start + k * 2) : buf.readUInt32LE(start + k * 4);
  }
  return out;
}

for (const mesh of json.meshes) {
  for (const prim of mesh.primitives) {
    const pos = accessor(prim.attributes.POSITION);
    const idx = prim.indices != null ? indices(prim.indices) : null;
    const nV = pos.length / 3;
    // 并查集按三角形连通
    const parent = new Int32Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const tri = idx ? idx.length / 3 : nV / 3;
    for (let t = 0; t < tri; t++) {
      const a = idx ? idx[t*3] : t*3, b = idx ? idx[t*3+1] : t*3+1, c = idx ? idx[t*3+2] : t*3+2;
      uni(a, b); uni(b, c);
    }
    const groups = new Map();
    for (let i = 0; i < nV; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const list = [...groups.values()].map((g) => {
      let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
      for (const i of g) for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], pos[i*3+k]); mx[k] = Math.max(mx[k], pos[i*3+k]);
      }
      return { n: g.length, size: mx.map((v,k)=>+(v-mn[k]).toFixed(3)), min: mn.map(v=>+v.toFixed(3)), max: mx.map(v=>+v.toFixed(3)) };
    }).sort((a,b)=>b.n-a.n);
    const total = list.reduce((s,g)=>s+g.n,0);
    console.log(`\n${file.replace(/.*\//,'')}  顶点 ${total}  块 ${list.length}`);
    list.slice(0, 10).forEach((g, i) => {
      const pct = (g.n / total * 100).toFixed(1);
      console.log(`  #${i} verts=${String(g.n).padStart(6)} (${pct.padStart(5)}%) y=[${g.min[1]}, ${g.max[1]}] 尺寸=${g.size}`);
    });
  }
}
