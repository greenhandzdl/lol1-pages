/**
 * billboard.js — 立牌模式
 *
 * 还没有 3D 模型的角色，用现有 WebP 做成 3D 空间里的「纸片人」：
 * · 一块带柔和描边的面板，正反两面（背面是镜像，不显得空）
 * · 同样可以拖拽旋转、缩放，交互手感和真模型一致
 * · 零额外下载（复用首页已经在用的插画）
 */
import {
  Group, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, DoubleSide,
  Color, SRGBColorSpace, TextureLoader,
} from './three.js';

const RATIO = 3 / 4; // 插画是 768×1024

/**
 * @param {object} ch characters.json 里的一项
 * @param {object} THREE
 * @returns {Promise<Group>}
 */
export async function buildBillboard(ch, THREE) {
  const group = new Group();
  const { siteURL } = await import('./viewer.js');

  const tex = await new Promise((resolve, reject) => {
    new TextureLoader().load(siteURL(ch.image), resolve, undefined, reject);
  });
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;

  const h = 1.8;
  const w = h * RATIO;

  const face = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false }),
  );
  face.position.y = h / 2;
  group.add(face);

  // 描边光晕：让纸片在浅背景上有厚度感
  const glow = new Mesh(
    new PlaneGeometry(w * 1.028, h * 1.02),
    new MeshBasicMaterial({
      color: new Color(ch.palette?.[1] || '#ffb7d5'),
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  glow.position.set(0, h / 2, -0.004);
  group.add(glow);

  group.userData.isBillboard = true;
  return group;
}

/** 合成立牌用的圆形底色（可选，当前未启用） */
export function softDisc(color) {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, `${color}cc`);
  g.addColorStop(1, `${color}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}
