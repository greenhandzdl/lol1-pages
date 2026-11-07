/**
 * theme-boot.js — 首帧前应用主题（内联进每页 <head>，不能是 ES module）
 *
 * 为什么必须内联、必须在 <head>：等到 body 末尾再改会造成先白后黑的闪屏。
 *
 * 为什么单独一个文件：这段逻辑原本在每页各抄一份，抄的时候漏东西——
 * 首页那份认 ?theme= 查询参数，另外 17 页漏了这一行，于是
 * `?theme=dark` 只在首页生效，分享出去的暗色链接到别的页面就变回浅色。
 * 现在由 build-pages.mjs 和 scripts/sync-theme-boot.mjs 从这一个来源
 * 灌进每一页，抄漏的可能性没有了。
 *
 * 优先级：?theme= > localStorage > 系统偏好。
 * 查询参数排第一，是为了让分享出去的链接能复现发送者看到的配色。
 */
export const THEME_BOOT = `    (function () {
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
