/**
 * three.js — 单一入口，动态加载 vendor bundle
 *
 * 首页不引用本文件，只有在进入 3D 互动区时才 import()，
 * 因此 vendor/three/three.bundle.js 不会进入首屏关键路径。
 */
export * from '../../../vendor/three/three.bundle.js';
