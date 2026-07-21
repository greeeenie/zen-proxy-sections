// New tab placement: a tab opened FROM another tab (link, target=_blank,
// middle click) inherits the opener's proxy side; a fresh tab (Ctrl+T,
// the New Tab button) goes to the side chosen in the mod settings.
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
  lastRouteProxied,
  browserIdForTab,
} from "./proxy.mjs";
import { maybeReloadTab } from "./update.mjs";
import { allDividers } from "./divider.mjs";
import {
  placementWouldMove,
  placementHolds,
  applyPlacement,
} from "./dnd.mjs";

let initTime = 0;
let altSideUntil = 0;

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
  if (consumeFlag ? consumeAltSide() : peekAltSide()) {
    return { proxyOn: newTabsGoDirect(), reason: "Alt+Enter — alternate side" };
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
// than the DOM placement and the recompute it triggers. A recompute may
// briefly override this, so verifyRoute() below is the safety net.
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

// The first document load can still race the pre-route; compare the route
// it actually took with the intended one and reload once if they differ.
function verifyRoute(tab, proxyOn) {
  if (!tab.isConnected) {
    return;
  }
  const actual = lastRouteProxied.get(browserIdForTab(tab));
  if (actual === undefined || actual === proxyOn) {
    return;
  }
  log(
    "first load took the wrong route — reloading through",
    proxyOn ? "proxy" : "direct"
  );
  maybeReloadTab(tab, true);
}

function scheduleRouteVerify(tab, proxyOn) {
  // Late checks catch slow sites whose document response arrives after
  // the early ones (a corrected load resets lastRouteProxied, so a
  // successful reload makes the later checks no-ops).
  for (const delay of [700, 2000, 5000]) {
    setTimeout(() => verifyRoute(tab, proxyOn), delay);
  }
}

function inStartupWindow() {
  // Session restore replays TabOpen for every saved tab right after
  // startup — their order is already correct, do not reshuffle it.
  return Date.now() - initTime < 5000;
}

export function handleTabOpen(event) {
  if (inStartupWindow()) {
    return;
  }
  const tab = event.target;
  preRouteNewTab(tab);
  // Let Zen finish inserting the tab (and the opener wiring settle).
  setTimeout(() => placeNewTab(tab), 0);
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
  scheduleRouteVerify(tab, proxyOn);
  if (!placementWouldMove(placement)) {
    log("new tab already on the", side, "side", `(${reason})`);
    return;
  }
  log("new tab →", side, `(${reason})`);
  applyPlacement(placement);
  // Zen may still be animating/inserting; verify once after it settles.
  setTimeout(() => {
    if (!placementHolds(placement)) {
      applyPlacement(placement);
    }
  }, 300);
}
