/**
 * stage.js — 3D 舞台：渲染器 / 相机 / 灯光 / 生命周期
 *
 * 设计要点：
 * · 全部用动态 import，首页零增量
 * · DPR 钳制，低端设备降到 1.5
 * · 滚出视口、页面隐藏时暂停 RAF（与现有 petals() 同款做法）
 * · 支持完整 dispose，切换角色不泄漏
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group,
  DirectionalLight, HemisphereLight, AmbientLight,
  Color, SRGBColorSpace, ACESFilmicToneMapping,
} from '../../../vendor/three/three.bundle.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export class Stage {
  constructor(canvas, { onFrame } = {}) {
    this.canvas = canvas;
    this.onFrame = onFrame;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setClearAlpha(0);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.05, 4.6);

    // 世界舞台：所有角色都挂在这一层
    this.world = new Group();
    this.scene.add(this.world);

    this._lights();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);

    this._running = false;
    this._raf = 0;
    this._clock = 0;
    this._last = performance.now();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });
  }

  _lights() {
    // 主光：从右上打，出柔和投影感
    const key = new DirectionalLight(0xfff4ec, 3.1);
    key.position.set(2.6, 4.2, 3.4);
    this.scene.add(key);

    // 补光：左侧冷色，压住暗部，避免素色模型发灰
    const fill = new DirectionalLight(0xdce8ff, 1.15);
    fill.position.set(-3.2, 1.6, 1.4);
    this.scene.add(fill);

    // 底光：轻微上扬，让衣摆和裙褶不死黑
    const rim = new DirectionalLight(0xffd9e6, 0.5);
    rim.position.set(-0.8, -2.4, -2.2);
    this.scene.add(rim);

    this.scene.add(new HemisphereLight(0xffffff, 0xf0d0de, 0.95));
    this.scene.add(new AmbientLight(0xffffff, 0.18));
  }

  _resize() {
    const host = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    // 窄屏或低端设备钳制更狠，保证 60fps 手感
    const cap = w < 640 ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w;
    this.height = h;
    this.onResize?.(w, h);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const dt = Math.min((now - this._last) / 1000, 0.05);
      this._last = now;
      this._clock += dt;
      this.onFrame?.(dt, this._clock, this);
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  pause() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  resume() {
    if (!document.hidden) this.start();
  }

  dispose() {
    this.pause();
    this._ro?.disconnect();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
  }
}
