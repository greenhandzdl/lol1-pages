/* lol1.moe · 萝莉图鉴 — vanilla ES module */
import { collapseNav } from './nav-collapse.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_FAVS = 'lol1:favs';
const STORE_THEME = 'lol1:theme';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  all: [],
  q: '',
  tag: '',
  sort: 'default',
  favOnly: false,
  order: [],
  favs: new Set(),
  currentId: null,
  trigger: null,
};

/* ---------- storage ---------- */

function loadFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_FAVS) || '[]');
    state.favs = new Set(Array.isArray(raw) ? raw : []);
  } catch {
    state.favs = new Set();
  }
}

function saveFavs() {
  try {
    localStorage.setItem(STORE_FAVS, JSON.stringify([...state.favs]));
  } catch {
    /* private mode — keep the session state */
  }
}

/* ---------- data helpers ---------- */

const byId = (id) => state.all.find((c) => c.id === id);
const pad2 = (n) => String(n).padStart(2, '0');

function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.all.filter((c) => {
    if (state.favOnly && !state.favs.has(c.id)) return false;
    if (state.tag && !c.tags.includes(state.tag)) return false;
    if (!q) return true;
    return [c.name, c.nameEn, c.title, c.region, c.element, ...c.tags]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
  if (state.sort === 'name') {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  } else if (state.sort === 'random') {
    const pos = new Map(state.order.map((id, i) => [id, i]));
    list = [...list].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  } else {
    list = [...list].sort((a, b) => (state.original.get(a.id) ?? 0) - (state.original.get(b.id) ?? 0));
  }
  return list;
}

/* ---------- rendering ---------- */

/**
 * 由原图路径推出 srcset。
 * 原图是 768×1024，另有 -400 / -600 两档（scripts/img/build-srcset.mjs 生成）。
 * 最大档直接用原图，所以没有 -768（实测那一档只小 2KB，不值得多 12 个文件）。
 */
function imgSrcset(image) {
  const stem = image.replace(/\.webp$/, '');
  return `${stem}-400.webp 400w, ${stem}-600.webp 600w, ${image} 768w`;
}

function cardHTML(c, index) {
  const liked = state.favs.has(c.id);
  const tags = c.tags.map((t) => `<span class="tag">${t}</span>`).join('');
  return `
    <article class="card reveal" data-id="${c.id}">
      <button class="card__body" type="button" aria-haspopup="dialog" aria-label="查看 ${c.name} 的档案">
        <span class="card__media">
          <img src="${c.image}" srcset="${imgSrcset(c.image)}"
               sizes="(max-width: 860px) 46vw, 30vw"
               alt="插画：${c.name} · ${c.title}" width="768" height="1024" loading="lazy" decoding="async">
          <span class="card__badge">NO.${pad2(index + 1)}</span>
          <span class="card__hint" aria-hidden="true">翻开她的档案 →</span>
        </span>
        <span class="card__info">
          <span class="card__name">${c.name}<small>${c.nameEn}</small></span>
          <span class="card__title">${c.title}</span>
          <span class="card__tags">${tags}</span>
        </span>
      </button>
      <button class="card__like" type="button" aria-pressed="${liked}" aria-label="收藏 ${c.name}">${liked ? '♥' : '♡'}</button>
    </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  const list = filtered();
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><b>这里暂时没有小小居民</b>换个关键词，或者清空收藏筛选再看看。</div>`;
  } else {
    grid.innerHTML = list
      .map((c) => cardHTML(c, state.all.indexOf(c)))
      .join('');
  }
  $('#count').textContent = state.favOnly
    ? `${list.length} 位收藏`
    : `共 ${list.length} 位`;
  bindCards();
  observeReveals();
  syncURL();
}

function renderChips() {
  const tags = [];
  state.all.forEach((c) => c.tags.forEach((t) => { if (!tags.includes(t)) tags.push(t); }));
  const chips = $('#chips');
  chips.innerHTML =
    `<button class="chip" type="button" data-tag="" aria-pressed="${state.tag === ''}">全部</button>` +
    tags.map((t) => `<button class="chip" type="button" data-tag="${t}" aria-pressed="${state.tag === t}">${t}</button>`).join('');
  $$('#chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.tag = chip.dataset.tag;
      $$('#chips .chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.tag === state.tag)));
      renderGrid();
    });
  });
}

function bindCards() {
  $$('#grid .card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('.card__body').addEventListener('click', () => openDetail(id, card.querySelector('.card__body')));
    const like = card.querySelector('.card__like');
    like.addEventListener('click', () => toggleFav(id, like));
    const img = card.querySelector('img');
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true });
  });
}

let revealIO = null;

function observeReveals() {
  if (!('IntersectionObserver' in window)) {
    $$('.reveal').forEach((el) => el.classList.add('is-in'));
    return;
  }
  if (!revealIO) {
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealIO.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  }
  $$('.reveal:not(.is-in)').forEach((el) => revealIO.observe(el));
}

/* ---------- favorites ---------- */

function toggleFav(id, button) {
  const c = byId(id);
  if (!c) return;
  if (state.favs.has(id)) {
    state.favs.delete(id);
    toast(`已把 ${c.name} 放回图鉴`);
  } else {
    state.favs.add(id);
    toast(`已把 ${c.name} 收进口袋 ♥`);
  }
  saveFavs();
  const pressed = state.favs.has(id);
  if (button) {
    button.setAttribute('aria-pressed', String(pressed));
    button.textContent = pressed ? '♥' : '♡';
  }
  if (state.currentId === id) syncDetailLike();
  if (state.favOnly) renderGrid();
  updateFavToggle();
}

function updateFavToggle() {
  const btn = $('#fav-toggle');
  btn.setAttribute('aria-pressed', String(state.favOnly));
  btn.textContent = state.favOnly ? '♥ 只看收藏' : '♡ 只看收藏';
}

/* ---------- dialog ---------- */

function openDetail(id, trigger) {
  const c = byId(id);
  if (!c) return;
  let list = filtered();
  let idx = list.findIndex((x) => x.id === id);
  if (idx === -1) {
    list = state.all;
    idx = list.findIndex((x) => x.id === id);
  }
  state.currentId = id;
  if (trigger) state.trigger = trigger;

  const dialog = $('#detail');
  $('#detail-img').style.visibility = '';
  $('#detail-img').src = c.image;
  $('#detail-img').alt = `插画：${c.name} · ${c.title}`;
  $('#detail-eyebrow').textContent = `${c.region} · ${c.element}`;
  $('#detail-name').textContent = c.name;
  $('#detail-en').textContent = c.nameEn;
  $('#detail-tagline').textContent = `“${c.tagline}”`;
  $('#detail-bio').textContent = c.bio;
  $('#detail-region').textContent = c.region;
  $('#detail-element').textContent = c.element;
  $('#detail-artist').textContent = c.artist;
  $('#detail-license').textContent = c.license;
  $('#detail-tags').innerHTML = c.tags.map((t) => `<span class="tag">${t}</span>`).join('');
  const indexEl = $('#detail-index');
  indexEl.textContent = idx >= 0 ? `${idx + 1} / ${list.length}` : '';

  // 弹窗里给出该角色的独立页入口，让 /c/<id>/ 不是孤儿页
  const pageLink = $('#detail-page');
  if (pageLink) pageLink.href = `c/${encodeURIComponent(c.id)}/`;
  state.listIds = list.map((x) => x.id);
  syncDetailLike();

  const closeBtn = $('#detail-close');
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) {
      dialog.showModal();
      document.body.classList.add('is-locked');
      closeBtn.focus();
    }
  } else {
    dialog.setAttribute('open', '');
  }
  $('#detail-img').addEventListener('error', () => {
    $('#detail-img').style.visibility = 'hidden';
  }, { once: true });
  syncURL();
}

function syncDetailLike() {
  const liked = state.favs.has(state.currentId);
  const btn = $('#detail-like');
  btn.setAttribute('aria-pressed', String(liked));
  btn.textContent = liked ? '♥ 已收进口袋' : '♡ 收进口袋';
}

function moveDetail(step) {
  const list = state.listIds || [];
  if (!list.length) return;
  const current = list.indexOf(state.currentId);
  const next = (current + step + list.length) % list.length;
  openDetail(list[next]);
}

function closeDetail() {
  const dialog = $('#detail');
  if (!dialog.open) return;
  dialog.close();
  document.body.classList.remove('is-locked');
  state.currentId = null;
  if (state.trigger) state.trigger.focus();
  syncURL();
}

/* ---------- url ---------- */

function syncURL() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  if (state.sort !== 'default') params.set('sort', state.sort);
  if (state.favOnly) params.set('fav', '1');
  if (state.currentId) params.set('id', state.currentId);
  if (document.documentElement.dataset.theme === 'dark') params.set('theme', 'dark');
  const qs = params.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname + location.hash);
}

function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') || '';
  state.tag = p.get('tag') || '';
  state.sort = ['default', 'random', 'name'].includes(p.get('sort')) ? p.get('sort') : 'default';
  state.favOnly = p.get('fav') === '1';
  return p.get('id');
}

/* ---------- toast ---------- */

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2200);
}

/* ---------- theme ---------- */

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORE_THEME, theme); } catch { /* ignore */ }
  const btn = $('#theme-toggle');
  btn.setAttribute('aria-pressed', String(theme === 'dark'));
  syncURL();
}

/* ---------- petals ---------- */

function petals() {
  if (reducedMotion) return;
  const canvas = $('#petals');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;
  let w = 0, h = 0, raf = 0, running = true;
  const petalsArr = [];
  const colors = ['#ffb7d5', '#ffd3e3', '#ffc2d8', '#e8d5ff', '#ffe0ec'];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function size() {
    const rect = hero.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    petalsArr.length = 0;
    const count = Math.min(34, Math.max(12, Math.round(w / 42)));
    for (let i = 0; i < count; i += 1) {
      petalsArr.push({
        x: Math.random() * w,
        y: Math.random() * h,
        size: 4 + Math.random() * 7,
        vy: 0.25 + Math.random() * 0.55,
        drift: 0.4 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.02,
        color: colors[(Math.random() * colors.length) | 0],
        alpha: 0.35 + Math.random() * 0.45,
      });
    }
  }

  function petalPath(s) {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.9, -s * 0.6, s * 0.8, s * 0.55, 0, s);
    ctx.bezierCurveTo(-s * 0.8, s * 0.55, -s * 0.9, -s * 0.6, 0, -s);
    ctx.closePath();
  }

  let t = 0;
  function frame() {
    if (!running) return;
    t += 0.016;
    ctx.clearRect(0, 0, w, h);
    for (const p of petalsArr) {
      p.y += p.vy;
      p.x += Math.sin(t * 1.3 + p.phase) * p.drift * 0.45;
      p.rot += p.vr;
      if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w; }
      if (p.x > w + 20) p.x = -20;
      if (p.x < -20) p.x = w + 20;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      petalPath(p.size);
      ctx.fill();
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    size();
    seed();
    cancelAnimationFrame(raf);
    running = true;
    raf = requestAnimationFrame(frame);
  }

  new ResizeObserver(() => { size(); seed(); }).observe(hero);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(raf);
    } else if (!running) {
      running = true;
      raf = requestAnimationFrame(frame);
    }
  });
  start();
}

/* ---------- init ---------- */

async function init() {
  collapseNav();
  loadFavs();
  const deepLink = readURL();

  try {
    const res = await fetch(new URL('../data/characters.json', import.meta.url));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.all = data.characters;
  } catch (err) {
    $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><b>图鉴暂时打不开</b>数据加载失败了（${err.message}）。刷新一下试试，或者稍后再来。</div>`;
    return;
  }

  state.order = state.all.map((c) => c.id);
  state.original = new Map(state.all.map((c, i) => [c.id, i]));
  if (state.sort === 'random') state.order = shuffle(state.order);
  if (state.tag && !state.all.some((c) => c.tags.includes(state.tag))) state.tag = '';

  $('#search').value = state.q;
  renderChips();
  updateFavToggle();
  $('#sort').value = state.sort;
  if (state.favOnly) $('#fav-toggle').setAttribute('aria-pressed', 'true');

  renderGrid();
  petals();

  if (deepLink) {
    const c = byId(deepLink);
    if (c) setTimeout(() => openDetail(deepLink), 60);
  }

  $('#search').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderGrid();
  });

  $('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    if (state.sort === 'random') {
      state.order = shuffle(state.order);
      toast('小小居民们换了个队形 ✿');
    }
    renderGrid();
  });

  $('#fav-toggle').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    updateFavToggle();
    renderGrid();
    if (state.favOnly) toast(state.favs.size ? '只显示你收进口袋的孩子' : '口袋里还是空的，先点几颗爱心吧');
  });

  $('#random-btn').addEventListener('click', () => {
    const list = filtered().length ? filtered() : state.all;
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    openDetail(pick.id);
  });

  $('#theme-toggle').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-like').addEventListener('click', () => toggleFav(state.currentId));
  $('#detail-prev').addEventListener('click', () => moveDetail(-1));
  $('#detail-next').addEventListener('click', () => moveDetail(1));

  const dialog = $('#detail');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDetail();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    if (state.trigger) state.trigger.focus();
    state.currentId = null;
    syncURL();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') moveDetail(-1);
    if (e.key === 'ArrowRight') moveDetail(1);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey && !dialog.open) {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const list = filtered().length ? filtered() : state.all;
      const pick = list[Math.floor(Math.random() * list.length)];
      if (pick) openDetail(pick.id);
    }
  });

  const themeBtn = $('#theme-toggle');
  themeBtn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

init();
