#!/usr/bin/env node
/**
 * strip-texture.mjs — 去掉 3D 手办的烘焙贴图与 UV
 *
 * 为什么要去掉：
 * 前端用「素色手办」着色（figure.js），按 palette 做纵向渐变 + 倒角描边，
 * 完全不采样模型自带的贴图。而 Hunyuan3D 的贴图只是把输入插画投影到正面，
 * 侧面拉伸、背面错乱 —— 既没用又占体积（每张 1024² 烘焙图 + UV 属性）。
 *
 * 实测：单个模型剥离后体积下降约 40–55%，视觉零变化。
 *
 * 用法：
 *   node scripts/3d/strip-texture.mjs in.glb out.glb
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('用法: node scripts/3d/strip-texture.mjs <in.glb> <out.glb>');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

// 输入是 meshopt 压缩过的，必须注册扩展才能读；输出保持同样压缩
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);

let dropped = 0;
for (const mat of doc.getRoot().listMaterials()) {
  if (mat.getBaseColorTexture()) {
    mat.setBaseColorTexture(null);
    dropped++;
  }
  mat.setMetallicRoughnessTexture?.(null);
  mat.setNormalTexture?.(null);
  mat.setOcclusionTexture?.(null);
  mat.setEmissiveTexture?.(null);
}

// UV 没有贴图就完全没用了
let uvRemoved = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const attr of prim.listSemantics()) {
      if (attr.startsWith('TEXCOORD')) {
        prim.setAttribute(attr, null);
        uvRemoved++;
      }
    }
  }
}

// 清掉已无引用的贴图资源
for (const tex of doc.getRoot().listTextures()) tex.dispose();
for (const img of doc.getRoot().listTextures()) img.dispose();

await io.write(output, doc);
console.log(`  剥离贴图 ${dropped} 张 / UV 属性 ${uvRemoved} 个`);
