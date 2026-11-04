/**
 * viewer.js — 单片 3D 手办视图（第一期的完整闭环）
 *
 * 职责：懒加载 three.js → 建舞台 → 载模型 → 归一化 → 上色 → 交互循环
 * 任何一步失败都回落到 2D 图片，页面永不空白。
 */
import { shouldSkip3D } from './capability.js';

const SITE_ROOT = new URL("../../../", import.meta.url);

/** characters.json 里的路径都是相对站点根的（assets/...），在 /3d/ 下要显式解析 */
export const siteURL = (p) => new URL(String(p).replace(/^\.?\//, ''), SITE_ROOT).href;

export class Viewer {
  /**
   * @param {HTMLElement} host 容器（里面会有 canvas + 降级 img）
   * @param {object[]} characters  characters.json 的数组
   */
  constructor(host, characters) {
    this.host = host;
    this.characters = characters;
    this.byId = new Map(characters.map((c) => [c.id, c]));
    this.stage = null;
    this.controls = null;
    this.current = null;   // THREE.Group
    this.currentId = null;
    this.loader = null;
    this.abort = null;
    this.hasModel = new Set();
  }

  async init(initialId) {
    const skip = shouldSkip3D();
    if (skip) {
      this.fallback(skip);
      return false;
    }

    this.host.classList.add('is-3d');
    try {
      const [{ Stage }, { StageControls }, { normalizeModel }, { styleAsFigure }] = await Promise.all([
        import('./stage.js'),
        import('./controls.js'),
        import('./rig.js'),
        import('./figure.js'),
      ]);
      const THREE = await import('./three.js');

      const canvas = document.createElement('canvas');
      canvas.className = 'stage__canvas';
      canvas.setAttribute('role', 'img');
      canvas.tabIndex = 0;
      this.host.prepend(canvas);
      this.canvas = canvas;
      this.THREE = THREE;

      this.stage = new Stage(canvas, {
        onFrame: (dt) => this._frame(dt),
      });
      this.stage.onResize = () => this._fit();

      this.controls = new StageControls(canvas, {
        onTap: (e) => this._tap(e),
      });
      this.controls.attachKeys(canvas);

      // 观察可见性：滚出视口就停，省电
      if ('IntersectionObserver' in window) {
        this._io = new IntersectionObserver(
          ([en]) => (en.isIntersecting ? this.stage.resume() : this.stage.pause()),
          { threshold: 0.02 },
        );
        this._io.observe(this.host);
      }

      this.stage.start();
      await this.show(initialId || this.characters[0].id);
      return true;
    } catch (err) {
      console.warn('[3d] 初始化失败，回落 2D：', err);
      this.fallback('error');
      return false;
    }
  }

  _fit() {
    if (!this.stage) return;
    // 竖屏时把镜头抬高一点，避免 HUD 盖住头部
    const portrait = this.stage.height > this.stage.width;
    this.cameraBaseY = portrait ? 1.02 : 0.98;
    this.cameraBaseZ = portrait ? 5.4 : 4.6;
  }

  async show(id) {
    const ch = this.byId.get(id);
    if (!ch) return;
    // 换人时先停掉上一个的加载
    this.abort?.abort?.();

    const { GLTFLoader } = this.THREE;
    this.loader ||= new GLTFLoader();
    const ac = new AbortController();
    this.abort = ac;

    let group = null;
    if (ch.model) {
      try {
        // 模型用 meshopt 压缩过，必须提前注册解码器（单独按需下载 7.7KB）
        if (!this.loader.meshoptReady) {
          const { MeshoptDecoder } = await import('../../../vendor/three/meshopt_decoder.module.js');
          this.loader.setMeshoptDecoder(MeshoptDecoder);
          this.loader.meshoptReady = true;
        }
        const url = siteURL(ch.model);
        const gltf = await this.loader.loadAsync(url);
        if (ac.signal.aborted) return;
        const { normalizeModel } = await import('./rig.js');
        const { styleAsFigure } = await import('./figure.js');
        const rig = normalizeModel(gltf.scene, { yaw: ch.modelYaw || 0 });
        styleAsFigure(rig.group, ch.palette);
        group = rig.group;
        this.hasModel.add(id);
        this.host.classList.add('has-model');
      } catch (err) {
        console.warn(`[3d] 模型加载失败 ${id}：`, err);
        this.host.classList.remove('has-model');
      }
    }

    if (!group) {
      // 没有模型 → 立牌模式（用现有 WebP，零额外体积）
      const { buildBillboard } = await import('./billboard.js');
      group = await buildBillboard(ch, this.THREE);
      this.host.classList.remove('has-model');
    }

    // 交换
    if (this.current) {
      this.stage.world.remove(this.current);
      disposeTree(this.current);
    }
    this.current = group;
    this.currentId = id;
    this.stage.world.add(group);
    this._fit();

    // 面板信息
    this.onChange?.(ch, !!ch.model);
  }

  _frame(dt) {
    this.controls.update(dt);
    if (this.current) {
      this.current.rotation.y = this.controls.yaw;
      this.current.rotation.x = this.controls.pitch * 0.55;
    }
    const cam = this.stage.camera;
    const baseY = this.cameraBaseY ?? 1.0;
    const baseZ = this.cameraBaseZ ?? 4.6;
    const z = baseZ / this.controls.zoom;
    cam.position.x += (0 - cam.position.x) * Math.min(1, dt * 8);
    cam.position.y += (baseY - cam.position.y) * Math.min(1, dt * 8);
    cam.position.z += (z - cam.position.z) * Math.min(1, dt * 8);
    cam.lookAt(0, 0.92, 0);
  }

  _tap(e) {
    if (this.onTap) this.onTap(e, this.currentId);
  }

  fallback(reason) {
    this.host.classList.remove('is-3d');
    this.host.classList.add('is-2d');
    this.host.dataset.fallback = reason;
    this.onFallback?.(reason);
  }

  dispose() {
    this._io?.disconnect();
    this.controls?.dispose();
    this.stage?.dispose();
  }
}

function disposeTree(obj) {
  obj.traverse((o) => {
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
}
