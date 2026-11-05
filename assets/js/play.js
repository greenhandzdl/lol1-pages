/**
 * play.js — 「你的邻居是哪位」性格测试
 *
 * 匹配方式：把答案累加成六个维度的向量，再和每位角色的性格画像算余弦相似度。
 * 用余弦而不是欧氏距离，是因为它只看"偏好形状"、不看答题总量 ——
 * 有的选项给 3 分、有的给 2 分，总量本来就不该影响结果。
 *
 * 题库在 assets/data/quiz.json，性格画像在 characters.json 的 traits 字段。
 * 两者分开的好处：改题目不用动角色数据，调画像不用动题目。
 */
import { store } from './store.js';
import { RegionMatch } from './match.js';
import { initTheme } from './theme.js';

const TRAITS = ['温柔', '体贴', '活泼', '安静', '好奇', '独立'];

const state = {
  quiz: null,
  all: [],
  step: 0,
  answers: [],
  result: null,
  mode: 'quiz',   // 'quiz' | 'match'
  matcher: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const t of TRAITS) {
    dot += (a[t] || 0) * (b[t] || 0);
    na += (a[t] || 0) ** 2;
    nb += (b[t] || 0) ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** 把已答的选项累加成向量 */
function tally(answers) {
  const v = {};
  for (const t of TRAITS) v[t] = 0;
  answers.forEach((optIdx, qIdx) => {
    const opt = state.quiz.questions[qIdx].options[optIdx];
    if (!opt) return;
    for (const [k, x] of Object.entries(opt.w)) v[k] = (v[k] || 0) + x;
  });
  return v;
}

/** 最像的三位，第一名是结果 */
function rank(vector) {
  return state.all
    .map((c) => ({ c, sim: cosine(vector, c.traits || {}) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3);
}

/* ---------- 模式切换 ---------- */

function renderTabs() {
  const tabs = [
    ['quiz', '性格测试'],
    ['match', '地名配对'],
  ];
  $('#play-tabs').innerHTML = tabs
    .map(
      ([k, label]) =>
        `<button class="chip" type="button" data-mode="${k}" aria-pressed="${state.mode === k}">${label}</button>`,
    )
    .join('');
  $$('#play-tabs .chip').forEach((b) =>
    b.addEventListener('click', () => {
      if (state.mode === b.dataset.mode) return;
      state.mode = b.dataset.mode;
      renderTabs();
      enterMode();
    }),
  );
}

function syncHead() {
  const isMatch = state.mode === 'match';
  const h = $('#play-title');
  const d = $('#play-desc');
  if (h) h.textContent = isMatch ? '她们住在哪' : '你的邻居是哪位';
  if (d) {
    d.textContent = isMatch
      ? '六个地名，六位居民。把地名和住在那里的人配起来 —— 都在图鉴里写着。'
      : '如果这些小小居民真住在你隔壁，最可能是哪一位？七个问题，看图鉴怎么回答。';
  }
}

function enterMode() {
  syncHead();
  if (state.mode === 'match') {
    state.matcher = new RegionMatch({ root: $('#play-body'), all: state.all });
    state.matcher.start();
  } else {
    renderIntro();
  }
}

/* ---------- 渲染 ---------- */

function renderIntro() {
  $('#play-body').innerHTML = `
    <div class="quiz__intro">
      <p class="quiz__lead">七个问题。没有对错，选那个你更可能做的。</p>
      <p class="quiz__sub">答完会告诉你最像哪位居民，以及为什么。</p>
      <button class="btn btn--primary" id="quiz-start" type="button">开始 →</button>
      <p class="quiz__foot">结果只在这里，不上传、不留痕。</p>
    </div>`;
  $('#quiz-start').addEventListener('click', () => {
    state.step = 0;
    state.answers = [];
    renderQuestion();
  });
}

function renderQuestion() {
  const q = state.quiz.questions[state.step];
  const total = state.quiz.questions.length;
  // 按「当前是第几题」算，而不是「答完几题」—— 第 1 题就不该是空条
  const pct = Math.round(((state.step + 1) / total) * 100);
  $('#play-body').innerHTML = `
    <div class="quiz__q">
      <div class="quiz__bar"><span style="width:${pct}%"></span></div>
      <p class="quiz__count">第 ${state.step + 1} / ${total} 题</p>
      <h2 class="quiz__title">${q.q}</h2>
      <div class="quiz__opts">
        ${q.options
          .map(
            (o, i) =>
              `<button class="quiz__opt" type="button" data-i="${i}">
                 <span class="quiz__key">${String.fromCharCode(65 + i)}</span>
                 <span>${o.t}</span>
               </button>`,
          )
          .join('')}
      </div>
      ${state.step > 0 ? '<button class="quiz__back" id="quiz-back" type="button">← 上一题</button>' : ''}
    </div>`;

  $$('.quiz__opt').forEach((b) =>
    b.addEventListener('click', () => pick(Number(b.dataset.i))),
  );
  $('#quiz-back')?.addEventListener('click', () => {
    state.step -= 1;
    state.answers.pop();
    renderQuestion();
  });
}

function pick(i) {
  state.answers[state.step] = i;
  if (state.step + 1 < state.quiz.questions.length) {
    state.step += 1;
    renderQuestion();
  } else {
    renderResult();
  }
}

function renderResult() {
  const v = tally(state.answers);
  const top = rank(v);
  const [first, ...rest] = top;
  const c = first.c;
  state.result = c;

  // 解释为什么是她：找"你答得多、她也高"的共同维度。
  // 只说你的强项说明不了任何事 —— 谁都可以答出高好奇。
  const shared = TRAITS
    .map((t) => ({ t, mine: v[t] || 0, hers: (c.traits || {})[t] || 0 }))
    .filter((x) => x.mine > 0 && x.hers >= 2)
    .sort((a, b) => b.mine * b.hers - a.mine * a.hers)
    .slice(0, 2)
    .map((x) => x.t);
  // 万一没有交集（理论上不会），退回你的强项，别让句子空着
  const basis = shared.length
    ? shared
    : TRAITS.map((t) => ({ t, n: v[t] })).sort((a, b) => b.n - a.n).slice(0, 2).map((x) => x.t);

  const stem = '/' + c.image.replace(/\.webp$/, '');
  const full = '/' + c.image;

  $('#play-body').innerHTML = `
    <div class="quiz__result">
      <p class="quiz__kicker">你的邻居是</p>
      <div class="quiz__card">
        <a class="quiz__face" href="/c/${c.id}/">
          <img src="${full}" srcset="${stem}-400.webp 400w, ${stem}-600.webp 600w, ${full} 768w"
               sizes="200px" width="768" height="1024" alt="${c.name}">
        </a>
        <div class="quiz__info">
          <h2 class="quiz__name">${c.name}</h2>
          <p class="quiz__cname">${c.nameEn} · ${c.title}</p>
          <p class="quiz__why">
            你和她都在「${basis.join('」和「')}」上得分最高 ——
            所以你会遇见住在${c.region}的她。
          </p>
          <p class="quiz__quote">“${c.tagline}”</p>
          <div class="quiz__acts">
            <a class="btn btn--primary" href="/c/${c.id}/">看她的档案 →</a>
            <a class="btn btn--ghost" href="/3d/?id=${encodeURIComponent(c.id)}">转动 3D 手办 ✦</a>
          </div>
        </div>
      </div>

      <div class="quiz__also">
        <p class="quiz__alsoTitle">还差一点就是她们</p>
        <div class="quiz__alsoRow">
          ${rest
            .map(
              (r) => `<a class="quiz__mini" href="/c/${r.c.id}/">
                <span>${r.c.name}</span>
                <i>${r.c.title}</i>
              </a>`,
            )
            .join('')}
        </div>
      </div>

      <button class="btn btn--ghost" id="quiz-again" type="button">再测一次</button>
    </div>`;

  $('#quiz-again').addEventListener('click', () => {
    state.step = 0;
    state.answers = [];
    renderIntro();
  });

  // 测出来的人也算"看过" —— 但只在她真的被点到时才算，这里不记
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 启动 ---------- */

async function init() {
  try {
    const [qr, cr] = await Promise.all([
      fetch('/assets/data/quiz.json'),
      fetch('/assets/data/characters.json'),
    ]);
    if (!qr.ok || !cr.ok) throw new Error('数据加载失败');
    state.quiz = await qr.json();
    state.all = (await cr.json()).characters;
  } catch (err) {
    $('#play-body').innerHTML = `<div class="empty"><b>打不开</b>${err.message}</div>`;
    return;
  }
  renderTabs();
  enterMode();
}

initTheme();
init();
