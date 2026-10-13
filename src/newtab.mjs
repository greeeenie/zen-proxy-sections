// Route each creation source using its own setting, before the first load.
// Alt+Enter in the URL bar sends the tab to the opposite of the default
// side instead.

import {
  FOLLOWING,
  newTabsGoDirect,
  isReversed,
  manualProxyFlag,
  log,
  logError,
} from "./prefs.mjs";
import { isManualTab, openerTabFor } from "./tabs.mjs";
import {
  directBrowserIds,
  initialProxySides,
  browserIdForTab,
} from "./proxy.mjs";
import { recompute } from "./update.mjs";
import { allDividers, ensureDividers } from "./divider.mjs";
import { inbox } from "./inbox.mjs";
import {
  placementWouldMove,
  applyPlacement,
} from "./dnd.mjs";

let initTime = 0;
let altSideUntil = 0;
let currentCreation = null;
let originalAddTab = null;
let wrappedAddTab = null;
let originalLoadTabs = null;
let wrappedLoadTabs = null;
const openingDecisions = new WeakMap();
const pendingNavigation = new WeakMap();
const browserHooks = new Map();

function creationMode(options) {
  const explicit = options.eventDetail?.zenProxyRoute;
  if (typeof explicit === "boolean") {
    return explicit ? "proxy" : "direct";
  }
  if (options.fromExternal) {
    return inbox.routeFor("external");
  }
  if (peekAltSide()) {
    return newTabsGoDirect() ? "proxy" : "direct";
  }
  const linked = !options._forZenEmptyTab && !gURLBar?.hasAttribute("zen-newtab") &&
    (options.openerBrowser || options.relatedToCurrent || options.referrerInfo?.originalReferrer);
  return inbox.routeFor(linked ? "link" : "newtab");
}

function discardBufferedTab(tab) {
  pendingNavigation.delete(tab);
  setTimeout(() => {
    if (!tab.isConnected) {
      return;
    }
    if (tab.hasAttribute("zen-empty-tab")) {
      tab.linkedBrowser.userTypedValue = null;
      gURLBar.handleRevert();
    } else {
      gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
    }
  }, 0);
}

function routeFirstNavigation(tab, url) {
  let mode = pendingNavigation.get(tab);
  if (!mode && !tab.hasAttribute("zen-empty-tab")) {
    return false;
  }
  if (!/^(https?|file|ftp):/i.test(url)) {
    return false;
  }
  if (!mode || mode === "newtab") {
    mode = inbox.routeFor("newtab");
  }
  if (mode === "manual" && inbox.bufferExternalURL(window, url)) {
    discardBufferedTab(tab);
    return true;
  }
  pendingNavigation.delete(tab);
  openingDecisions.set(tab, { proxyOn: mode !== "direct", reason: "first navigation setting" });
  initialProxySides.set(tab, mode !== "direct");
  preRouteNewTab(tab);
  ensureDividers();
  placeNewTab(tab);
  setTimeout(() => {
    placeNewTab(tab);
    initialProxySides.delete(tab);
    openingDecisions.delete(tab);
    recompute();
  }, 300);
  return false;
}

function hookBrowser(tab) {
  const browser = tab.linkedBrowser;
  if (!browser || browserHooks.has(browser)) {
    return;
  }
  const hooks = {};
  for (const method of ["loadURI", "fixupAndLoadURIString"]) {
    const original = browser[method];
    if (typeof original !== "function") {
      continue;
    }
    const wrapped = function (uri, ...args) {
      if (pendingNavigation.has(tab) || tab.hasAttribute("zen-empty-tab")) {
        let url = uri?.spec || uri;
        if (method === "fixupAndLoadURIString" && typeof url === "string") {
          const flags = Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP |
            Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS;
          url = Services.uriFixup.getFixupURIInfo(url, flags).preferredURI?.spec || url;
        }
        if (routeFirstNavigation(tab, url)) {
          return;
        }
      }
      return original.call(this, uri, ...args);
    };
    hooks[method] = { original, wrapped };
    browser[method] = wrapped;
  }
  browserHooks.set(browser, hooks);
}

function handleBrowserInserted(event) {
  hookBrowser(event.target);
}

function forgetBrowser(event) {
  pendingNavigation.delete(event.target);
  browserHooks.delete(event.target.linkedBrowser);
}

// window.open can allocate an about:blank context first and navigate it in
// the content process later. Cancel that document channel before any HTTP
// connection, then send its URL to Unsorted like chrome-initiated loads.
const openingRequestObserver = {
  observe(subject) {
    const channel = subject.QueryInterface(Ci.nsIChannel);
    const info = channel.loadInfo;
    if (info.externalContentPolicyType !== Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      return;
    }
    const id = info.browsingContext?.top?.browserId;
    const tab = gBrowser.tabs.find(t => browserIdForTab(t) === id && pendingNavigation.has(t));
    if (tab && routeFirstNavigation(tab, channel.URI.spec)) {
      channel.cancel(Components.results.NS_BINDING_ABORTED);
    }
  },
};

export function installNewTabRouting() {
  markInitTime();
  originalAddTab = gBrowser.addTab;
  wrappedAddTab = function (url, options = {}) {
    const live = !options.skipLoad && !options.createLazyBrowser && options.insertTab !== false;
    const mode = creationMode(options);
    const buffered = live && mode === "manual" && !options.pinned && !options.essential &&
      inbox.bufferExternalURL(window, url);
    if (buffered) {
      url = "about:blank";
      options = { ...options, skipLoad: true, inBackground: true };
    }
    const previous = currentCreation;
    currentCreation = { live, mode, buffered };
    try {
      const tab = originalAddTab.call(this, url, options);
      if (tab && buffered) {
        discardBufferedTab(tab);
      }
      return tab;
    } finally {
      currentCreation = previous;
    }
  };
  gBrowser.addTab = wrappedAddTab;
  originalLoadTabs = gBrowser.loadTabs;
  wrappedLoadTabs = function (urls, options = {}) {
    if (options.fromExternal && inbox.routeFor("external") === "manual") {
      urls = urls.filter((url) => !inbox.bufferExternalURL(window, url));
      if (!urls.length) {
        return [];
      }
    }
    return originalLoadTabs.call(this, urls, options);
  };
  gBrowser.loadTabs = wrappedLoadTabs;
  for (const tab of gBrowser.tabs) {
    hookBrowser(tab);
  }
  gBrowser.tabContainer.addEventListener("TabBrowserInserted", handleBrowserInserted);
  gBrowser.tabContainer.addEventListener("TabClose", forgetBrowser);
  Services.obs.addObserver(openingRequestObserver, "http-on-opening-request");
}

export function removeNewTabRouting() {
  Services.obs.removeObserver(openingRequestObserver, "http-on-opening-request");
  gBrowser.tabContainer.removeEventListener("TabBrowserInserted", handleBrowserInserted);
  gBrowser.tabContainer.removeEventListener("TabClose", forgetBrowser);
  for (const [browser, hooks] of browserHooks) {
    for (const [method, { original, wrapped }] of Object.entries(hooks)) {
      if (browser[method] === wrapped) {
        browser[method] = original;
      }
    }
  }
  browserHooks.clear();
  if (gBrowser.addTab === wrappedAddTab) {
    gBrowser.addTab = originalAddTab;
  }
  if (gBrowser.loadTabs === wrappedLoadTabs) {
    gBrowser.loadTabs = originalLoadTabs;
  }
}

export function markInitTime() {
  initTime = Date.now();
}

// Alt+Enter in the URL bar: commit as a plain Enter (Firefox's own
// Alt+Enter would spawn an extra tab), but flag the resulting tab to go
// to the opposite of the default side.
export function handleKeyDown(event) {
  if (
    event.key !== "Enter" ||
    !event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  const urlbar = window.gURLBar;
  // dragstart taught us the target can be a Text node — climb first.
  const node =
    event.target?.nodeType === Node.TEXT_NODE
      ? event.target.parentElement
      : event.target;
  const inUrlbar =
    urlbar?.focused ||
    urlbar?.textbox?.contains(node) ||
    node?.closest?.("#urlbar, #urlbar-container, .urlbarView");
  log(
    "Alt+Enter keydown —",
    inUrlbar ? "in URL bar" : "outside URL bar, ignoring",
    `(target: ${node?.id || node?.nodeName || "?"}, focused: ${!!urlbar?.focused})`
  );
  if (!inUrlbar) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  altSideUntil = Date.now() + 3000;
  // Route the tab before the navigation even starts, so the very first
  // document request already takes the intended side.
  const selectedTab = gBrowser.selectedTab;
  if (selectedTab?.hasAttribute("zen-empty-tab")) {
    preRouteNewTab(selectedTab);
  }
  // Hand the urlbar a modifier-free Enter so whereToOpenLink() says
  // "current" — Zen may wrap handleCommand, so always pass an event.
  const plainEnter = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: KeyboardEvent.DOM_VK_RETURN,
    bubbles: true,
    cancelable: true,
  });
  try {
    urlbar.handleCommand(plainEnter);
    log("Alt+Enter — committed, next tab goes to the alternate side");
  } catch (e) {
    altSideUntil = 0;
    logError("Alt+Enter commit failed", e);
  }
}

function consumeAltSide() {
  if (Date.now() < altSideUntil) {
    altSideUntil = 0;
    return true;
  }
  return false;
}

function peekAltSide() {
  return Date.now() < altSideUntil;
}

// Where should this tab go? proxyOn is the side's proxy state; the flag
// is only consumed by the final placement, peeked by the pre-route.
function decideNewTabSide(tab, consumeFlag) {
  const opening = openingDecisions.get(tab);
  if (opening) {
    return opening;
  }
  if (consumeFlag ? consumeAltSide() : peekAltSide()) {
    return { proxyOn: newTabsGoDirect(), reason: "Alt+Enter — alternate side" };
  }
  const mode = currentCreation?.mode || inbox.routeFor(openerTabFor(tab) ? "link" : "newtab");
  if (mode !== "inherit") {
    return { proxyOn: mode !== "direct", mode, reason: `${mode} setting` };
  }
  const opener = openerTabFor(tab);
  if (opener) {
    if (isManualTab(opener)) {
      return {
        proxyOn: manualProxyFlag(opener),
        reason: "inherited from pinned/essential opener",
      };
    }
    const openerDivider = allDividers().find((d) =>
      d.parentNode?.contains(opener)
    );
    if (openerDivider) {
      const openerBelow = !!(
        openerDivider.compareDocumentPosition(opener) & FOLLOWING
      );
      return {
        proxyOn: openerBelow === isReversed(),
        reason: "inherited from opener",
      };
    }
  }
  return { proxyOn: !newTabsGoDirect(), reason: "default side" };
}

// Route the browser BEFORE its first network request: the channel filter
// consults directBrowserIds the moment the load starts, which is earlier
// than any deferred DOM update. initialProxySides keeps recomputes from
// changing the route during Zen's remaining insertion steps.
function preRouteNewTab(tab) {
  if (
    tab.pinned ||
    tab.hasAttribute("zen-essential") ||
    tab.hasAttribute("zen-glance-tab")
  ) {
    return;
  }
  const browserId = browserIdForTab(tab);
  if (!browserId) {
    return;
  }
  const { proxyOn, reason } = decideNewTabSide(tab, false);
  if (proxyOn) {
    directBrowserIds.delete(browserId);
  } else {
    directBrowserIds.add(browserId);
  }
  log("pre-routed new tab:", proxyOn ? "proxy" : "direct", `(${reason})`);
}

function inStartupWindow() {
  // Session restore replays TabOpen for every saved tab right after
  // startup — their order is already correct, do not reshuffle it.
  return Date.now() - initTime < 5000;
}

export function handleTabOpen(event) {
  const tab = event.target;
  hookBrowser(tab);
  if (currentCreation?.buffered) {
    return;
  }
  const explicit = event.detail?.zenProxyRoute;
  if (tab.hasAttribute("pending") && typeof explicit !== "boolean") {
    return;
  }
  if (inStartupWindow() && !currentCreation?.live && typeof explicit !== "boolean") {
    return;
  }
  const decision = typeof explicit === "boolean"
    ? { proxyOn: explicit, reason: "incoming URL: chosen side" }
    : decideNewTabSide(tab, true);
  if (decision.mode === "manual" && !tab.pinned && !tab.hasAttribute("zen-essential")) {
    pendingNavigation.set(tab, tab.hasAttribute("zen-empty-tab") ? "newtab" : "manual");
    return;
  }
  if (tab.hasAttribute("zen-empty-tab")) {
    pendingNavigation.set(tab, "newtab");
  }
  openingDecisions.set(tab, decision);
  initialProxySides.set(tab, decision.proxyOn);
  preRouteNewTab(tab);
  // This listener runs inside addTab(), before its first document load.
  // Establish both the network route and the sidebar position synchronously.
  ensureDividers();
  placeNewTab(tab);
  setTimeout(() => {
    if (initialProxySides.has(tab)) {
      placeNewTab(tab);
    }
  }, 0);
  setTimeout(() => {
    if (initialProxySides.has(tab)) {
      placeNewTab(tab);
      initialProxySides.delete(tab);
      openingDecisions.delete(tab);
      recompute();
    }
  }, 300);
}

// Zen's fresh tabs (Ctrl+T, the New Tab button) start as an "empty tab"
// and become a real tab with NO TabOpen event when a URL is entered — the
// zen-empty-tab attribute is simply removed. Route them through the same
// placement. Returns true when the mutation was a real-tab conversion.
export function handleTabAttrMutation(mutation) {
  const tab = mutation.target;
  if (
    mutation.oldValue !== null &&
    !tab.hasAttribute?.("zen-empty-tab") &&
    tab.matches?.("tab.tabbrowser-tab") &&
    !inStartupWindow()
  ) {
    log("empty tab became real — placing it");
    preRouteNewTab(tab);
    setTimeout(() => placeNewTab(tab), 0);
    return true;
  }
  return false;
}

function placeNewTab(tab) {
  if (
    !tab?.isConnected ||
    tab.pinned ||
    tab.hasAttribute("zen-essential") ||
    tab.hasAttribute("zen-empty-tab") ||
    tab.hasAttribute("zen-glance-tab") ||
    tab.hasAttribute("pending") // lazily restored tab — keep saved order
  ) {
    return;
  }
  const divider = allDividers().find((d) => d.parentNode?.contains(tab));
  if (!divider) {
    return;
  }
  const proxyIsBelow = isReversed();
  const { proxyOn, reason } = decideNewTabSide(tab, true);
  const placeBelow = proxyOn ? proxyIsBelow : !proxyIsBelow;
  const placement = { divider, tabs: [tab], placeBelow };
  const side = proxyOn ? "proxy" : "direct";
  if (!placementWouldMove(placement)) {
    log("new tab already on the", side, "side", `(${reason})`);
    return;
  }
  log("new tab →", side, `(${reason})`);
  applyPlacement(placement);
  recompute();
}
