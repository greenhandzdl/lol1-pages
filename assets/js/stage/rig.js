/**
 * rig.js — 模型归一化
 *
 * ComfyUI / Hunyuan3D 导出的 GLB 实测特征：
 *   · 只有 1 个 mesh，原点在**身体中心**（不是脚底）
 *   · glTF 里 Y 轴向上，但模型本身是 **Z 轴向上**生成的
 *   · 高度约 1.96、宽度约 1.45 世界单位
 *
 * 所以直接丢进场景会「脸朝天 + 陷进地板」。这里统一修正：
 *   转正 → 居中 → 脚底对齐 y=0 → 缩放到目标高度
 */
import { Box3, Group, Vector3, MathUtils } from './three.js';

const TARGET_HEIGHT = 1.8;

/**
 * @param {THREE.Object3D} root GLTF 的 scene
 * @returns {{ group: Group, height: number, box: Box3 }}
 */
export function normalizeModel(root, { yaw = 0 } = {}) {
  // 注意：glTF 文件本身已是 Y-up（Y span 1.96 / X 1.45 / Z 0.90）。
  // Blender 里看到的「Z-up」是导入器转换的结果，不是文件朝向 —— 别再加旋转。
  root.updateMatrixWorld(true);

  // 量出包围盒，居中对齐、脚底落到 y=0
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());

  const scale = TARGET_HEIGHT / (size.y || 1);

  const inner = new Group();
  inner.add(root);
  inner.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  inner.scale.setScalar(scale);

  // 外层留一个可以独立旋转的容器（角色自身朝向）
  // yaw 修正每个模型的「正脸方向」—— Hunyuan3D 输出朝向不统一，
  // 实测 umi / shiori 默认会侧对镜头，需要在 characters.json 里补 modelYaw。
  inner.rotation.y = yaw;

  const group = new Group();
  group.add(inner);
  group.userData.height = TARGET_HEIGHT;

  return { group, height: TARGET_HEIGHT, box };
}

/**
 * 让模型面向镜头时保持自然的轻微侧角，避免「证件照」感。
 * @param {Group} group
 * @param {number} rad
 */
export function setYaw(group, rad) {
  group.rotation.y = rad;
}

export const damp = MathUtils.damp;
