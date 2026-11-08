/* lol1.moe · 萝莉图鉴 — vanilla ES module */
import { collapseNav } from './nav-collapse.js';
import { store, todayKey } from './store.js';
import { pickOfDay, lineOfDay, suggestOfDay, quoteOfDay } from './daily.js';
import { glyphSvg } from './glyphs.js';
import { accentStyle } from './accent.js';
import { traitBars } from './traits.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_THEME = 'lol1:theme';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  all: [],
  q: '',
  tag: '',
  tagIsLegacy: false,
  sort: 'default',
  favOnly: false,
  order: [],
  favs: new Set(),
  currentId: null,
  trigger: null,
  voiceIdx: 0, // 弹窗里台词轮到第几句
};

/**
 * 主题白名单 —— 和 scripts/check-data.mjs 里那份保持一致。
 * 放在前端是因为芯片的显示顺序要稳定：按数据出现顺序排，加一个新角色
 * 就可能让某个主题跳到最前面，用户下次进来位置全变了。
 */
const THEMES = ['花与四季', '星光与咒语', '茶与甜点', '书页与静默', '海风与高处', '街角的熟客', '认真做一件小事'];

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

/**
 * 筛选。
 *
 * `state.tag` 现在装的是主题（受控词表），但老链接里可能是单个标签
 * （`?tag=书` 这类分享出去的地址还在），所以 `state.tagIsLegacy` 为真时
 * 改按 tags 匹配 —— 让旧链接依然落到她想看的那一类，而不是筛出空白。
 */
function filtered() {
  const q = state.q.trim().toLowerCase();
  let list = state.all.filter((c) => {
    if (state.favOnly && !state.favs.has(c.id)) return false;
    if (state.tag) {
      const bucket = state.tagIsLegacy ? (c.tags || []) : (c.themes || []);
      if (!bucket.includes(state.tag)) return false;
    }
    if (!q) return true;
    return [c.name, c.nameEn, c.title, c.region, c.element, ...c.tags, ...(c.themes || [])]
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
  // 卡片上曾经显示 3 个 tags，但 35 个标签里 34 个只属于一个人 ——
  // 摆出来既不构成"分类"，点了也筛不出第二张卡。换成主题，且可点。
  const themes = (c.themes || [])
    .map(
      (t) =>
        `<button class="chip chip--tiny" type="button" data-theme="${t}"
                 aria-label="看「${t}」里的其他人">${t}</button>`,
    )
    .join('');
  return `
    <article class="card reveal" data-id="${c.id}" style="${accentStyle(c.palette)}">
      <button class="card__body" type="button" aria-haspopup="dialog" aria-label="查看 ${c.name} 的档案">
        <span class="card__media">
          <img src="${c.image}" srcset="${imgSrcset(c.image)}"
               sizes="(max-width: 860px) 46vw, 30vw"
               alt="插画：${c.name} · ${c.title}" width="768" height="1024" loading="lazy" decoding="async">
          <span class="card__badge">NO.${pad2(index + 1)}</span>
          <span class="card__el" aria-hidden="true">${glyphSvg(c.element, { size: 18 })}<i>${c.element}</i></span>
          <span class="card__hint" aria-hidden="true">翻开她的档案 →</span>
        </span>
        <span class="card__info">
          <span class="card__name">${c.name}<small>${c.nameEn}</small>${c.model ? `<span class="card__model" title="她有一座可以转着看的 3D 手办">3D</span>` : ''}</span>
          <span class="card__title">${c.title}</span>
          <!-- 她自己的那一句。12 句 tagline 之前只在弹窗里出现，
               图鉴一眼扫过去只有"樱花树下的巫女"这种身份标签，
               没有一句能听出说话口气的。 -->
          <span class="card__tagline">“${c.tagline}”</span>
        </span>
      </button>
      <div class="card__themes">${themes}</div>
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

  const pickRegion = (c) => {
    // 复用图上已有的搜索框作为筛选手段，保证"地域"和"搜索"是同一套状态
    state.q = c.region;
    const input = $('#search');
    if (input) input.value = c.region;
    renderGrid();
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // regionNote 是「地名：描写」的格式，卡片上地名的位置已经单独显示，
  // 所以只取冒号后面那半段。
  // 这里的内容来自 data 文件，但拼进 innerHTML 前还是要转义 ——
  // 以后有人往数据里写个 < 就把页面弄坏了，build 脚本里也是这么做的。
  const esc = (t) =>
    String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const noteOf = (c) => {
    const raw = (c.regionNote || '').trim();
    const i = raw.indexOf('：');
    return esc(i >= 0 ? raw.slice(i + 1) : raw);
  };

  host.innerHTML = state.all
    .map(
      (c) => `<button class="region" type="button" data-id="${c.id}"
                style="${accentStyle(c.palette)}">
          <span class="region__glyph" aria-hidden="true">${glyphSvg(c.element, { size: 40 })}</span>
          <span class="region__name">${c.region}</span>
          <span class="region__who">${c.name}</span>
          <span class="region__el">${c.element}</span>
          <span class="region__note">${esc(noteOf(c))}</span>
        </button>`,
    )
    .join('');

  $$('#regions-grid .region').forEach((btn) => {
    btn.addEventListener('click', () => {
      const c = byId(btn.dataset.id);
      if (c) pickRegion(c);
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
/**
 * 此刻 —— 把角色页的"她的一天"按读者本地时间翻到对应那一档。
 *
 * 为什么按本地时间而不是站点时间：这里没有后端，也没有时区表，
 * 而"她在做什么"这件事本来就取决于读者什么时候打开。
 * 四个时段和 day[].time 一一对应（早晨/白天/傍晚/夜里）。
 */
const NOW_SLOTS = [
  { key: 'morning', label: '早晨', hours: [5, 11] },
  { key: 'day', label: '白天', hours: [11, 17] },
  { key: 'evening', label: '傍晚', hours: [17, 21] },
  { key: 'night', label: '夜里', hours: [21, 5] },
];

function slotOf(date) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function renderNow() {
  const sw = $('#now-switch');
  const host = $('#now-card');
  if (!sw || !host) return;

  const initial = slotOf(new Date());
  sw.innerHTML = NOW_SLOTS.map(
    (s) =>
      `<button class="now__btn" type="button" data-slot="${s.key}" aria-pressed="false">${s.label}<span class="now__btn-hint">${s.hours[0]}–${s.hours[1]}</span></button>`,
  ).join('');

  let current = null;
  let timer = 0;

  const show = (slot, animate = true) => {
    current = slot;
    sw.querySelectorAll('.now__btn').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.slot === slot));
    });

    const paint = () => {
      const item = pickOfDay(state.all, `${todayKey()}::${slot}`);
      if (!item) { host.innerHTML = ''; return; }
      const entry = (item.day || []).find((d) => String(d.time).includes(NOW_SLOTS.find((s) => s.key === slot).label))
        || item.day?.[NOW_SLOTS.findIndex((s) => s.key === slot)];

      const stem = item.image.replace(/\.webp$/, '');
      host.innerHTML = entry
        ? `<div class="now__face"><img src="${item.image}"
               srcset="${stem}-400.webp 400w, ${stem}-600.webp 600w, ${item.image} 768w"
               sizes="132px" width="768" height="1024" loading="lazy" decoding="async"
               alt="${item.name}"></div>
           <div>
             <p class="now__time">${NOW_SLOTS.find((s) => s.key === slot).label} · ${entry.title}</p>
             <p class="now__text">“${entry.text}”</p>
             <p class="now__meta">${item.name} · ${item.title} · ${item.region} · ${item.element}
               <a href="/c/${item.id}/" aria-label="看 ${item.name} 的档案">她的档案 →</a></p>
           </div>`
        : '';
    };

    if (!animate || reducedMotion) { paint(); return; }
    host.classList.add('is-switching');
    clearTimeout(timer);
    timer = setTimeout(() => { paint(); host.classList.remove('is-switching'); }, 180);
  };

  sw.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.now__btn');
    if (btn && btn.dataset.slot !== current) show(btn.dataset.slot);
  });
  sw.addEventListener('keydown', (ev) => {
    const btns = [...sw.querySelectorAll('.now__btn')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (ev.key === 'ArrowRight') n = (i + 1) % btns.length;
    if (ev.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
    if (n === null) return;
    ev.preventDefault();
    btns[n].focus();
    show(btns[n].dataset.slot);
  });

  show(initial, false);
}

/**
 * 首页窄条：今天读一句。
 *
 * voice 是第四轮加的（每人三句，共 36 句），但只在角色页出现 ——
 * 读者得先决定点进谁，才可能读到。这里把一句提到首页。
 *
 * 做成窄条而不是区块：首页已经有 8 个 section、1440 下 7550px，
 * 再加一个满宽 section 会把"图鉴"推得更远。一条 1 行高的带子就够了。
 */
function renderQuote() {
  const host = $('#quote-line');
  if (!host) return;
  const q = quoteOfDay(state.all, todayKey());
  if (!q) { host.innerHTML = ''; return; }
  host.innerHTML = `<p class="quote__text">“${q.line}”</p>
    <a class="quote__who" href="/c/${q.c.id}/"><span>${q.c.name}</span> · ${q.c.title} →</a>`;
}

function renderDaily() {
  const host = $('#daily-body');
  if (!host) return;
  const key = todayKey();
  const c = pickOfDay(state.all, key);
  if (!c) { host.innerHTML = ''; return; }
  store.setSpin(key, c.id);

  const stem = c.image.replace(/\.webp$/, '');
  // 只算一次：同一行里调两遍会读起来像两个不同的东西
  const suggest = suggestOfDay(key, c);
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
      <div class="daily__acts">
        <a class="btn btn--ghost btn--small" href="/c/${c.id}/">看看她 →</a>
        <a class="daily__suggest" href="${suggest.href}">今天适合：${suggest.label}</a>
      </div>
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
 *
 * 节点曾经是 <a href="/c/<id>/"> —— 一碰就跳走，等于看不到这张网。
 * 现在改成 role="button"：点一下在旁边弹出这个人的关系，跳页面放进气囊里。
 */
/**
 * 全部关系故事，放在图下面折叠起来。
 *
 * 关系网是一张图 —— 能看出"谁和谁连着"，看不出"她们之间发生过什么"。
 * 19 段故事全展开会把 #web 撑到四五屏，所以默认收起；
 * <details> 是原生的，没有 JS 也能开合。
 */
function webStories(edges) {
  if (!edges.length) return '';
  const byId = new Map(state.all.map((c) => [c.id, c]));
  const items = edges
    .map((e) => {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) return '';
      const story = e.story ? `<p>${e.story}</p>` : '';
      return `<li>
        <p class="webStory__pair">
          <a href="/c/${a.id}/">${a.name}</a>
          <span>${e.kind || '相识'}</span>
          <a href="/c/${b.id}/">${b.name}</a>
        </p>
        ${story || `<p class="webStory__note">${e.note || ''}</p>`}
      </li>`;
    })
    .join('');
  return `<details class="webStory">
    <summary>读全部 ${edges.length} 段关系故事</summary>
    <ol class="webStory__list">${items}</ol>
  </details>`;
}

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
      edges.push({ a: c.id, b: r.id, kind: r.kind, note: r.note, story: r.story });
    });
  });

  const lines = edges
    .map((e) => {
      const A = pos.get(e.a), B = pos.get(e.b);
      return `<line class="web__edge" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"
                data-a="${e.a}" data-b="${e.b}" data-kind="${e.kind}" />`;
    })
    .join('');

  const nodes = [...pos.entries()]
    .map(([id, p]) => {
      const [, c2] = p.c.palette;
      const n = (p.c.relations || []).length;
      return `<g class="web__node" data-id="${id}" role="button" tabindex="0"
                 aria-expanded="false" aria-label="${p.c.name}，${n} 段关系">
        <circle cx="${p.x}" cy="${p.y}" r="3.4" fill="${c2}" />
        <g class="web__glyph" transform="translate(${p.x} ${p.y})">
          <g transform="translate(-2.1 -2.1) scale(0.175)">${glyphSvg(p.c.element, { size: 24, strokeWidth: 2.4 })}</g>
        </g>
        <text x="${p.x}" y="${p.y - 5.6}" text-anchor="middle">${p.c.name}</text>
      </g>`;
    })
    .join('');

  // 图例：颜色 + 线型 + 名字 + 条数，全部从 edges 数出来，不手写。
  // 数的是"画在图上的线"，不是 directed 关系条数 —— 同一条关系两边都记了一次，
  // 用 38 就得到图例 6/8/6/6/2/10，加起来是 38，而图上只有 19 根线。
  const byKind = new Map();
  edges.forEach((e) => byKind.set(e.kind, (byKind.get(e.kind) || 0) + 1));
  const legend = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([kind, n]) => `<li class="web__key" data-kind="${kind}">
          <svg viewBox="0 0 40 10" aria-hidden="true"><line class="web__edge" x1="2" y1="5" x2="38" y2="5" data-kind="${kind}"/></svg>
          <b>${kind}</b><i>${n}</i></li>`,
    )
    .join('');

  // 标题里的数字由数据算，不手写 —— 否则加一条关系就对不上了
  const title = $('#web-title');
  if (title) title.textContent = `${state.all.length} 个人，${edges.length} 条线`;

  host.innerHTML = `
    <svg class="web__svg" viewBox="0 0 100 100" role="img" aria-label="${state.all.length} 位角色之间的关系网，共 ${edges.length} 条关系">
      <g class="web__edges">${lines}</g>
      <g class="web__nodes">${nodes}</g>
    </svg>
    <ul class="web__legend">${legend}</ul>
    <div class="web__pop" id="web-pop" hidden></div>
    ${webStories(edges)}`;

  // 悬停（或聚焦）时高亮这个人的所有连线
  const allLines = $$('.web__edge', host);
  const nodesEls = $$('.web__node', host);
  const focusOn = (id) => {
    host.classList.add('is-focus');
    allLines.forEach((l) => {
      l.classList.toggle('is-hot', l.dataset.a === id || l.dataset.b === id);
    });
    nodesEls.forEach((n) => n.classList.toggle('is-hot', n.dataset.id === id));
  };
  const focusOff = () => {
    host.classList.remove('is-focus');
    allLines.forEach((l) => l.classList.remove('is-hot'));
    nodesEls.forEach((n) => n.classList.remove('is-hot'));
  };

  nodesEls.forEach((node) => {
    const id = node.dataset.id;
    node.addEventListener('mouseenter', () => focusOn(id));
    node.addEventListener('mouseleave', () => { if (!webPop || webPop.dataset.for !== id) focusOff(); });
    node.addEventListener('focus', () => focusOn(id));
    node.addEventListener('blur', () => { if (!webPop || webPop.dataset.for !== id) focusOff(); });
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      openWebPop(id, node);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openWebPop(id, node);
      }
    });
  });

  // 点空白关掉 —— 气泡盖不住整个图的时候才有意义，但成本很低
  host.addEventListener('click', () => closeWebPop());
}

let webPop = null;

/** 关系气泡：把"谁和谁是什么关系"从悬停高亮升级成能读的文字 */
function openWebPop(id, node) {
  const host = $('#web-graph');
  const pop = $('#web-pop', host);
  if (!pop) return;
  const c = byId(id);
  if (!c) return;

  // 再点同一个人 = 收起
  if (!pop.hidden && pop.dataset.for === id) { closeWebPop(); return; }

  const rels = (c.relations || []).filter((r) => byId(r.id));
  pop.dataset.for = id;
  pop.innerHTML = `
    <p class="web__popName">${c.name}<small>${c.title}</small></p>
    <ul class="web__popList">${rels
      .map((r) => {
        const o = byId(r.id);
        // note 一句话 + story 一件事：浮层里只放 note，点进去才有故事，
        // 否则 4 条关系 × 80 字会把浮层撑到屏幕外
        return `<li><span class="web__popKind">${r.kind || '相识'}</span><a href="/c/${o.id}/">${o.name}</a><i class="web__popNote">${r.note || ''}</i></li>`;
      })
      .join('')}</ul>
    <a class="web__popMore" href="/c/${id}/">打开她的档案 →</a>`;
  pop.hidden = false;
  webPop = pop;
  node.setAttribute('aria-expanded', 'true');
  // 气泡内部的点击不该冒泡到 .web 的"点空白关闭"
  pop.addEventListener('click', (e) => e.stopPropagation());

  // 定位：用节点在页面上的实际位置，而不是换算 viewBox 百分比 ——
  // svg 有 max-width 和 aspect-ratio，换算容易在小屏偏出去
  const box = host.getBoundingClientRect();
  const dot = node.querySelector('circle').getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let left = dot.left + dot.width / 2 - box.left - pw / 2;
  let top = dot.top - box.top - ph - 10;
  // 上边放不下就翻到下面
  if (top < 0) top = dot.bottom - box.top + 10;
  left = Math.max(4, Math.min(left, box.width - pw - 4));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.querySelector('a')?.focus();
}

function closeWebPop() {
  const pop = $('#web-pop');
  if (!pop || pop.hidden) return;
  const id = pop.dataset.for;
  pop.hidden = true;
  pop.innerHTML = '';
  delete pop.dataset.for;
  $$('#web-graph .web__node').forEach((n) => {
    const on = n.dataset.id === id;
    if (on) n.setAttribute('aria-expanded', 'false');
  });
  const host = $('#web-graph');
  host?.classList.remove('is-focus');
  $$('#web-graph .web__edge').forEach((l) => l.classList.remove('is-hot'));
  $$('#web-graph .web__node').forEach((n) => n.classList.remove('is-hot'));
  webPop = null;
}

/**
 * 主题芯片 —— 图鉴的第一层筛选。
 *
 * 每个芯片带人数：不是装饰，是为了让人一眼看出"点下去至少能看到几张卡"。
 * 只有一个人的标签不该做成筛选项，这正是之前 tags 方案的毛病。
 */
function renderChips() {
  const chips = $('#chips');
  if (!chips) return;
  const counts = new Map();
  state.all.forEach((c) => (c.themes || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));

  // 按白名单顺序排 —— 数据驱动但顺序稳定，不会因为加人而整体挪位
  const list = THEMES.filter((t) => counts.has(t));
  chips.innerHTML =
    `<button class="chip" type="button" data-theme="" aria-pressed="${!state.tag || state.tagIsLegacy}">全部</button>` +
    list
      .map(
        (t) =>
          `<button class="chip" type="button" data-theme="${t}"
                   aria-pressed="${state.tag === t && !state.tagIsLegacy}">${t}<i class="chip__n">${counts.get(t)}</i></button>`,
      )
      .join('');

  $$('#chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.theme;
      state.tag = t;
      state.tagIsLegacy = false;
      syncChips();
      renderGrid();
    });
  });
}

/** 芯片的选中态独立同步 —— 点卡片上的主题、点旧链接，芯片都要跟着变 */
function syncChips() {
  $$('#chips .chip').forEach((c) => {
    const t = c.dataset.theme;
    const on = t === '' ? !state.tag : state.tag === t && !state.tagIsLegacy;
    c.setAttribute('aria-pressed', String(on));
  });
}

/** 从卡片或详情里的主题点进来：就地筛选，并滚回图鉴顶部 */
function applyTheme(t) {
  state.tag = t;
  state.tagIsLegacy = false;
  syncChips();
  renderGrid();
  document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindCards() {
  $$('#grid .card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelector('.card__body').addEventListener('click', () => openDetail(id, card.querySelector('.card__body')));
    const like = card.querySelector('.card__like');
    like.addEventListener('click', () => toggleFav(id, like));
    // 主题芯片在卡片里，不能冒泡到 .card__body 的点击
    card.querySelectorAll('.card__themes .chip').forEach((btn) => {
      btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
    });
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
  // 弹窗也得带上这个人自己的配色 —— 否则里面的六维性格条永远是默认粉色，
  // 和第四轮"12 人有 12 种颜色"的承诺对不上。卡片和地域卡都是这么带的。
  dialog.setAttribute('style', accentStyle(c.palette));
  $('#detail-img').style.visibility = '';
  $('#detail-img').src = c.image;
  $('#detail-img').alt = `插画：${c.name} · ${c.title}`;
  $('#detail-eyebrow').textContent = `${c.region} · ${c.element}`;
  $('#detail-name').textContent = c.name;
  $('#detail-en').textContent = c.nameEn;
  $('#detail-tagline').textContent = `“${c.tagline}”`;
  // 台词：每次打开弹窗从第一句开始，别接着上一个人看到一半的位置
  state.voiceIdx = 0;
  paintVoice(c);
  $('#detail-bio').textContent = c.bio;
  $('#detail-region').textContent = c.region;
  $('#detail-element').textContent = c.element;
  $('#detail-artist').textContent = c.artist;
  $('#detail-license').textContent = c.license;
  $('#detail-tags').innerHTML =
    (c.themes || [])
      .map(
        (t) =>
          `<button class="chip chip--tiny" type="button" data-theme="${t}">${t}</button>`,
      )
      .join('') + c.tags.map((t) => `<span class="tag">${t}</span>`).join('');
  $('#detail-tags')
    .querySelectorAll('.chip')
    .forEach((btn) => btn.addEventListener('click', () => {
      closeDetail();
      applyTheme(btn.dataset.theme);
    }));
  // 六维性格：弹窗是大多数人唯一会看的地方，不能只在专页上有
  const traitsEl = $('#detail-traits');
  if (traitsEl) traitsEl.innerHTML = traitBars(c.traits);
  renderDetailRels(c);
  const indexEl = $('#detail-index');
  indexEl.textContent = idx >= 0 ? `${idx + 1} / ${list.length}` : '';

  // 弹窗里给出该角色的独立页入口，让 /c/<id>/ 不是孤儿页
  const pageLink = $('#detail-page');
  if (pageLink) pageLink.href = `c/${encodeURIComponent(c.id)}/`;
  // 故事在专页上，弹窗里只放进得去的门 —— 弹窗已经够长了
  const storyLink = $('#detail-story');
  if (storyLink) storyLink.href = `c/${encodeURIComponent(c.id)}/#story`;
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

/**
 * 详情弹窗里的人物关系。
 *
 * 关系原本只在角色页和首页关系网出现，弹窗里完全看不到 —— 但弹窗才是
 * 大多数人实际停留的地方。这里列出来，并且点一下就能在弹窗里直接翻到
 * 那个人（不是新开页面）：保持"翻档案"的连贯感。
 */
function renderDetailRels(c) {
  const host = $('#detail-rels');
  if (!host) return;
  const rels = (c.relations || []).filter((r) => byId(r.id));
  if (!rels.length) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;
  host.innerHTML = `
    <p class="detail__relTitle">她和谁有关</p>
    <div class="drel">${rels
      .map((r) => {
        const o = byId(r.id);
        return `<button class="drel__item" type="button" data-goto="${o.id}">
          <span class="drel__kind">${r.kind || '相识'}</span>
          <span class="drel__name">${o.name}</span>
          <span class="drel__note">${r.note || o.title}</span>
        </button>`;
      })
      .join('')}</div>`;
  host.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.goto));
  });
}

/**
 * 画当前这一句台词。
 *
 * 按角色缓存，所以换人再换回来还是从第一句起（在 openDetail 里重置）。
 * 有些角色 voice 可能只有一两句，取模兜住。
 */
function paintVoice(c) {
  const lines = Array.isArray(c.voice) ? c.voice.filter(Boolean) : [];
  const el = $('#detail-voice');
  const btn = $('#detail-voice-next');
  if (!lines.length) {
    el.textContent = '';
    el.hidden = true;
    btn.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = `「${lines[state.voiceIdx % lines.length]}」`;
  // 只有一句就没什么可换的
  btn.hidden = lines.length < 2;
}

/**
 * 阅读进度条 + 回到顶部。
 *
 * 两件事共用一个 scroll 监听、一个 rAF 节流 —— 分成两个监听会让同一帧里
 * 排两次回调，滚动时白掉帧。
 *
 * 进度条用 width 百分比：整页高度的比例最直观，也不需要读 CSS 变量。
 * 回到顶部滚过一屏才出现 —— 刚进页面就挂一个按钮既挡内容也没有意义。
 */
function initReadProgress() {
  const bar = $('#readbar .readbar__fill');
  const top = $('#to-top');
  if (!bar || !top) return;

  let queued = false;

  const apply = () => {
    queued = false;
    const doc = document.documentElement;
    // scrollHeight - clientHeight 就是"还能滚多少"，除数不能为 0
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const y = window.scrollY || doc.scrollTop;
    const pct = scrollable > 0 ? Math.min(1, Math.max(0, y / scrollable)) : 0;
    bar.style.width = `${(pct * 100).toFixed(2)}%`;
    // 一屏以下不显示，避免挡住第一屏内容
    top.hidden = y < doc.clientHeight * 0.9;
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  top.addEventListener('click', () => {
    // 减少动效时直接跳，别滚一段动画
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    // 跳完之后把焦点送回页面开头，键盘用户不用再 Tab 一遍
    const skip = document.querySelector('.skip-link');
    if (skip) skip.focus({ preventScroll: true });
  });

  apply();
}

function nextVoice() {
  const c = byId(state.currentId);
  if (!c) return;
  const lines = Array.isArray(c.voice) ? c.voice : [];
  if (lines.length < 2) return;
  state.voiceIdx = (state.voiceIdx + 1) % lines.length;
  paintVoice(c);
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
  state.tagIsLegacy = false;
  state.sort = ['default', 'random', 'name'].includes(p.get('sort')) ? p.get('sort') : 'default';
  state.favOnly = p.get('fav') === '1';
  return p.get('id');
}

/**
 * 把 `?tag=` 落到主题或旧标签上。
 *
 * 历史链接里 `?tag=书` 是当标签用的；现在芯片换成了主题，这些链接
 * 不能变成一片空白。命中主题就按主题筛，只命中标签就退回标签模式。
 */
function resolveTag() {
  if (!state.tag) return;
  if (THEMES.includes(state.tag) && state.all.some((c) => (c.themes || []).includes(state.tag))) {
    state.tagIsLegacy = false;
    return;
  }
  if (state.all.some((c) => (c.tags || []).includes(state.tag))) {
    state.tagIsLegacy = true;
    return;
  }
  state.tag = '';
  state.tagIsLegacy = false;
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
  resolveTag();

  $('#search').value = state.q;
  renderChips();
  renderRegions();
  renderProgress();
  renderDaily();
  renderQuote();
  renderNow();
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
  $('#detail-voice-next').addEventListener('click', nextVoice);
  initReadProgress();

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') moveDetail(-1);
    if (e.key === 'ArrowRight') moveDetail(1);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWebPop();
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
