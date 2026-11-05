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

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'assets/data/characters.json');
const OUT = path.join(ROOT, 'c');
const SITE = 'https://lol1.moe';

/* ---------- 工具 ---------- */

/** HTML 转义，数据里可能有引号、& 这类字符 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 首屏前应用主题，避免闪白（与首页同款） */
const THEME_BOOT = `    (function () {
      try {
        var s = localStorage.getItem('lol1:theme');
        var d = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.dataset.theme = s || (d ? 'dark' : 'light');
      } catch (e) {}
    })();`;

/* ---------- 页面模板 ---------- */

function page(c, prev, next) {
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

  const tags = c.tags
    .map((t) => `<a class="tag" href="/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`)
    .join('');

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
<body class="char-page">
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
        <a class="nav__link" href="/#about">关于</a>
        <a class="nav__link" href="/#policy">内容政策</a>
        <a class="nav__link" href="/3d/">3D 手办台</a>
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
        <p class="char__eyebrow">${esc(c.region)} · ${esc(c.element)}</p>
        <h1 class="char__name">${esc(c.name)}</h1>
        <p class="char__en">${esc(c.nameEn)} · ${esc(c.title)}</p>
        <p class="char__tagline">“${esc(c.tagline)}”</p>
        <p class="char__bio">${esc(c.bio)}</p>

        <div class="char__tags">${tags}</div>

        <dl class="char__meta">
          <div><dt>元素</dt><dd>${esc(c.element)}</dd></div>
          <div><dt>地域</dt><dd>${esc(c.region)}</dd></div>
          <div><dt>插画</dt><dd>${esc(c.artist)} · seed ${esc(c.seed)}</dd></div>
          ${c.model ? `<div><dt>3D</dt><dd>${esc(c.modelCredit)}</dd></div>` : ''}
        </dl>

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

/* ---------- 主流程 ---------- */

async function main() {
  const { characters } = JSON.parse(await readFile(DATA, 'utf8'));

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
    await writeFile(path.join(dir, 'index.html'), page(c, prev, next), 'utf8');
    console.log(`  c/${c.id}/`);
  }

  console.log(`\n生成 ${characters.length} 个角色页。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
