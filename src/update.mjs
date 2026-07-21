// Recomputing which tabs are proxied/direct, applying the per-tab state,
// and auto-reloading tabs whose side changed.

import {
  FOLLOWING,
  getStyleMode,
  isReversed,
  loadCollapsed,
  isCollapsed,
  getIndicatorPos,
  reloadOnSwitch,
  manualProxyFlag,
  log,
  logError,
} from "./prefs.mjs";
import { unpinnedTabs, workspaceKeyFor, isManualTab } from "./tabs.mjs";
import { directBrowserIds, browserIdForTab } from "./proxy.mjs";
import { updateDot, applyIndicatorAttrs } from "./indicator.mjs";
import { allDividers, ensureDividers, savePositions } from "./divider.mjs";

let updateScheduled = false;

// Last proxy state actually applied to each tab. A tab seen for the first
// time is only recorded — reloads happen exclusively on later changes
// (crossing the divider, flipping the order, toggling the manual flag).
const lastAppliedProxy = new WeakMap();

// force bypasses the reload-on-switch pref — used when a brand-new tab's
// first load went through the wrong route and the content is simply wrong.
export function maybeReloadTab(tab, force = false) {
  if (
    (!force && !reloadOnSwitch()) ||
    !tab.isConnected ||
    tab.hasAttribute("pending")
  ) {
    return;
  }
  const browser = tab.linkedBrowser;
  const spec = browser?.currentURI?.spec || "";
  // Only real web content benefits from a reload through the new route.
  if (!/^(https?|file|ftp):/i.test(spec)) {
    return;
  }
  try {
    browser.reload();
    log(
      "reloaded after side switch:",
      (tab.getAttribute("label") || spec).slice(0, 40)
    );
  } catch (e) {
    logError("reload after side switch failed", e);
  }
}

// Applies the per-tab proxy flag: the dot indicator marks proxied tabs,
// tabs WITHOUT the flag are routed directly by the channel filter.
function setProxyState(tab, proxyOn, indicatorMode) {
  if (proxyOn) {
    tab.setAttribute("zen-proxy-on", "true");
  } else {
    tab.removeAttribute("zen-proxy-on");
    const browserId = browserIdForTab(tab);
    if (browserId) {
      directBrowserIds.add(browserId);
    }
  }
  updateDot(tab, proxyOn, indicatorMode);
  const prev = lastAppliedProxy.get(tab);
  lastAppliedProxy.set(tab, proxyOn);
  if (prev !== undefined && prev !== proxyOn) {
    // Defer past the current recompute so the filter set is complete.
    setTimeout(() => maybeReloadTab(tab), 0);
  }
}

export function recompute() {
  const prevSize = directBrowserIds.size;
  directBrowserIds.clear();
  const dividers = allDividers();
  const collapsedState = loadCollapsed();
  const sectionsMode = getStyleMode() === "sections";
  const reversed = isReversed();
  const indicatorMode = getIndicatorPos();
  for (const tab of unpinnedTabs()) {
    let direct = false;
    for (const divider of dividers) {
      if (!divider.parentNode?.contains(tab)) {
        continue;
      }
      const below = !!(divider.compareDocumentPosition(tab) & FOLLOWING);
      direct = reversed ? !below : below;
      break;
    }
    setProxyState(tab, !direct, indicatorMode);
    const hide =
      sectionsMode &&
      isCollapsed(
        collapsedState,
        workspaceKeyFor(tab),
        direct ? "direct" : "proxy"
      );
    tab.toggleAttribute("zen-proxy-hidden", hide);
  }
  for (const tab of gBrowser.tabs) {
    if (tab.isConnected && isManualTab(tab)) {
      tab.removeAttribute("zen-proxy-hidden");
      setProxyState(tab, manualProxyFlag(tab), indicatorMode);
    }
  }
  if (directBrowserIds.size !== prevSize) {
    log(directBrowserIds.size, "direct tab(s)");
  }
}

export function scheduleUpdate() {
  if (updateScheduled) {
    return;
  }
  updateScheduled = true;
  setTimeout(() => {
    updateScheduled = false;
    try {
      applyIndicatorAttrs();
      ensureDividers();
      savePositions();
      recompute();
    } catch (e) {
      logError("update failed", e);
    }
  }, 50);
}
