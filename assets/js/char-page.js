/**
 * char-page.js — 角色独立页的主题切换
 *
 * 独立页是静态 HTML，正文不依赖 JS；这个小脚本只负责明暗切换，
 * 挂了也不影响内容可读。
 */

import { collapseNav } from './nav-collapse.js';

const STORE_THEME = 'lol1:theme';
const root = document.documentElement;
const btn = document.querySelector('#theme-toggle');

function sync() {
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
}

sync();
collapseNav();

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
