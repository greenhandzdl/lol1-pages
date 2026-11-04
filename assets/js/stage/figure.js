/**
 * figure.js — 素色手办材质
 *
 * 为什么不用生成出来的贴图：
 * Hunyuan3D 的贴图是把输入插画「投影」到正面，实测侧面拉伸、背面完全错乱。
 * 转起来一看就崩，所以这里改成风格化素色：
 *   · 按 characters.json 的 palette 做纵向渐变
 *   · 加一层反向外壳描边，轮廓清楚、显「手办」感
 *   · 灯光吃住体积，靠剪影和褶皱纹路认出角色
 */
import {
  Mesh, MeshStandardMaterial, MeshBasicMaterial, Color, BackSide, DoubleSide, FrontSide,
} from './three.js';

/** #rrggbb → THREE.Color（sRGB） */
const c = (hex) => new Color(hex);

/**
 * 给一个已加载的模型做「手办化」处理。
 * @param {THREE.Object3D} root  model root（已 normalize）
 * @param {string[]} palette     ['#ffd9e6', '#ffb7d5']
 * @param {{outline?: boolean}} opts
 */
export function styleAsFigure(root, palette, opts = {}) {
  // palette 是给 UI 用的浅色（#ffd9e6 之类），直接当模型底色会白成一片、看不出体积。
  // 手办化处理：顶部保留品牌色相但压低明度，底部进一步加深，保证轮廓与褶皱可读。
  const base = new Color(palette?.[1] || '#ffb7d5');
  const light = base.clone().lerp(new Color('#ffffff'), 0.18).multiplyScalar(0.92);
  const deep = base.clone().multiplyScalar(0.42);
  const { outline = true } = opts;

  root.traverse((o) => {
    if (!o.isMesh) return;

    // 清掉生成模型里那层错乱的投影贴图
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose?.();
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (v && v.isTexture) v.dispose();
    }

    const mat = new MeshStandardMaterial({
      color: light.clone(),
      roughness: 0.62,
      metalness: 0.0,
      flatShading: false,
    });

    // 纵向渐变：上浅下深，给素色一点层次
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTop = { value: light.clone() };
      shader.uniforms.uBottom = { value: deep.clone() };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvH = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;\nuniform vec3 uTop;\nuniform vec3 uBottom;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= mix(uBottom, uTop, smoothstep(0.06, 0.92, vH));',
        );
    };

    o.material = mat;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = true;
  });

  // 反向外壳描边：让轮廓在浅色背景上也立得住
  if (outline) {
    const shells = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      shells.push(o);
    });
    for (const o of shells) {
      const shellMat = new MeshBasicMaterial({
        color: deep.clone().multiplyScalar(0.55),
        side: BackSide,
        transparent: false,
      });
      const shell = new Mesh(o.geometry, shellMat);
      shell.scale.setScalar(1.006);
      shell.renderOrder = -1;
      o.add(shell);
    }
  }

  // 生成的网格是 doubleSided，正面渲染即可，背面交给外壳
  root.traverse((o) => {
    if (o.isMesh && o.material?.side === DoubleSide) o.material.side = FrontSide;
  });

  return root;
}
