/**
 * regions.js — 「十二个地方」的抽象点阵
 *
 * 这里刻意**不画地图**。12 个地点是虚构的，没有真实经纬度，
 * 画成地图等于编造一份地理数据 —— 而且读者会下意识把它当真的读。
 *
 * 所以画的是"谁离谁近"：12 个点，点与点之间的连线就是那 19 条关系。
 * 依据全是数据里已有的东西 —— 邻居住得近、常客要能走到、师承得见面。
 * 关系网区块（#web）画的是同一批连线，但那边按关系种类分色、按环形排布；
 * 这边把每个人摆在她的大致方位上，用来回答"这些地方大概在哪"。
 *
 * 方位是人为定的，但有理有据：
 *   - 山脊上/高处：星落台（山脊上的天文台）、风见台（山脊上的气象站）
 *   - 林子/郊野：薄荷森、白夜原、花咲野
 *   - 水边：潮见滨（南向沙滩）、樱见町（沿河旧街）
 *   - 街区：红茶馆、铃兰巷、南瓜镇、奶油街、旧书塔（街角/巷内）
 */

// x/y 是 0–100 的百分比坐标，读者看到的是"大致方位"，不是比例尺
export const PLACES = {
  mio: { x: 50, y: 12 }, // 星落台：山脊最高处，居中偏北
  hibari: { x: 84, y: 20 }, // 风见台：另一条山脊，东北
  yukino: { x: 16, y: 22 }, // 白夜原：西北的雪原，越远越空
  mint: { x: 33, y: 38 }, // 薄荷森：雪原往下的林子
  kanon: { x: 68, y: 40 }, // 花咲野：东边的缓坡
  sakura: { x: 43, y: 54 }, // 樱见町：沿河旧街，全图的中间
  shiori: { x: 22, y: 60 }, // 旧书塔：西侧，靠林子
  umi: { x: 62, y: 74 }, // 潮见滨：朝南的沙滩，偏东南
  chacha: { x: 38, y: 72 }, // 红茶馆：街角，靠中间
  cream: { x: 78, y: 58 }, // 奶油街：东边一条全是甜品店的街
  suzuka: { x: 50, y: 84 }, // 铃兰巷：窄巷，最南
  yayoi: { x: 84, y: 82 }, // 南瓜镇：东南，午夜最亮的地方
};

/**
 * 相邻关系：只连"住得近"的，不连跨越全图的（跨越的连线会变成一团乱麻）。
 * 用的全是 characters.json 里已有的关系，没有新造。
 */
const NEAR = [
  ['sakura', 'mint'], // 邻居
  ['mint', 'yukino'], // 邻居
  ['shiori', 'yukino'], // 邻居（书塔和雪原交界）
  ['mio', 'yukino'], // 挚友，雪夜里走动
  ['mio', 'shiori'], // 挚友
  ['chacha', 'shiori'], // 常客
  ['chacha', 'cream'], // 常客
  ['umi', 'cream'], // 常客
  ['umi', 'yayoi'], // 同好
  ['suzuka', 'yayoi'], // 同好
  ['sakura', 'hibari'], // 旧识
  ['kanon', 'sakura'], // 同好
];

/** 生成点阵的 SVG。要素很克制：一个点、一个标签，连一条淡线。 */
export function regionMap(all) {
  const pts = all.filter((c) => PLACES[c.id]);
  if (pts.length < 3) return '';

  const lines = NEAR.filter(
    ([a, b]) => PLACES[a] && PLACES[b] && pts.some((c) => c.id === a) && pts.some((c) => c.id === b),
  )
    .map(([a, b]) => {
      const p = PLACES[a];
      const q = PLACES[b];
      return `<line class="rmap__link" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" />`;
    })
    .join('');

  const dots = pts
    .map((c) => {
      const p = PLACES[c.id];
      return `<button class="rmap__dot" type="button" data-id="${c.id}"
        style="left:${p.x}%; top:${p.y}%"
        aria-label="${c.region}（${c.name}）">
        <i aria-hidden="true"></i><span>${c.region}</span>
      </button>`;
    })
    .join('');

  return `<figure class="rmap">
    <div class="rmap__canvas">
      <svg class="rmap__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${lines}
      </svg>
      ${dots}
    </div>
    <figcaption class="rmap__cap">每人住一处，方位是相对的，不是比例尺。虚线是她们之间走得近的关系，不是道路。</figcaption>
  </figure>`;
}
