/* lol1.moe · 萝莉图鉴 — vanilla ES module */
import { collapseNav } from './nav-collapse.js';
import { store, todayKey } from './store.js';
import { pickOfDay, lineOfDay } from './daily.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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

// 存档统一走 store.js：它负责旧键迁移与无痕模式降级
function loadFavs() {
  state.favs = store.getFavs();
}

function saveFavs() {
  store.setFavs(state.favs);
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


/**
 * 地域视图 —— 12 个地名原本只作为角色档案里的一个字段出现，
 * 这里把它提升成结构：每个人住的地方互不相同，所以一个地名正好对应一个人。
 * 点地名 = 把图鉴筛到那一位，并滚过去。
 */
function renderRegions() {
  const host = $('#regions-grid');
  if (!host) return;
  host.innerHTML = state.all
    .map((c) => {
      const [a, b] = c.palette || ['#ffd9e6', '#ffb7d5'];
      return `<button class="region" type="button" data-id="${c.id}"
                style="--ra:${a};--rb:${b}">
          <span class="region__name">${c.region}</span>
          <span class="region__who">${c.name}</span>
          <span class="region__el">${c.element}</span>
        </button>`;
    })
    .join('');

  $$('#regions-grid .region').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = byId(btn.dataset.id);
      if (!c) return;
      // 复用图上已有的搜索框作为筛选手段，保证"地域"和"搜索"是同一套状态
      state.q = c.region;
      const input = $('#search');
      if (input) input.value = c.region;
      renderGrid();
      document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}


/**
 * 图鉴完成度 —— 把"看过的"变成"攒下的"。
 *
 * 四项各自独立，因为它们是四种不同的投入：
 *   看过  点开过档案（最容易，进门就算）
 *   收藏  主动存下来
 *   转过  在 3D 台转过的（需要模型加载成功，成本比"看过"高）
 *   寻星  玩过小游戏
 * 不做成一条总和，是因为把它们相加没有意义 —— 只是想让人看到还有哪些没碰过。
 */
function renderProgress() {
  const host = $('#progress');
  if (!host) return;
  const total = state.all.length || 1;
  const seen = store.getSeen();
  const stars = store.getStars();
  const turned = store.getTurned();
  const rows = [
    { key: 'seen', label: '看过档案', n: state.all.filter((c) => seen.has(c.id)).length, total },
    { key: 'fav', label: '收进口袋', n: state.favs.size, total },
    { key: 'turn', label: '转过手办', n: turned.size, total },
    { key: 'star', label: '寻星通关', n: Object.keys(stars).filter((k) => k !== '__all').length, total },
  ];
  host.innerHTML = rows
    .map((r) => {
      const pct = Math.round((Math.min(r.n, r.total) / r.total) * 100);
      return `<div class="prog" data-key="${r.key}">
        <div class="prog__top"><span>${r.label}</span><b>${Math.min(r.n, r.total)}<i>/${r.total}</i></b></div>
        <div class="prog__bar" role="img" aria-label="${r.label} ${pct}%"><span style="width:${pct}%"></span></div>
      </div>`;
    })
    .join('');
}


/**
 * 每日一抽 —— 首页的"今天是她"。
 * 用日期做确定性种子：同一天任何人进来看到的都是同一位，跨天才换。
 * 抽到谁不落库（可以重复看），只把"今天抽过"记进存档，用于完成度统计。
 */
function renderDaily() {
  const host = $('#daily-body');
  if (!host) return;
  const key = todayKey();
  const c = pickOfDay(state.all, key);
  if (!c) { host.innerHTML = ''; return; }
  store.setSpin(key, c.id);

  const stem = c.image.replace(/\.webp$/, '');
  host.innerHTML = `
    <a class="daily__face" href="/c/${c.id}/" aria-label="看 ${c.name} 的档案">
      <img src="${c.image}"
           srcset="${stem}-400.webp 400w, ${stem}-600.webp 600w, ${c.image} 768w"
           sizes="120px" width="768" height="1024" loading="lazy" decoding="async"
           alt="${c.name}">
    </a>
    <div class="daily__text">
      <p class="daily__name">${c.name}<span>${c.title}</span></p>
      <p class="daily__line">“${lineOfDay(key)}”</p>
      <a class="btn btn--ghost btn--small" href="/c/${c.id}/">看看她 →</a>
    </div>`;
}


/**
 * 关系网全景。
 *
 * 38 条关系原本只在各自的角色页里出现，看不到整体形状。
 * 这里用圆周布局：12 个人均匀排在一个圈上，谁和谁有关系就拉一条线。
 *
 * 用 SVG 而不是 canvas：12 个节点 + 38 条线，SVG 的点击与无障碍都更省事，
 * 而且线宽和文字能跟着主题色走。
 */
function renderWeb() {
  const host = $('#web-graph');
  if (!host) return;

  const R = 42;            // 半径（百分比），留出放标签的位置
  const CX = 50, CY = 50;
  const pos = new Map();
  state.all.forEach((c, i) => {
    const ang = (i / state.all.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(c.id, {
      x: CX + Math.cos(ang) * R,
      y: CY + Math.sin(ang) * R,
      c,
    });
  });

  // 每条边只画一次（A→B 和 B→A 是同一条）
  const edges = [];
  const seen = new Set();
  state.all.forEach((c) => {
    (c.relations || []).forEach((r) => {
      const k = [c.id, r.id].sort().join('|');
      if (seen.has(k) || !pos.has(r.id)) return;
      seen.add(k);
      edges.push({ a: c.id, b: r.id, kind: r.kind });
    });
  });

  const lines = edges
    .map((e) => {
      const A = pos.get(e.a), B = pos.get(e.b);
      return `<line class="web__edge" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"
                data-a="${e.a}" data-b="${e.b}" />`;
    })
    .join('');

  const nodes = [...pos.entries()]
    .map(([id, p]) => {
      const [c1, c2] = p.c.palette;
      return `<a class="web__node" href="/c/${id}/" data-id="${id}">
        <circle cx="${p.x}" cy="${p.y}" r="3.4" fill="${c2}" />
        <text x="${p.x}" y="${p.y - 5.6}" text-anchor="middle">${p.c.name}</text>
      </a>`;
    })
    .join('');

  // 标题里的数字由数据算，不手写 —— 否则加一条关系就对不上了
  const title = $('#web-title');
  if (title) title.textContent = `${state.all.length} 个人，${edges.length} 条线`;

  host.innerHTML = `
    <svg class="web__svg" viewBox="0 0 100 100" role="img" aria-label="${state.all.length} 位角色之间的关系网，共 ${edges.length} 条关系">
      <g class="web__edges">${lines}</g>
      <g class="web__nodes">${nodes}</g>
    </svg>`;

  // 悬停（或聚焦）时高亮这个人的所有连线
  const allLines = $$('.web__edge', host);
  $$('.web__node', host).forEach((node) => {
    const id = node.dataset.id;
    const on = () => {
      host.classList.add('is-focus');
      allLines.forEach((l) => {
        l.classList.toggle('is-hot', l.dataset.a === id || l.dataset.b === id);
      });
      node.classList.add('is-hot');
    };
    const off = () => {
      host.classList.remove('is-focus');
      allLines.forEach((l) => l.classList.remove('is-hot'));
      node.classList.remove('is-hot');
    };
    node.addEventListener('mouseenter', on);
    node.addEventListener('mouseleave', off);
    node.addEventListener('focus', on);
    node.addEventListener('blur', off);
  });
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
  store.markSeen(id);
  renderProgress();
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
  renderRegions();
  renderProgress();
  renderDaily();
  renderWeb();
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
