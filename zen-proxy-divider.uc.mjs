// ==UserScript==
// @name           Zen Proxy Divider
// @description    Draggable divider in the Zen sidebar: tabs above it use the browser proxy, tabs below it connect directly.
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

// Entry point. The implementation lives in ./src (loaded as ES modules —
// Sine imports this file with a dynamic import(), so relative module
// resolution works from here).

(() => {
  if (window.__zenProxyDivider) {
    return;
  }
  window.__zenProxyDivider = true;
  import("./src/main.mjs")
    .then((m) => m.bootstrap())
    .catch((e) =>
      console.error("[zen-proxy-divider] failed to load modules", e)
    );
})();
