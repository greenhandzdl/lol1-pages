/**
 * controls.js — 指针交互
 *
 * 手感规则（都来自真机考量）：
 * · 横向拖动 → 旋转角色；纵向拖动 → 轻微俯仰（限 ±18°，避免翻到底）
 * · 第一下必须判定方向：竖向滑动让给页面滚动，横向才接管旋转
 * · 松手有惯性，减动效时惯性关闭
 * · 双指缩放 → 相机距离
 * · 键盘 ←/→ 可旋转，保证无触摸也能用
 */
import { MathUtils } from './three.js';

const PITCH_LIMIT = MathUtils.degToRad(18);
const TAP_SLOP = 8;

export class StageControls {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.targetYaw = opts.yaw ?? 0;
    this.targetPitch = 0;
    this.yaw = this.targetYaw;
    this.pitch = 0;
    this.velocity = 0;

    this.zoom = 1;
    this.targetZoom = 1;
    this.minZoom = 0.62;
    this.maxZoom = 1.5;

    this.enabled = true;
    this.onTap = opts.onTap;
    this.onChange = opts.onChange;

    this._dragging = false;
    this._axisLock = null; // 'x' | 'y' | null
    this._pointerId = null;
    this._lastX = 0;
    this._lastY = 0;
    this._lastT = 0;
    this._startX = 0;
    this._startY = 0;
    this._moved = 0;
    this._pinch = null;

    this._bind();
    this._homeYaw = this.targetYaw;
  }

  /**
   * 回到初始角度。
   *
   * 拖了半天转到背面之后，原来没有任何办法回到正面 —— 只能朝着反方向
   * 再拖同样多，而拖多少算"回正"全靠手感。双击一下更符合直觉。
   */
  reset() {
    this.targetYaw = this._homeYaw;
    this.targetPitch = 0;
    this.targetZoom = 1;
    this.velocity = 0;
    this.onChange?.();
  }

  _bind() {
    const c = this.canvas;
    // pan-y：竖向手势交给页面滚动，横向留给旋转
    c.style.touchAction = 'pan-y';

    this._onDown = (e) => {
      if (!this.enabled) return;
      if (this._pointerId !== null) return;
      this._pointerId = e.pointerId;
      this._dragging = true;
      this._axisLock = null;
      this._lastX = this._startX = e.clientX;
      this._lastY = this._startY = e.clientY;
      this._lastT = performance.now();
      this._moved = 0;
      this.velocity = 0;
      c.setPointerCapture?.(e.pointerId);
    };

    this._onMove = (e) => {
      if (!this._dragging || e.pointerId !== this._pointerId) return;

      // 双指缩放
      if (this._pinch && this._pinch.size >= 2) {
        const pts = [...this._pinch.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._pinch.d0) {
          this.targetZoom = MathUtils.clamp(
            this._pinch.z0 * (this._pinch.d0 / d),
            this.minZoom,
            this.maxZoom,
          );
        }
        return;
      }

      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this._moved += Math.abs(dx) + Math.abs(dy);

      // 首次移动时锁定主轴，防止斜着滑一下页面乱跳
      if (!this._axisLock) {
        const ax = Math.abs(e.clientX - this._startX);
        const ay = Math.abs(e.clientY - this._startY);
        if (ax + ay < TAP_SLOP) return;
        this._axisLock = ax > ay ? 'x' : 'y';
        if (this._axisLock === 'y') {
          this._dragging = false;
          c.releasePointerCapture?.(e.pointerId);
          this._pointerId = null;
          return;
        }
      }
      if (this._axisLock !== 'x') return;

      const now = performance.now();
      const dt = Math.max(now - this._lastT, 8);
      this._lastT = now;

      this.targetYaw += dx * 0.0075;

      /* 俯仰角到边时做软阻尼，而不是直接 clamp 卡死。
         硬 clamp 的手感是"撞到一堵墙"：手还在动，画面不动，像卡了一下。
         改成越靠近边界、同样的手势挪动得越少 —— 手感上是"到头了"，
         而不是"坏了"。 */
      const want = this.targetPitch + dy * 0.0042;
      const over = Math.abs(want) / PITCH_LIMIT;
      if (over > 0.78) {
        // 从 78% 开始逐渐吃力，到 100% 时只再走 8%
        const ease = Math.max(0.08, 1 - (over - 0.78) / 0.22);
        this.targetPitch += dy * 0.0042 * ease;
        this.targetPitch = MathUtils.clamp(this.targetPitch, -PITCH_LIMIT, PITCH_LIMIT);
      } else {
        this.targetPitch = want;
      }

      // 估计松手瞬间的角速度（用于惯性）
      this.velocity = this.reduced ? 0 : (dx * 0.0075) / (dt / 1000);
      this.onChange?.();
    };

    this._onUp = (e) => {
      if (e.pointerId !== this._pointerId) return;
      const wasTap = this._moved < TAP_SLOP;
      this._dragging = false;
      this._pointerId = null;
      c.releasePointerCapture?.(e.pointerId);
      if (wasTap) this.onTap?.(e);
    };

    // 双击回正。用 dblclick 而不是自己数两次点击：
    // 浏览器已经处理了"两次点击间隔多长算双击"，移动端也会把它合成过来。
    this._onDblClick = () => {
      if (this.enabled) this.reset();
    };
    c.addEventListener('dblclick', this._onDblClick);

    c.addEventListener('pointerdown', this._onDown);
    c.addEventListener('pointermove', this._onMove, { passive: true });
    c.addEventListener('pointerup', this._onUp);
    c.addEventListener('pointercancel', this._onUp);

    // 滚轮缩放（桌面），passive:false 才能拦页面滚动
    this._onWheel = (e) => {
      if (!this.enabled) return;
      if (!e.ctrlKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      this.targetZoom = MathUtils.clamp(
        this.targetZoom * (1 + Math.sign(e.deltaY) * 0.08),
        this.minZoom,
        this.maxZoom,
      );
    };
    c.addEventListener('wheel', this._onWheel, { passive: false });

    // 双指
    this._onPinchStart = (e) => {
      this._pinch = new Map();
      for (const t of e.touches) this._pinch.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (this._pinch.size === 2) {
        const p = [...this._pinch.values()];
        this._pinch.d0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        this._pinch.z0 = this.targetZoom;
      }
    };
    this._onPinchMove = (e) => {
      if (!this._pinch) return;
      const pts = [...e.touches];
      if (pts.length === 2) {
        const d = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        if (this._pinch.d0) {
          this.targetZoom = MathUtils.clamp(
            (this._pinch.z0 * this._pinch.d0) / d,
            this.minZoom,
            this.maxZoom,
          );
        }
        e.preventDefault();
      }
    };
    this._onPinchEnd = () => { this._pinch = null; };
    c.addEventListener('touchstart', this._onPinchStart, { passive: true });
    c.addEventListener('touchmove', this._onPinchMove, { passive: false });
    c.addEventListener('touchend', this._onPinchEnd, { passive: true });

    this._onKey = (e) => {
      if (!this.enabled) return;
      const step = e.shiftKey ? Math.PI / 6 : Math.PI / 18;
      if (e.key === 'ArrowLeft') { this.targetYaw -= step; this.onChange?.(); }
      else if (e.key === 'ArrowRight') { this.targetYaw += step; this.onChange?.(); }
      else return;
      e.preventDefault();
    };
  }

  /** 键盘挂在容器上，避免和页面的 R 键快捷键打架 */
  attachKeys(el) {
    el.addEventListener('keydown', this._onKey);
    this._keyEl = el;
  }

  /** 每帧推进：惯性 + 阻尼 */
  update(dt) {
    if (!this._dragging) {
      this.targetYaw += this.velocity * dt;
      // 惯性衰减
      this.velocity *= Math.pow(0.06, dt);
      if (Math.abs(this.velocity) < 0.0015) this.velocity = 0;
    }

    const k = this.reduced ? 1 : Math.min(1, dt * 11);
    this.yaw += MathUtils.clamp((this.targetYaw - this.yaw) * k, -0.4, 0.4);
    this.pitch += (this.targetPitch - this.pitch) * Math.min(1, dt * 10);
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 9);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('dblclick', this._onDblClick);
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onUp);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('touchstart', this._onPinchStart);
    c.removeEventListener('touchmove', this._onPinchMove);
    c.removeEventListener('touchend', this._onPinchEnd);
    if (this._keyEl) this._keyEl.removeEventListener('keydown', this._onKey);
  }
}
