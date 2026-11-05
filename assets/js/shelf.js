/**
 * shelf.js — 收藏册
 *
 * 把存档里的四类痕迹摊开来看：看过、收藏、转过手办、寻星通关。
 * 未解锁的显示剪影 —— 不是隐藏，是"还没碰过"，这样才知道还剩哪些。
 *
 * 全部读本地存档，不发任何请求。
 */
import { store } from './store.js';

const state = { all: [], tab: 'all' };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** 一位角色当前的解锁状态 */
function statusOf(c) {
  const seen = store.getSeen();
  const turned = store.getTurned();
  const stars = store.getStars();
  return {
    seen: seen.has(c.id),
    fav: store.hasFav(c.id),
    turned: turned.has(c.id),
    star: stars[c.id] !== undefined,
    best: stars[c.id],
  };
}

function renderStats() {
  const total = state.all.length || 1;
  const rows = state.all.map((c) => statusOf(c));
  const counts = {
    seen: rows.filter((r) => r.seen).length,
    fav: rows.filter((r) => r.fav).length,
    turned: rows.filter((r) => r.turned).length,
    star: rows.filter((r) => r.star).length,
  };
  const items = [
    ['看过档案', counts.seen],
    ['收进口袋', counts.fav],
    ['转过手办', counts.turned],
    ['寻星通关', counts.star],
  ];
  $('#shelf-stats').innerHTML = items
    .map(([label, n]) => {
      const pct = Math.round((n / total) * 100);
      return `<div class="shelf__stat">
        <p class="shelf__statLabel">${label}</p>
        <p class="shelf__statNum">${n}<i>/${total}</i></p>
        <div class="shelf__statBar"><span style="width:${pct}%"></span></div>
      </div>`;
    })
    .join('');
}

function renderTabs() {
  const tabs = [
    ['all', '全部'],
    ['fav', '收藏'],
    ['seen', '看过'],
    ['turned', '转过'],
    ['star', '寻星'],
    ['locked', '还没碰过'],
  ];
  $('#shelf-tabs').innerHTML = tabs
    .map(
      ([k, label]) =>
        `<button class="chip" type="button" data-tab="${k}" aria-pressed="${state.tab === k}">${label}</button>`,
    )
    .join('');
  $$('#shelf-tabs .chip').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      renderTabs();
      renderGrid();
    }),
  );
}

function matches(s) {
  switch (state.tab) {
    case 'fav': return s.fav;
    case 'seen': return s.seen;
    case 'turned': return s.turned;
    case 'star': return s.star;
    case 'locked': return !s.seen && !s.fav && !s.turned && !s.star;
    default: return true;
  }
}

function renderGrid() {
  const host = $('#shelf-grid');
  const rows = state.all
    .map((c) => ({ c, s: statusOf(c) }))
    .filter(({ s }) => matches(s));

  if (!rows.length) {
    host.innerHTML = `<div class="empty"><b>这一栏还是空的</b>${
      state.tab === 'locked' ? '你已经把每一位都碰过了。' : '去图鉴里转转，或者去 3D 台玩一局。'
    }</div>`;
    return;
  }

  host.innerHTML = rows
    .map(({ c, s }) => {
      const locked = !s.seen && !s.fav && !s.turned && !s.star;
      // 收藏册在 /shelf/ 下，相对路径会解析成 /shelf/assets/…，必须用绝对路径
      const stem = '/' + c.image.replace(/\.webp$/, '');
      const full = '/' + c.image;
      const marks = [
        s.seen ? '<span class="mk mk--seen" title="看过档案">看</span>' : '',
        s.fav ? '<span class="mk mk--fav" title="已收藏">♥</span>' : '',
        s.turned ? '<span class="mk mk--turn" title="转过手办">转</span>' : '',
        s.star ? `<span class="mk mk--star" title="寻星最高 ${s.best}s">✦${s.best}s</span>` : '',
      ].join('');
      return `<a class="sh ${locked ? 'is-locked' : ''}" href="/c/${c.id}/"
                style="--pa:${c.palette[0]};--pb:${c.palette[1]}">
        <span class="sh__face">
          <img src="${locked ? `${stem}-400.webp` : full}"
               srcset="${stem}-400.webp 400w, ${stem}-600.webp 600w, ${full} 768w"
               sizes="(max-width: 520px) 42vw, 160px" width="768" height="1024"
               loading="lazy" decoding="async" alt="${locked ? '' : `插画：${c.name}`}">
          ${locked ? '<span class="sh__q" aria-hidden="true">?</span>' : ''}
        </span>
        <span class="sh__name">${locked ? '？？？' : c.name}</span>
        <span class="sh__title">${locked ? '还没碰过' : c.title}</span>
        <span class="sh__marks">${marks}</span>
      </a>`;
    })
    .join('');
}

function renderAll() {
  renderStats();
  renderTabs();
  renderGrid();
}

async function init() {
  try {
    const res = await fetch('/assets/data/characters.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.all = data.characters;
  } catch (err) {
    $('#shelf-grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><b>读不到角色数据</b>${err.message}</div>`;
    return;
  }
  renderAll();

  $('#shelf-reset').addEventListener('click', () => {
    // 清空是不可逆的，二次确认
    if (!window.confirm('清空这台设备上的全部记录？看过、收藏、寻星成绩都会没掉，无法恢复。')) return;
    store.reset();
    renderAll();
  });
}

init();
