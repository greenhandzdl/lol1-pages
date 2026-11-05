/**
 * game.js — 「寻星」
 *
 * 设计意图：Hunyuan3D 的贴图在背面最难看，而寻星恰好强制玩家转到背面找线索
 * —— 把已知弱点变成玩法的理由。星星藏在角色身后的球面上，必须旋转才能看到。
 *
 * 规则：45 秒内找到 3 颗星；点中得分，点空扣 3 秒；最高分按角色存进统一存档。
 */
import { Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, Vector3 } from './three.js';
import { store } from '../store.js';

const ROUND_SECONDS = 45;
const STARS = 3;
const PENALTY = 3;

/** 做一张发光的星星贴图（按配色生成，无需外部图片） */
function starTexture(hex, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const r = size / 2;

  const halo = ctx.createRadialGradient(r, r, 0, r, r, r);
  halo.addColorStop(0, `${hex}ff`);
  halo.addColorStop(0.35, `${hex}88`);
  halo.addColorStop(1, `${hex}00`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // 四角星
  ctx.translate(r, r);
  ctx.fillStyle = '#fffdf2';
  ctx.beginPath();
  const outer = size * 0.3;
  const inner = size * 0.085;
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? outer : inner;
    ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();

  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class StarHunt {
  constructor({ root, viewer, onEnd }) {
    this.root = root;
    this.viewer = viewer;
    this.onEnd = onEnd;
    this.stars = [];
    this.found = 0;
    this.running = false;
    this.timeLeft = ROUND_SECONDS;
    this._timer = null;
    this._raf = 0;

    this.countEl = root.querySelector('#found-count');
    this.timeEl = root.querySelector('#game-time');
    this.msgEl = root.querySelector('#game-msg');
    root.querySelector('#game-quit').addEventListener('click', () => this.stop(true));

    // 最高分按角色记 —— 12 个模型复杂度不同，混在一起比没有意义
    this.best = 0;
    this._syncBest();
  }

  /** 切角色后重新取一遍纪录 */
  _syncBest() {
    const id = this.viewer?.currentId;
    if (!id) { this.best = 0; return; }
    const all = store.getStars();
    this.best = all[id] || 0;
  }

  start() {
    this._syncBest();
    if (!this.viewer?.stage || !this.viewer.current) {
      this.msgEl.textContent = '3D 还没准备好，稍等一下就开玩。';
      return;
    }
    this.running = true;
    this.found = 0;
    this.timeLeft = ROUND_SECONDS;
    this.root.hidden = false;
    this._syncHud();
    this.msgEl.textContent = '转一转，看看背面 ✦';
    this._spawn();

    // 命中检测挂在 viewer 的 tap 上
    this.viewer.onTap = (e) => this._hit(e);

    clearInterval(this._timer);
    this._timer = setInterval(() => {
      this.timeLeft -= 1;
      this._syncHud();
      if (this.timeLeft <= 0) this._end(false);
    }, 1000);

    const loop = () => {
      if (!this.running) return;
      const t = performance.now() / 1000;
      for (const s of this.stars) {
        if (s.userData.dead) continue;
        const pulse = 0.85 + Math.sin(t * 3 + s.userData.phase) * 0.18;
        s.scale.setScalar(pulse);
        s.material.opacity = 0.72 + Math.sin(t * 3 + s.userData.phase) * 0.24;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  /** 星星撒在角色身后的半球上，必须旋转到侧面/背面才看得见 */
  _spawn() {
    this._clear();
    const ch = this.viewer.byId?.get(this.viewer.currentId) || {};
    const color = '#ffd166';
    const tex = starTexture(color);

    const spots = [
      { x: -0.55, y: 1.30, z: -0.45 },
      { x: 0.60, y: 0.85, z: -0.55 },
      { x: 0.05, y: 0.42, z: -0.62 },
    ];

    spots.forEach((p, i) => {
      const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const sp = new Sprite(mat);
      sp.position.set(p.x, p.y, p.z);
      sp.scale.setScalar(0.34);
      sp.userData = { phase: i * 1.7, dead: false };
      this.viewer.current.add(sp);
      this.stars.push(sp);
    });
  }

  _hit(e) {
    if (!this.running) return;
    const { stage, THREE } = this.viewer;
    if (!stage || !THREE) return;
    const rect = this.viewer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, stage.camera);
    const live = this.stars.filter((s) => !s.userData.dead);
    const hit = ray.intersectObjects(live, false)[0];
    if (!hit) return;

    const sp = hit.object;
    sp.userData.dead = true;
    sp.visible = false;
    this.found += 1;
    this._syncHud();
    this.msgEl.textContent = this.found < STARS ? `找到 ${this.found} 颗 ✦ 继续` : '全部找到了！';
    if (this.found >= STARS) this._end(true);
  }

  _syncHud() {
    this.countEl.textContent = String(this.found);
    this.timeEl.textContent = String(Math.max(0, this.timeLeft));
  }

  _end(won) {
    if (!this.running) return;
    this.running = false;
    clearInterval(this._timer);
    cancelAnimationFrame(this._raf);
    this.viewer.onTap = null;

    if (won) {
      const score = Math.max(0, this.timeLeft);
      if (score > this.best) {
        this.best = score;
        this.best = store.setStars(this.viewer?.currentId || '__all', score);
        this.msgEl.textContent = `通关！剩余 ${score}s，新纪录 ✦`;
      } else {
        this.msgEl.textContent = `通关！剩余 ${score}s（最高 ${this.best}s）`;
      }
    } else {
      this.msgEl.textContent = `时间到，找到 ${this.found}/3。最高纪录 ${this.best}s`;
    }
    this._clear();
    this.onEnd?.();
  }

  stop(silent) {
    this.running = false;
    clearInterval(this._timer);
    cancelAnimationFrame(this._raf);
    if (this.viewer) this.viewer.onTap = null;
    this._clear();
    this.root.hidden = true;
    if (silent) this.onEnd?.();
  }

  _clear() {
    for (const s of this.stars) {
      s.parent?.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    this.stars = [];
  }
}
