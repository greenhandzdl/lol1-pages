#!/usr/bin/env node
/**
 * build-pages.mjs — 为每位角色生成一个可被单独收录的静态页
 *
 * 为什么需要：
 * 12 位角色全部挤在 `/` 上，靠 JS 渲染卡片。搜索引擎抓到的永远是同一份
 * 空壳 HTML，搜「樱井小春」找不到她的专页，分享出去也只有站点首页的
 * 通用预览图。
 *
 * 做法：读 characters.json，为每人写一个 c/<id>/index.html。
 * 正文是纯静态 HTML（名字、称号、故事、标签、插画），不依赖 JS 也能读全 ——
 * 这一点很关键，否则等于没解决爬虫问题。
 *
 * 为什么不复用首页的渲染逻辑：首页是 fetch + 模板字符串，爬虫执行 JS 的
 * 比例很低。这里改成构建期就把内容写死进 HTML。
 *
 * 用法：node scripts/build-pages.mjs
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
// 图形与 accent 走同一份运行时模块，角色页的静态 SVG 和首页的运行时 SVG 必然一致
import { glyphSvg, glyphMask } from '../assets/js/glyphs.js';
import { accentStyle } from '../assets/js/accent.js';
import { traitBars, nearest } from '../assets/js/traits.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'assets/data/characters.json');
const OUT = path.join(ROOT, 'c');
const SITE = 'https://lol1.moe';

/** 主题白名单 —— 与 check-data.mjs / assets/js/main.js 保持一致 */
const THEMES = ['花与四季', '星光与咒语', '茶与甜点', '书页与静默', '海风与高处', '街角的熟客', '认真做一件小事'];

/* ---------- 工具 ---------- */

/**
 * 把元素图形变成 CSS mask，给插画框当水印。
 *
 * 用 mask 而不是再内联一份 <svg>：插画框里已经有一张 img，再加一张 SVG 就要
 * 处理层叠与 object-fit；mask 不参与排版，也不会被读屏或复制选中。
 * 编码用 encodeURIComponent —— 图形里只有路径指令，转义后不会破坏 CSS 语法。
 */
function maskStyle(element) {
  // glyphMask 返回的已经是 url("…")，编码后的内容里没有引号，可安全放进属性
  const data = glyphMask(element);
  return data ? `--el-mask:${data}` : '';
}

/**
 * body 上的内联变量：accent 三件套 + 元素遮罩。
 * 必须 esc —— glyphMask 返回的 url("…") 用双引号，而 style="…" 也是双引号，
 * 不转义会把属性从第一个引号处截断（实测：整条 style 作废，水印和 accent 全没了）。
 */
function bodyStyle(c) {
  const mask = maskStyle(c.element);
  return `${accentStyle(c.palette)}${mask ? `;${mask}` : ''}`;
}

/** HTML 转义，数据里可能有引号、& 这类字符 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 首屏主题脚本从唯一来源取 —— 以前每页各抄一份，抄漏了 ?theme= 参数，
// 导致分享出去的暗色链接到别的页面就变回浅色。
// 改 assets/js/theme-boot.js，然后跑 node scripts/sync-theme-boot.mjs。
const THEME_BOOT = `    (function () {
      try {
        document.documentElement.classList.add('js');
        var q = new URLSearchParams(location.search).get('theme');
        var s = localStorage.getItem('lol1:theme');
        var dark = q ? q === 'dark' : s ? s === 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      } catch (e) {
        document.documentElement.dataset.theme = 'light';
      }
    })();`;

/* ---------- 页面模板 ---------- */


/** bio 现在有多段，按空行切开；保留旁注样式 */
function bioParas(bio) {
  return (bio || '')
    .split(/\n{2,}/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`)
    .join('');
}

/**
 * 「今天她在做什么」—— 一段场景。
 *
 * bio 是档案（她是怎样的人），story 是切片（某一天发生过什么）。
 * 两者分开写是有意的：档案可以概括，场景必须具体到"三天""第七个本子"
 * 这种细节上，否则读者记不住。
 */
function storyBlock(c) {
  if (!c.story) return '';
  return `<section class="char__block" aria-labelledby="story-title" id="story">
      <h2 class="char__blockTitle" id="story-title">一个小场景</h2>
      <p class="char__story">${esc(c.story)}</p>
    </section>`;
}

/**
 * 「她的一天」四段。用 <ol> 而不是 div：它本来就是有先后顺序的四段，
 * 读屏应该按"第一条、第二条"念，而不是四个平级的块。
 */
function dayBlock(c) {
  if (!Array.isArray(c.day) || !c.day.length) return '';
  const items = c.day
    .map(
      (d) => `<li class="day__item">
        <span class="day__time">${esc(d.time)}</span>
        <div class="day__body">
          <h3 class="day__title">${esc(d.title)}</h3>
          <p class="day__text">${esc(d.text)}</p>
        </div>
      </li>`,
    )
    .join('');
  return `<section class="char__block" aria-labelledby="day-title">
      <h2 class="char__blockTitle" id="day-title">她的一天</h2>
      <ol class="day">${items}</ol>
    </section>`;
}

/** 她的原话（voice）：第一人称，和 bio/story 的第三人称区分开 */
function voiceBlock(c) {
  if (!Array.isArray(c.voice) || !c.voice.length) return '';
  const lis = c.voice.map((v) => `          <li>${esc(v)}</li>`).join('\n');
  return `    <section class="char__block" aria-labelledby="voice-title" id="voice">
      <h2 class="char__blockTitle" id="voice-title">她说过的话</h2>
      <ul class="quotes">
${lis}
      </ul>
    </section>
`;
}

/** 喜欢与不喜欢：两组小卡片 */
function likesBlock(c) {
  const has = (c.likes && c.likes.length) || (c.dislikes && c.dislikes.length);
  if (!has) return '';
  const group = (label, items, cls) =>
    items && items.length
      ? `<div class="pref pref--${cls}">
           <h3 class="pref__label">${label}</h3>
           <ul class="pref__list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
         </div>`
      : '';
  return `<section class="char__block" aria-labelledby="pref-title">
      <h2 class="char__blockTitle" id="pref-title">喜欢与不喜欢</h2>
      <div class="pref">
        ${group('喜欢', c.likes, 'like')}
        ${group('不喜欢', c.dislikes, 'dislike')}
      </div>
      ${c.habit ? `<p class="char__habit"><span>小习惯</span>${esc(c.habit)}</p>` : ''}
    </section>`;
}

/** 性格：六维条 + 与她最像的两个人 */
function traitsBlock(c, all) {
  if (!c.traits) return '';
  // 相似度是纯前端算的，不依赖读者做没做过测试 —— 但措辞上只能说
  // "她们俩彼此最像"，不能说"和你最像"，后者需要读者自己的分值。
  const near = nearest(c, all, 2).filter((x) => x.s > 0.8);
  const nearLine = near.length
    ? `<p class="char__habit"><span>相近</span>${near
        .map((x) => `<a href="/c/${x.c.id}/">${esc(x.c.name)}</a>`)
        .join('、')} —— 六维里有 ${Math.round(near[0].s * 100)}% 重合</p>`
    : '';
  return `<section class="char__block" aria-labelledby="traits-title" id="traits">
      <h2 class="char__blockTitle" id="traits-title">她的性格</h2>
      ${traitBars(c.traits)}
      ${nearLine}
    </section>`;
}

/** 关系：可点击跳转的角色卡片 + 地域注脚 */
function relationsBlock(c, byId) {
  const rels = (c.relations || []).filter((r) => byId.has(r.id));
  if (!rels.length && !c.regionNote) return '';
  const cards = rels
    .map((r) => {
      const o = byId.get(r.id);
      // 故事用 <details> 折叠：19 段全展开会把这一块撑到三倍高，
      // 而折叠态的高度和第五轮之前完全一样（details 合起来只占标题行）。
      return `<div class="rel">
        <a class="rel__link" href="/c/${o.id}/">
          <span class="rel__kind">${esc(r.kind || '相识')}</span>
          <span class="rel__name">${esc(o.name)}</span>
          <span class="rel__note">${esc(r.note || o.title)}</span>
        </a>${
          r.story
            ? `<details class="rel__more">
            <summary>读她们的一件事</summary>
            <p>${esc(r.story)}</p>
          </details>`
            : ''
        }
      </div>`;
    })
    .join('');
  return `<section class="char__block" aria-labelledby="rel-title">
      <h2 class="char__blockTitle" id="rel-title">${c.region || ''}的关系</h2>
      ${c.regionNote ? `<p class="char__regionNote">${esc(c.regionNote)}</p>` : ''}
      ${cards ? `<div class="rels">${cards}</div>` : ''}
    </section>`;
}

function page(c, prev, next, byId, all) {
  const title = `${c.name} · ${c.title} | 萝莉图鉴`;
  const desc = `${c.name}（${c.nameEn}），${c.title}。${c.tagline} 住在${c.region}，元素是${c.element}。`;
  const url = `${SITE}/c/${c.id}/`;
  const img = `${SITE}/${c.image}`;
  const imgStem = c.image.replace(/\.webp$/, '');

  // 结构化数据：Person + 所属站点
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: c.name,
    alternateName: c.nameEn,
    description: c.bio,
    image: img,
    url,
    jobTitle: c.title,
    knowsAbout: c.tags,
    isPartOf: { '@type': 'WebSite', name: 'lol1.moe · 萝莉图鉴', url: `${SITE}/` },
  };

  // 主题是能筛出多人的那一层，做成链接直接跳首页筛选；
  // tags 只属于她一个人，点进去只会剩一张卡，所以保持纯文本。
  const tags =
    (c.themes || [])
      .map((t) => `<a class="tag tag--theme" href="/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`)
      .join('') +
    c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const navLink = (ch, label) =>
    ch
      ? `<a class="btn btn--ghost" href="/c/${ch.id}/" rel="${label}">${label === 'prev' ? '← ' : ''}${esc(ch.name)}${label === 'next' ? ' →' : ''}</a>`
      : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#fff8f4" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1c1420" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="lol1.moe · 萝莉图鉴" href="/feed.xml">
  <link rel="stylesheet" href="/assets/css/style.css">
  <link rel="stylesheet" href="/assets/css/char.css">

  <meta property="og:type" content="profile">
  <meta property="og:site_name" content="lol1.moe · 萝莉图鉴">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="768">
  <meta property="og:image:height" content="1024">
  <meta property="og:image:alt" content="插画：${esc(c.name)} · ${esc(c.title)}">
  <meta property="og:locale" content="zh_CN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${img}">

  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <script>
${THEME_BOOT}
  </script>
</head>
<body class="char-page" data-char-id="${c.id}" style="${esc(bodyStyle(c))}">
  <a class="skip-link" href="#main">跳到正文</a>

  <header class="site-header">
    <div class="wrap nav">
      <a class="logo" href="/" aria-label="lol1.moe 首页">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M16 5c2 3 2 6 0 8-2-2-2-5 0-8Z" fill="#ff8ab5" stroke="none"/>
            <path d="M27 16c-3 2-6 2-8 0 2-2 5-2 8 0Z" fill="#ffb7d5" stroke="none"/>
            <path d="M16 27c-2-3-2-6 0-8 2 2 2 5 0 8Z" fill="#b79cff" stroke="none"/>
            <path d="M5 16c3-2 6-2 8 0-2 2-5 2-8 0Z" fill="#9fe3cf" stroke="none"/>
          </g>
          <circle cx="16" cy="16" r="3.2" fill="#ffd166"/>
        </svg>
        <span class="logo__word">lol1<i>.moe</i></span>
      </a>

      <nav class="nav__links" aria-label="主导航">
        <a class="nav__link" href="/#gallery">图鉴</a>
        <a class="nav__link" href="/#regions">地域</a>
        <a class="nav__link" href="/3d/">3D 手办台</a>
        <a class="nav__link" href="/shelf/">收藏册</a>
        <a class="nav__link" href="/play/">小游戏</a>
        <a class="nav__link" href="/#about">关于</a>
        <a class="nav__link" href="/#policy">内容政策</a>
      </nav>

      <button class="icon-btn theme-toggle" id="theme-toggle" type="button" aria-label="切换明暗主题" aria-pressed="false">
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6"/></svg>
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7Z"/></svg>
      </button>
    </div>
  </header>

  <main id="main" class="char">
    <div class="wrap char__inner">
      <figure class="char__media">
        <img src="/${c.image}"
             srcset="/${imgStem}-400.webp 400w, /${imgStem}-600.webp 600w, /${c.image} 768w"
             sizes="(max-width: 860px) 92vw, 420px"
             alt="插画：${esc(c.name)} · ${esc(c.title)}"
             width="768" height="1024" loading="eager" decoding="async" fetchpriority="high">
      </figure>

      <div class="char__info">
        <p class="char__eyebrow">${glyphSvg(c.element, { className: 'glyph glyph--inline', size: 16 })}<span>${esc(c.region)} · ${esc(c.element)}</span></p>
        <h1 class="char__name">${esc(c.name)}</h1>
        <p class="char__en">${esc(c.nameEn)} · ${esc(c.title)}</p>
        <blockquote class="char__tagline"><p>${esc(c.tagline)}</p></blockquote>
        <div class="char__bio">${bioParas(c.bio)}</div>

        <div class="char__tags">${tags}</div>

        <dl class="char__meta">
          <div><dt>元素</dt><dd>${esc(c.element)}</dd></div>
          <div><dt>地域</dt><dd>${esc(c.region)}</dd></div>
          <div><dt>插画</dt><dd>${esc(c.artist)} · seed ${esc(c.seed)}</dd></div>
          ${c.model ? `<div><dt>3D</dt><dd>${esc(c.modelCredit)}</dd></div>` : ''}
        </dl>

        ${dayBlock(c)}
        ${voiceBlock(c)}
        ${storyBlock(c)}
        ${likesBlock(c)}
        ${traitsBlock(c, all)}
        ${relationsBlock(c, byId)}

        <div class="char__actions">
          ${c.model
            ? `<a class="btn btn--primary" href="/3d/?id=${encodeURIComponent(c.id)}">转动 3D 手办 ✦</a>`
            : `<a class="btn btn--primary" href="/3d/?id=${encodeURIComponent(c.id)}">在 3D 手办台查看 ✦</a>`}
          <a class="btn btn--ghost" href="/?id=${encodeURIComponent(c.id)}">在图鉴中打开</a>
        </div>

        <nav class="char__pager" aria-label="上下一位角色">
          ${navLink(prev, 'prev')}
          ${navLink(next, 'next')}
        </nav>
      </div>
    </div>
  </main>

  <footer class="char__foot">
    <div class="wrap">
      <p><a href="/">← 回到图鉴</a> · 角色与插画均为 AI 生成 · 全年龄向</p>
    </div>
  </footer>

  <script type="module" src="/assets/js/char-page.js"></script>
</body>
</html>`;
}

/* ---------- 首页 noscript 兜底 ---------- */

/**
 * 首页的图鉴、地域、关系网全是 JS 渲染的。关掉 JS 之后首页基本是一片空白 ——
 * 而 c/<id>/ 恰恰是为了「不执行 JS 也能读到档案」才存在的。
 *
 * 这里把三份纯 HTML 摘要写进 <noscript>。浏览器开着 JS 时，<noscript> 的内容
 * 按原始文本处理、不会变成 DOM 元素，所以不存在"名字被读两遍"的问题 ——
 * 也因此不要给它加 aria-hidden，那会在真正关掉 JS 时把内容从朗读里也一起抹掉。
 *
 * 只替换 index.html 里带 data-build 标记的 noscript，其余（手写正文）一概不碰；
 * 标记缺失就报错，绝不静默追加。
 */
function noScriptGallery(list) {
  const themes = THEMES.map((t) => {
    const members = list.filter((c) => (c.themes || []).includes(t));
    if (!members.length) return '';
    return `<li><b>${esc(t)}</b>：${members.map((c) => `<a href="c/${c.id}/">${esc(c.name)}</a>`).join('、')}</li>`;
  }).join('');
  const cards = list
    .map((c) => {
      const stem = '/' + c.image.replace(/\.webp$/, '');
      return `<li>
      <a href="c/${c.id}/">
        <img src="/${c.image}" srcset="${stem}-400.webp 400w, ${stem}-600.webp 600w, /${c.image} 768w"
             sizes="(max-width: 860px) 44vw, 180px" width="768" height="1024" loading="lazy" decoding="async"
             alt="插画：${esc(c.name)} · ${esc(c.title)}">
        <span><b>${esc(c.name)}</b> · ${esc(c.title)}<br>${esc(c.region)} · ${esc(c.element)}</span>
      </a>
    </li>`;
    })
    .join('\n');
  return `<noscript data-build="gallery">
  <div class="ns">
    <p class="ns__title">不开启 JavaScript 也能读完这本图鉴 —— 下面是全部 ${list.length} 位</p>
    <ul class="ns__themes">${themes}</ul>
    <ul class="ns__cards">
${cards}
    </ul>
  </div>
</noscript>`;
}

function noScriptRegions(list) {
  const items = list
    .map((c) => `<li><b>${esc(c.region)}</b> — <a href="c/${c.id}/">${esc(c.name)}</a>（${esc(c.element)}）</li>`)
    .join('');
  return `<noscript data-build="regions">
  <ul class="ns__plain">${items}</ul>
</noscript>`;
}

function noScriptWeb(list) {
  const byId = new Map(list.map((c) => [c.id, c]));
  const items = list
    .flatMap((c) =>
      (c.relations || [])
        .filter((r) => byId.has(r.id))
        .map(
          (r) =>
            `<li><a href="c/${c.id}/">${esc(c.name)}</a> —${esc(r.kind || '相识')}→ <a href="c/${r.id}/">${esc(byId.get(r.id).name)}</a></li>`,
        ),
    )
    .join('');
  return `<noscript data-build="web">
  <ul class="ns__plain">${items}</ul>
</noscript>`;
}

/** 把三块 noscript 写回 index.html */
async function writeNoScript(list) {
  const file = path.join(ROOT, 'index.html');
  const html = await readFile(file, 'utf8');
  const blocks = {
    gallery: noScriptGallery(list),
    regions: noScriptRegions(list),
    web: noScriptWeb(list),
  };
  let out = html;
  for (const [key, block] of Object.entries(blocks)) {
    const re = new RegExp(`<noscript data-build="${key}"[^>]*>[\\s\\S]*?</noscript>`);
    if (!re.test(out)) {
      throw new Error(`index.html 里找不到 data-build="${key}" 的 <noscript> 标记，已中止（不猜位置）`);
    }
    out = out.replace(re, block);
  }
  if (out !== html) await writeFile(file, out, 'utf8');
  console.log('index.html noscript 兜底已更新');
}

/* ---------- 主流程 ---------- */

async function main() {
  const { characters } = JSON.parse(await readFile(DATA, 'utf8'));
  // 关系卡片要拿到被指向角色的名字与标题，用 Map 比每次 find 清楚
  const byId = new Map(characters.map((c) => [c.id, c]));

  // 全量重建，避免删掉角色后残留旧目录
  await rm(OUT, { recursive: true, force: true });

  for (let i = 0; i < characters.length; i += 1) {
    const c = characters[i];
    const dir = path.join(OUT, c.id);
    await mkdir(dir, { recursive: true });
    // 首尾不循环：第 1 位没有「上一位」，最后一位没有「下一位」。
    // 环形会让「从樱井小春点上一页跳到云雀」显得莫名其妙。
    const prev = i > 0 ? characters[i - 1] : null;
    const next = i < characters.length - 1 ? characters[i + 1] : null;
    await writeFile(path.join(dir, 'index.html'), page(c, prev, next, byId, characters), 'utf8');
    console.log(`  c/${c.id}/`);
  }

  console.log(`\n生成 ${characters.length} 个角色页。`);

  await writeNoScript(characters);
  await writeSitemap(characters);
  await writeFeed(characters);
}

/* ---------- sitemap / RSS ---------- */

/** 固定页面 + 12 个角色页 + 收藏册 + 小游戏 */
function fixedPages() {
  return [
    { url: `${SITE}/`, priority: '1.0', changefreq: 'weekly' },
    { url: `${SITE}/3d/`, priority: '0.8', changefreq: 'monthly' },
    { url: `${SITE}/play/`, priority: '0.7', changefreq: 'monthly' },
    { url: `${SITE}/shelf/`, priority: '0.5', changefreq: 'monthly' },
  ];
}

async function writeSitemap(characters) {
  const urls = [
    ...fixedPages(),
    ...characters.map((c) => ({
      url: `${SITE}/c/${c.id}/`,
      priority: '0.9',
      changefreq: 'monthly',
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${u.url}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  await writeFile(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log(`sitemap.xml（${urls.length} 条）`);
}

/**
 * RSS。站点没有发布日期字段，用 seed 当排序依据没有意义，
 * 所以按图鉴顺序输出，pubDate 统一用构建时间之外的做法也不行——
 * 这里干脆不写 pubDate，只写 lastBuildDate。读者关心的是"有这个东西"。
 */
async function writeFeed(characters) {
  const items = characters
    .map((c) => {
      const url = `${SITE}/c/${c.id}/`;
      const desc = `${c.tagline} 住在${c.region}，元素是${c.element}。`;
      return `    <item>
      <title>${esc(c.name)} · ${esc(c.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <description>${esc(desc)}</description>
      <category>${esc(c.region)}</category>
    </item>`;
    })
    .join('\n');

  const now = new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>lol1.moe · 萝莉图鉴</title>
    <link>${SITE}/</link>
    <description>12 位住在幻想里的小小居民。全年龄向，无追踪脚本。</description>
    <language>zh-CN</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  await writeFile(path.join(ROOT, 'feed.xml'), xml, 'utf8');
  console.log(`feed.xml（${characters.length} 条）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
