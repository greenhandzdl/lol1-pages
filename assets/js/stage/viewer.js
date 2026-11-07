/**
 * viewer.js — 单片 3D 手办视图（第一期的完整闭环）
 *
 * 职责：懒加载 three.js → 建舞台 → 载模型 → 归一化 → 上色 → 交互循环
 * 任何一步失败都回落到 2D 图片，页面永不空白。
 */
import { shouldSkip3D } from './capability.js';
import { store } from '../store.js';

const SITE_ROOT = new URL("../../../", import.meta.url);

/** 手办归一化后的世界高度，与 rig.js 的 TARGET_HEIGHT 保持一致 */
const MODEL_HEIGHT = 1.8;

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

    /* 已加载模型的缓存。
       原本每换一次人都 loadAsync 一遍，来回切换时同一个人要重新下载
       220-470KB 再解析一遍 —— 实测从 sakura 切走再切回来，.glb 又请求了一次。

       存的是"模板"，显示时 clone 一份：一个 Object3D 不能同时挂在两个父节点下，
       而且显示中的那个会被 dispose（见下面交换模型的逻辑），
       缓存里必须留一份干净的。

       上限 3 个：12 个模型全常驻要吃不少显存，而人的浏览习惯是
       在当前这个人附近来回看，3 个够覆盖"上一个 / 下一个 / 当前"。 */
    this.modelCache = new Map(); // id -> THREE.Group（模板）
    this.cacheLimit = 3;
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

  /**
   * 按视锥几何算相机距离，让 1.8 高的手办正好铺满可用空间。
   *
   * 之前是写死 4.6（横屏）/ 5.4（竖屏）—— 竖屏反而拉远，手机上人物只占中间
   * 一小块，四周全是空白。正确做法是分别算「装下高度」和「装下宽度」需要多远，
   * 取较大的那个：竖屏宽度受限、横屏高度受限，这样两种比例都能填满。
   */
  _fit() {
    const st = this.stage;
    if (!st) return;
    const vFov = (st.camera.fov * Math.PI) / 180;
    // 留白：底部要空出提示条的位置，顶部留一点呼吸感
    const fillY = 0.8;
    const fillX = 0.88;
    const subjectH = MODEL_HEIGHT;
    const subjectW = MODEL_HEIGHT * 0.62; // 手办横向很少超过高度的 62%

    const distH = (subjectH / fillY) / 2 / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * st.camera.aspect);
    const distW = (subjectW / fillX) / 2 / Math.tan(hFov / 2);

    this.cameraBaseZ = Math.max(distH, distW);
    this.cameraBaseY = MODEL_HEIGHT * 0.5;
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
      // 命中缓存：直接 clone，不下载也不解析
      const cached = this.modelCache.get(ch.id);
      if (cached) {
        // 命中即刷新 LRU 顺序（Map 的插入顺序就是淘汰顺序）
        this.modelCache.delete(ch.id);
        this.modelCache.set(ch.id, cached);
        const { styleAsFigure } = await import('./figure.js');
        group = cached.clone(true);
        styleAsFigure(group, ch.palette);
        this.hasModel.add(ch.id);
        this.host.classList.add('has-model');
        store.markTurned(id);
      }
    }
    if (ch.model && !group) {
      try {
        const template = await this._loadTemplate(ch, ac.signal);
        if (!template || ac.signal.aborted) return;
        const { styleAsFigure } = await import('./figure.js');
        group = template.clone(true);
        styleAsFigure(group, ch.palette);
        this.hasModel.add(id);
        this.host.classList.add('has-model');
        // 模型真的加载成功才算「转过」——立牌模式不算
        store.markTurned(id);
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
    const wasShowingSomeone = this.currentId !== null;
    this.current = group;
    this.currentId = id;
    this.stage.world.add(group);
    this._fit();

    // 面板信息。第三个参数告诉页面这是"换人"还是"第一次显示" ——
    // 首次显示时模型本来就在淡入，再叠一个切换动画会闪两下。
    this.onChange?.(ch, !!ch.model, wasShowingSomeone);

    // 当前这个人到位之后，趁着空闲把左右邻居也拉进来。
    // 换人是这个页面的主要动作，而一次切换要 220-470KB，
    // 预取之后点「下一个」是瞬时的。
    this._prefetchNeighbors(id);
  }

  /**
   * 空闲时预取相邻两个角色的模型。
   *
   * 三条限制，都是为了不在别人手机上偷流量：
   *   1. 只在空闲时（requestIdleCallback，退化为 setTimeout）
   *   2. 省流量模式或 2G/3G 下不预取 —— 用户明确表示过要省流量
   *   3. 已经在缓存里的不重复取
   */
  _prefetchNeighbors(id) {
    const conn = navigator.connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /^(slow-2g|2g|3g)$/.test(conn.effectiveType)) return;

    const i = this.characters.findIndex((c) => c.id === id);
    if (i < 0) return;
    const n = this.characters.length;
    const targets = [this.characters[(i + 1) % n], this.characters[(i - 1 + n) % n]]
      .filter((c) => c && c.model && !this.modelCache.has(c.id) && c.id !== id);

    const run = () => {
      // 一次只预取一个，串行 —— 并行下载两个模型会把带宽从当前这个身上抢走，
      // 而当前这个是用户正在看的。
      const next = targets.shift();
      if (!next) return;
      this._loadTemplate(next).catch(() => {
        // 预取失败无所谓：用户真切过去时会重新走 show() 的完整路径
      });
      if (targets.length) {
        if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
        else setTimeout(run, 1500);
      }
    };

    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 1200);
  }

  /**
   * 下载并归一化一个模型，结果写进缓存，返回**未着色**的模板。
   *
   * 模板故意不上色：figure.js 的着色会改写材质，上过色的模板在换配色时
   * 会糊在一起。显示时 clone 一份再上色。
   *
   * show() 和预取都走这里，保证两条路径产出完全一致的模型 ——
   * 否则"预取过的"和"现载的"会有一点差别，切换时看得出来。
   */
  async _loadTemplate(ch, signal) {
    const { GLTFLoader } = this.THREE;
    this.loader ||= new GLTFLoader();
    // 模型用 meshopt 压缩过，必须提前注册解码器（单独按需下载 7.7KB）
    if (!this.loader.meshoptReady) {
      const { MeshoptDecoder } = await import('../../../vendor/three/meshopt_decoder.module.js');
      this.loader.setMeshoptDecoder(MeshoptDecoder);
      this.loader.meshoptReady = true;
    }
    const gltf = await this.loader.loadAsync(siteURL(ch.model));
    if (signal?.aborted) return null;
    const { normalizeModel } = await import('./rig.js');
    const rig = normalizeModel(gltf.scene, { yaw: ch.modelYaw || 0 });
    this._cache(ch.id, rig.group);
    return rig.group;
  }

  /** 存入模板并按 LRU 淘汰。 */
  _cache(id, template) {
    this.modelCache.set(id, template);
    while (this.modelCache.size > this.cacheLimit) {
      // Map 的第一个就是最久没用的
      const [oldId, old] = this.modelCache.entries().next().value;
      this.modelCache.delete(oldId);
      // 正在显示的那份是 clone 出来的，和模板不是同一个对象，可以安全 dispose
      disposeTree(old);
    }
  }

  /** 测试和调试用：现在缓存了几个人 */
  get cacheSize() {
    return this.modelCache.size;
  }

  _frame(dt) {
    this.controls.update(dt);
    if (this.current) {
      this.current.rotation.y = this.controls.yaw;
      this.current.rotation.x = this.controls.pitch * 0.55;
    }
    const cam = this.stage.camera;
    const baseY = this.cameraBaseY ?? MODEL_HEIGHT * 0.56;
    const baseZ = this.cameraBaseZ ?? 4.6;
    const z = baseZ / this.controls.zoom;
    cam.position.x += (0 - cam.position.x) * Math.min(1, dt * 8);
    cam.position.y += (baseY - cam.position.y) * Math.min(1, dt * 8);
    cam.position.z += (z - cam.position.z) * Math.min(1, dt * 8);
    // 看向模型重心（高度的一半）——写死 0.92 会让模型在画面里偏下
    const lookY = MODEL_HEIGHT * 0.5;
    if (this._lookY === undefined) this._lookY = lookY;
    this._lookY += (lookY - this._lookY) * Math.min(1, dt * 8);
    cam.lookAt(0, this._lookY, 0);
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
