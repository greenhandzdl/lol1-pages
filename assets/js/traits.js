/**
 * traits.js — 六维性格的显示
 *
 * traits 是 characters.json 里结构化程度最高的字段（温柔/体贴/活泼/安静/好奇/独立，
 * 各 1–3 分），但第四轮之前它只在 play.js 的余弦相似度里当中间变量，
 * 任何界面上都看不到。这里把它做成读者能直接读的形状。
 *
 * 三个约束：
 * 1. 分值只有 1/2/3，做进度条比做雷达图诚实 —— 三档数据画成多边形会
 *    暗示"有更多精度"，其实是编的。
 * 2. 不显示数字，只显示长度。1/2/3 印在边上会让页面变成表格。
 * 3. 必须能被读屏读到：条本身是纯装饰，所以整块给 role="img" 加一句
 *    aria-label，把六个值念出来。
 */

export const TRAITS = ['温柔', '体贴', '活泼', '安静', '好奇', '独立'];
export const TRAIT_MAX = 3;

/**
 * 六根条。
 * @param {object} traits  { 温柔: 3, 体贴: 2, ... }
 * @param {object} opts
 *   - variant: 'bars'（角色页/弹窗，纵向列表）
 *              'compare'（测试结果，左我右她，同一行）
 *   - mine:    仅 'compare' 用，读者自己的分值
 */
export function traitBars(traits, opts = {}) {
  if (!traits) return '';
  const { variant = 'bars', mine = null } = opts;

  const items = TRAITS.map((t) => {
    const hers = Number(traits[t]) || 0;
    const my = mine ? Number(mine[t]) || 0 : null;
    return { t, hers, mine: my };
  });

  if (variant === 'compare') {
    // 只比差异大的维度：两边都平的排不出信息量，反而占地方。
    const picked = items
      .map((x) => ({ ...x, gap: Math.abs(x.mine - x.hers) + (x.mine + x.hers) * 0.15 }))
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3)
      .sort((a, b) => TRAITS.indexOf(a.t) - TRAITS.indexOf(b.t));

    return `<div class="traitCmp">
      <p class="traitCmp__legend"><span class="traitCmp__key traitCmp__key--me">你</span><span class="traitCmp__key traitCmp__key--her">她</span></p>
      ${picked
        .map(
          (x) => `<div class="traitCmp__row">
          <span class="traitCmp__name">${x.t}</span>
          <span class="traitCmp__pair">
            <span class="traitCmp__bar traitCmp__bar--me"><i style="width:${(x.mine / TRAIT_MAX) * 100}%"></i></span>
            <span class="traitCmp__bar traitCmp__bar--her"><i style="width:${(x.hers / TRAIT_MAX) * 100}%"></i></span>
          </span>
        </div>`,
        )
        .join('')}
    </div>`;
  }

  const label = items.map((x) => `${x.t} ${x.hers} 分`).join('，');
  return `<div class="traits" role="img" aria-label="性格：${label}">
    ${items
      .map(
        (x) => `<div class="traits__row">
      <span class="traits__name" aria-hidden="true">${x.t}</span>
      <span class="traits__bar" aria-hidden="true"><i style="width:${(x.hers / TRAIT_MAX) * 100}%"></i></span>
    </div>`,
      )
      .join('')}
  </div>`;
}

/** 单行摘要，给空间紧的地方用（弹窗、卡片） */
export function traitSummary(traits, n = 3) {
  if (!traits) return '';
  return TRAITS.filter((t) => traits[t] >= 3)
    .slice(0, n)
    .map((t) => `<span class="traitTag">${t}</span>`)
    .join('');
}

/** 余弦相似度，和 play.js 里的算法保持一致 —— 读者做完测试看到的人，和这里推荐的人要对得上 */
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const t of TRAITS) {
    const x = Number(a[t]) || 0;
    const y = Number(b[t]) || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/** 和某个角色最像的 n 个人（不含自己） */
export function nearest(ch, all, n = 2) {
  return all
    .filter((o) => o.id !== ch.id && o.traits)
    .map((o) => ({ c: o, s: cosine(ch.traits, o.traits) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n);
}
