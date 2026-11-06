/**
 * app.js — 3D 手办台页面入口
 *
 * 首屏只加载这份小文件 + 角色 JSON；three.js 在 Viewer.init 里动态拉取。
 * 无 WebGL / 省流量 / 加载失败 → 自动切图片模式，不白屏。
 */
import { Viewer, siteURL } from './viewer.js';
import { accentVars } from '../accent.js';
import { glyphSvg } from '../glyphs.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STORE_THEME = 'lol1:theme';

const state = {
  all: [],
  index: 0,
  viewer: null,
  game: null,
};

/* ---------- 主题 ---------- */
function initTheme() {
  // 与首页同 id；旧标记里叫 #theme-btn，两个都认一下更稳
  const btn = $('#theme-btn') || $('#theme-toggle');
  if (!btn) return;
  const sync = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    btn.setAttribute('aria-pressed', String(dark));
  };
  sync();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORE_THEME, next); } catch { /* ignore */ }
    sync();
  });
}

/* ---------- 面板渲染 ---------- */
/**
 * 把当前角色的 accent 变量挂到 .page-stage 上。
 *
 * 之前视口背景是固定的粉色渐变，12 个人在台子上是同一个房间；
 * 现在背景、地台光晕、侧栏强调色都跟着 palette 走。
 * transition 放在 CSS 里（viewport/侧栏都写了 transition），
 * 换人时颜色平滑过渡而不是硬切。
 */
function paintAccent(ch) {
  const root = $('.page-stage');
  if (!root || !ch.palette) return;
  const vars = accentVars(ch.palette);
  root.style.setProperty('--pa', vars['--pa']);
  root.style.setProperty('--pb', vars['--pb']);
  root.style.setProperty('--pa-ink', vars['--pa-ink']);
}

function paintPanel(ch, hasModel) {
  paintAccent(ch);
  $('#stage-region').textContent = `${ch.region} · ${ch.element}`;
  $('#stage-name').textContent = ch.name;
  $('#stage-title').textContent = `${ch.nameEn} · ${ch.title}`;
  $('#stage-tagline').textContent = `“${ch.tagline}”`;
  $('#stage-element').textContent = ch.element;
  $('#stage-region2').textContent = ch.region;
  $('#stage-tags').textContent = ch.tags.slice(0, 3).join(' / ');
  $('#stage-credit').textContent = hasModel
    ? `${ch.modelCredit || 'AI 生成几何'} · 素色手办着色`
    : '3D 模型还在赶工，先用立牌模式陪你玩';

  const fallback = $('#fallback-img');
  if (fallback) {
    fallback.src = siteURL(ch.image);
    fallback.alt = `插画：${ch.name} · ${ch.title}`;
  }

  // 缩略图条的高亮跟着换。strip 可能在 paintPanel 第一次调用之后才渲染，
  // 所以这里查不到就算了，不报错。
  const strip = $('#stage-strip');
  if (strip) {
    strip.querySelectorAll('.stage__thumb').forEach((b) => {
      if (b.dataset.id === ch.id) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
  }
}

function setState(s) {
  const root = $('.stage');
  root.dataset.state = s;
  $('#loading').hidden = s !== 'loading';
  // ready 时藏起提示；error / fallback 都显示（fallback 的文案是「已切换图片模式」）
  $('#stage-error').hidden = s === 'ready' || s === 'loading';
}

/* ---------- 角色切换 ---------- */
async function go(step) {
  const n = state.all.length;
  state.index = (state.index + step + n) % n;
  const ch = state.all[state.index];
  paintPanel(ch, !!ch.model);
  if (state.viewer) await state.viewer.show(ch.id);
  syncURL(ch.id);
}

function syncURL(id) {
  const p = new URLSearchParams(location.search);
  if (id) p.set('id', id); else p.delete('id');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/* ---------- 初始化 ---------- */
async function init() {
  initTheme();
  setState('loading');

  let data;
  try {
    const res = await fetch(new URL('../../data/characters.json', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    setState('error');
    $('#stage-error').firstElementChild.textContent = `角色数据加载失败（${err.message}）。`;
    return;
  }

  state.all = data.characters;
  const wanted = new URLSearchParams(location.search).get('id');
  const found = state.all.findIndex((c) => c.id === wanted);
  state.index = found >= 0 ? found : 0;
  const ch = state.all[state.index];
  paintPanel(ch, !!ch.model);
  syncURL(ch.id);

  const viewer = new Viewer($('#viewport'), state.all);
  state.viewer = viewer;
  viewer.onFallback = () => setState('fallback');
  viewer.onChange = (c, hasModel) => {
    paintPanel(c, hasModel);
    const i = state.all.findIndex((x) => x.id === c.id);
    if (i >= 0) state.index = i;
  };

  // 调试句柄：便于自动化测试断言 yaw/资源回收（不影响正常使用）
  if (new URLSearchParams(location.search).has('debug')) window.__v = viewer;

  const ok = await viewer.init(ch.id);
  // 降级不是错误：onFallback 已把状态置为 'fallback'，这里别覆盖回 error
  if (ok) setState('ready');
  else if ($('.stage').dataset.state !== 'fallback') setState('error');
  if (!ok) {
    $('#stage-error').firstElementChild.textContent =
      '这台设备或网络暂时放不了 3D，已切换为图片模式。';
  }

  $('#prev-btn').addEventListener('click', () => go(-1));
  $('#next-btn').addEventListener('click', () => go(1));

  // 缩略图条：12 个人一眼看全，「上一个 / 下一个」只能一格格挪。
  // 图是离线渲染好的（scripts/build-model-thumbs.py），点一下才加载 glb。
  const strip = $('#stage-strip');
  if (strip) {
    strip.innerHTML = state.all
      .map(
        (c) => `<button class="stage__thumb" type="button" data-id="${c.id}"
          aria-label="看 ${c.name} 的手办"${c.id === ch.id ? ' aria-current="true"' : ''}>
          ${c.model ? `<img src="/assets/img/models/${c.id}.png" width="48" height="48" alt="" loading="lazy" decoding="async">` : `<span>${glyphSvg(c.element, { size: 22 })}</span>`}
          <em>${c.name}</em>
        </button>`,
      )
      .join('');
    strip.addEventListener('click', (e) => {
      const btn = e.target.closest('.stage__thumb');
      if (!btn) return;
      const i = state.all.findIndex((x) => x.id === btn.dataset.id);
      if (i >= 0) state.viewer?.show?.(state.all[i].id);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    // 3D 舞台自己处理方向键（旋转），这里只负责换人
    if (e.target.closest?.('.stage__canvas')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  });

  // 触屏左右滑动切换（竖向留给页面滚动）
  let sx = 0, sy = 0;
  const vp = $('#viewport');
  vp.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  vp.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // 小游戏懒加载：只有点了才开始
  $('#game-btn').addEventListener('click', async () => {
    if (!state.game) {
      const { StarHunt } = await import('./game.js');
      state.game = new StarHunt({
        root: $('#game'),
        viewer,
        onEnd: () => $('#game-btn').removeAttribute('disabled'),
      });
    }
    state.game.start();
  });
}

init();
