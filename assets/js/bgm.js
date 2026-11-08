/**
 * bgm.js — 背景音乐
 *
 * 三条硬规矩，都是从站点既有约定来的：
 *
 * 1. **默认不响。** 浏览器本来也拦自动播放，与其等它拒，不如一开始就不放。
 *    开关状态存 'lol1:bgm'，跨页记住。
 *
 * 2. **不点就不下载。** <audio preload="none">，点了才请求。
 *    音频是 assets/audio/ 下四个 mp3，合计约 1.2MB，白下载是可耻的。
 *
 * 3. **没有统计。** 不发任何请求出去，也记录不到任何地方去。
 *
 * 播放失败（被拦、文件 404、解码失败）时把按钮退回"关"，不重试、不弹窗 ——
 * 背景音乐坏掉不该成为一个需要读者处理的问题。
 */

/** 四个时段，和首页「此刻」的分档一致；按本地时间选 */
const TRACKS = {
  morning: { file: '/assets/audio/morning.mp3', label: '早晨' },
  day: { file: '/assets/audio/day.mp3', label: '白天' },
  evening: { file: '/assets/audio/evening.mp3', label: '傍晚' },
  night: { file: '/assets/audio/night.mp3', label: '夜里' },
};

const KEY = 'lol1:bgm';

/**
 * 现在该放哪一条。刻意用本地时间：站点没有后端，
 * 和首页「此刻」用同一套判断，读者看到和听到的才对得上。
 */
export function slotFor(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function isOn() {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

function remember(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch { /* 无痕模式：这次会话能听就行 */ }
}

/** 音量压得比较低 —— 是背景音乐，不该盖过页面上的字 */
const VOLUME = 0.22;

let el = null;
let currentSlot = null;

function audio() {
  if (el) return el;
  el = new Audio();
  // 挂进 DOM 而不是让它飘在内存里：页头的按钮写了 aria-controls="bgm-audio"，
  // 指不到东西的 aria-controls 是无效的；顺带测试也能直接找到它。
  el.id = 'bgm-audio';
  el.hidden = true;
  document.body.appendChild(el);
  el.loop = true;
  el.preload = 'none';
  el.volume = VOLUME;
  return el;
}

function paint(btn, on) {
  if (!btn) return;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? '关闭背景音乐' : '打开背景音乐');
  btn.classList.toggle('is-on', on);
  const t = btn.dataset.onTitle || '背景音乐';
  btn.title = on ? `${t}（开）` : t;
}

/**
 * 开始播放。返回 Promise<boolean> —— 成了没有。
 *
 * play() 被拒是常态（没有用户手势、被策略拦），必须 catch，
 * 否则控制台会留一条未处理的 Promise 拒绝。
 *
 * `commit` 决定失败时怎么收场：
 *   · 用户点了按钮 → commit=true，失败就把开关退回"关"，别让他以为开着
 *   · 页面加载自动续播 → commit=false，失败只说明现在还不能放，
 *     偏好留着，等第一次点击再兑现
 */
async function start(btn, { commit = true } = {}) {
  const slot = slotFor();
  const a = audio();
  const track = TRACKS[slot];

  if (currentSlot !== slot) {
    a.src = track.file;
    currentSlot = slot;
  }

  try {
    await a.play();
    remember(true);
    paint(btn, true);
    return true;
  } catch {
    if (commit) {
      remember(false);
      paint(btn, false);
    } else {
      paint(btn, true);
    }
    return false;
  }
}

function stop(btn) {
  audio().pause();
  remember(false);
  paint(btn, false);
}

/**
 * 绑定页头上那枚按钮。每页都有页头，所以每页都会调用。
 * 找不到按钮直接返回 —— 404 之类没页头的页面不该因为这个报错。
 */
export function mountBgm() {
  const btn = document.querySelector('[data-bgm-toggle]');
  if (!btn) return null;

  paint(btn, isOn());

  btn.addEventListener('click', async () => {
    if (isOn()) stop(btn);
    else await start(btn);
  });

  // 跨页返回时如果本来就是开着的，先试着接着放。
  // 浏览器的媒体参与度（media engagement）允许时这一步会直接成功；
  // 不允许时 play() 被拒，不算错 —— 等第一次点击再兑现。
  if (isOn()) {
    start(btn, { commit: false }).then((ok) => {
      if (ok) return;
      const resume = () => {
        document.removeEventListener('pointerdown', resume);
        start(btn);
      };
      document.addEventListener('pointerdown', resume, { once: true });
    });
  }

  return btn;
}

/** 供测试与调试 */
export const _internals = { TRACKS, VOLUME };
