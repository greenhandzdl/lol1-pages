/**
 * match.js — 地名配对
 *
 * 不做通用的翻牌记忆（配同样的图没有意义），而是配对「地名 ↔ 角色」：
 * 玩的过程就在记这些人住在哪，跟站点内容是一回事。
 *
 * 每局从 12 位里随机抽 6 位，左右两列各自打乱。
 * 点左边一个、右边一个，对了就锁住，错了抖一下并记一次失误。
 */

const PAIRS = 6;

const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};

export class RegionMatch {
  constructor({ root, all }) {
    this.root = root;
    this.all = all;
    this.picked = null;   // 当前选中的左侧地名
    this.matched = 0;
    this.moves = 0;
    this.locked = false;
  }

  start() {
    const round = shuffle(this.all).slice(0, PAIRS);
    this.matched = 0;
    this.moves = 0;
    this.picked = null;
    this.locked = false;

    const left = shuffle(round.map((c) => ({ id: c.id, label: c.region })));
    const right = shuffle(round.map((c) => ({ id: c.id, label: c.name, c })));

    this.root.innerHTML = `
      <div class="mt">
        <p class="mt__hint">左边是地名，右边是住在那里的人。点一个、再点一个。</p>
        <div class="mt__cols">
          <div class="mt__col" id="mt-left">
            ${left
              .map(
                (x) => `<button class="mt__item" type="button" data-id="${x.id}" data-side="l">
                  <span class="mt__label">${x.label}</span>
                </button>`,
              )
              .join('')}
          </div>
          <div class="mt__col" id="mt-right">
            ${right
              .map(
                (x) => `<button class="mt__item mt__item--who" type="button" data-id="${x.id}" data-side="r">
                  <span class="mt__label">${x.label}</span>
                  <span class="mt__sub">${x.c.element}</span>
                </button>`,
              )
              .join('')}
          </div>
        </div>
        <p class="mt__hud" id="mt-hud">已配对 <b>0</b>/${PAIRS} · 失误 <b>0</b></p>
        <button class="btn btn--ghost" id="mt-again" type="button">换一局</button>
      </div>`;

    this.root.querySelectorAll('.mt__item').forEach((b) =>
      b.addEventListener('click', () => this.tap(b)),
    );
    this.root.querySelector('#mt-again').addEventListener('click', () => this.start());
  }

  tap(btn) {
    if (this.locked || btn.classList.contains('is-done')) return;
    const side = btn.dataset.side;

    // 同一列再点一次 = 改选
    if (!this.picked) {
      if (side !== 'l') return;   // 必须先点地名
      this._select(btn);
      return;
    }
    if (side === 'l') {
      this._select(btn);
      return;
    }

    // 已选地名 + 点角色 → 判定
    const a = this.picked;
    const b = btn;
    this.moves += 1;

    if (a.dataset.id === b.dataset.id) {
      a.classList.add('is-done');
      b.classList.add('is-done');
      a.classList.remove('is-pick');
      this.picked = null;
      this.matched += 1;
      this._hud();
      if (this.matched === PAIRS) this._win();
    } else {
      this.locked = true;
      b.classList.add('is-bad');
      a.classList.add('is-bad');
      this._hud();
      setTimeout(() => {
        b.classList.remove('is-bad');
        a.classList.remove('is-bad', 'is-pick');
        this.picked = null;
        this.locked = false;
      }, 460);
    }
  }

  _select(btn) {
    this.picked?.classList.remove('is-pick');
    this.picked = btn;
    btn.classList.add('is-pick');
  }

  _hud() {
    const el = this.root.querySelector('#mt-hud');
    if (el) el.innerHTML = `已配对 <b>${this.matched}</b>/${PAIRS} · 失误 <b>${this.moves - this.matched}</b>`;
  }

  _win() {
    const el = this.root.querySelector('#mt-hud');
    const wrong = this.moves - this.matched;
    if (el) {
      el.innerHTML = wrong === 0
        ? `全部配对了，一次没错 ✦`
        : `全部配对完成，失误 ${wrong} 次。`;
    }
  }
}
