/**
 * capability.js — 能力探测
 *
 * 必须独立成一个「不 import three」的小模块：
 * 否则 viewer.js 顶层 import stage.js → stage.js 静态 import three.bundle
 * → ES module 一加载就必然下载整个 three，省流量/无 WebGL 的降级就形同虚设。
 */

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/** 省流量 / 弱网判断：命中就完全不下 three.js */
export function shouldSkip3D() {
  const conn = navigator.connection || {};
  if (conn.saveData) return 'save-data';
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return 'slow-network';
  if (!webglAvailable()) return 'no-webgl';
  return null;
}
