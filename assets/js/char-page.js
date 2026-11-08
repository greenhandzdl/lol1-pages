/**
 * char-page.js — 角色独立页的主题切换
 *
 * 独立页是静态 HTML，正文不依赖 JS；这个小脚本只负责明暗切换
 * 和记录"看过"，挂了也不影响内容可读。
 */

import { collapseNav } from './nav-collapse.js';
import { store } from './store.js';
import { mountBgm } from './bgm.js';

const STORE_THEME = 'lol1:theme';
const root = document.documentElement;
const btn = document.querySelector('#theme-toggle');

function sync() {
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
}

sync();
collapseNav();

// 进到角色页就算"看过" —— 收藏册的完成度靠这个。挂在哪一页由 body 上的 data 决定。
const charId = document.body.dataset.charId;
if (charId) store.markSeen(charId);

btn?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem(STORE_THEME, next);
  } catch {
    /* 隐私模式下写入会失败，忽略即可 */
  }
  sync();
});

mountBgm();
