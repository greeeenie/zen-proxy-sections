// New tab placement: a tab opened FROM another tab (link, target=_blank,
// middle click) inherits the opener's proxy side; a fresh tab (Ctrl+T,
// the New Tab button) goes to the side chosen in the mod settings.

import {
  FOLLOWING,
  newTabsGoDirect,
  isReversed,
  manualProxyFlag,
  log,
} from "./prefs.mjs";
import { isManualTab, openerTabFor } from "./tabs.mjs";
import { allDividers } from "./divider.mjs";
import {
  placementWouldMove,
  placementHolds,
  applyPlacement,
} from "./dnd.mjs";

let initTime = 0;

export function markInitTime() {
  initTime = Date.now();
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
  let placeBelow;
  let reason;
  const opener = openerTabFor(tab);
  if (opener) {
    if (isManualTab(opener)) {
      // Pinned/Essentials openers pass on their own proxy state.
      placeBelow = manualProxyFlag(opener) ? proxyIsBelow : !proxyIsBelow;
      reason = "inherited from pinned/essential opener";
    } else {
      const openerDivider = allDividers().find((d) =>
        d.parentNode?.contains(opener)
      );
      if (openerDivider) {
        placeBelow = !!(
          openerDivider.compareDocumentPosition(opener) & FOLLOWING
        );
        reason = "inherited from opener";
      }
    }
  }
  if (placeBelow === undefined) {
    placeBelow = newTabsGoDirect() ? !proxyIsBelow : proxyIsBelow;
    reason = "default side";
  }
  const placement = { divider, tabs: [tab], placeBelow };
  const side = placeBelow === proxyIsBelow ? "proxy" : "direct";
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
