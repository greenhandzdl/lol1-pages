/**
 * theme.js — 主题切换的共享实现
 *
 * 原本每个页面自己写一份，结果是新建的 /shelf/ 和 /play/ 复制了按钮
 * 但忘了接逻辑 —— 按钮在，点了没反应。
 *
 * 现在统一入口：import { initTheme } 然后调一次就行。
 */

const STORE_THEME = 'lol1:theme';

/** 按钮 id 有两个：首页用 #theme-toggle，3D 页用 #theme-btn。都认。 */
const SELECTOR = '#theme-toggle, #theme-btn';

function sync(btn) {
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
}

export function initTheme() {
  const root = document.documentElement;
  const btn = document.querySelector(SELECTOR);
  if (!btn) return;

  sync(btn);

  btn.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORE_THEME, next);
    } catch {
      /* 隐私模式下写入会失败，忽略即可 */
    }
    sync(btn);
  });
}
