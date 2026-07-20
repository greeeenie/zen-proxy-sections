// Tab lookup and movement helpers.

import { logError } from "./prefs.mjs";

export function unpinnedTabs() {
  return gBrowser.tabs.filter(
    (tab) =>
      !tab.pinned &&
      !tab.hasAttribute("zen-essential") &&
      !tab.hasAttribute("zen-empty-tab") &&
      !tab.hasAttribute("zen-glance-tab") &&
      tab.isConnected
  );
}

export function isManualTab(tab) {
  return tab.pinned || tab.hasAttribute("zen-essential");
}

export function workspaceKeyFor(container) {
  const section = container.closest?.(
    "[zen-workspace-id], .zen-workspace-tabs-section"
  );
  return (
    section?.getAttribute?.("zen-workspace-id") ||
    section?.id ||
    "default"
  );
}

// NB: no ownerGlobal === window checks anywhere — the sine sandbox wraps
// `window`, so identity comparisons against it are always false.
// Membership in this window's gBrowser.tabs is the real test.
export function filterMovableTabs(tabs) {
  return tabs.filter(
    (t) =>
      t &&
      !t.pinned &&
      !t.hasAttribute("zen-essential") &&
      gBrowser.tabs.includes(t)
  );
}

// Drag events may target a Text node (the tab label), which has no
// closest(); climb to the nearest element first.
export function tabFromEventTarget(target) {
  const el =
    target && target.nodeType === Node.ELEMENT_NODE
      ? target
      : target?.parentElement;
  return el?.closest?.("tab.tabbrowser-tab") || null;
}

export function moveTabNextTo(tab, anchor, before) {
  if (tab === anchor) {
    return;
  }
  try {
    if (before && typeof gBrowser.moveTabBefore === "function") {
      gBrowser.moveTabBefore(tab, anchor);
      return;
    }
    if (!before && typeof gBrowser.moveTabAfter === "function") {
      gBrowser.moveTabAfter(tab, anchor);
      return;
    }
  } catch (e) {
    logError("moveTabBefore/After failed, falling back", e);
  }
  let index = anchor._tPos;
  if (before) {
    index = tab._tPos < index ? index - 1 : index;
  } else {
    index = tab._tPos < index ? index : index + 1;
  }
  try {
    gBrowser.moveTabTo(tab, index);
  } catch (e) {
    try {
      gBrowser.moveTabTo(tab, { tabIndex: index });
    } catch (e2) {
      logError("moveTabTo failed", e2);
    }
  }
}

export function openerTabFor(tab) {
  const candidates = [];
  try {
    if (tab.openerTab) {
      candidates.push(tab.openerTab);
    }
  } catch (e) {}
  try {
    if (tab.owner) {
      candidates.push(tab.owner);
    }
  } catch (e) {}
  try {
    // Covers window.open/target=_blank even when openerTab is not set.
    const browser =
      tab.linkedBrowser?.browsingContext?.opener?.top?.embedderElement;
    if (browser) {
      const t = gBrowser.getTabForBrowser(browser);
      if (t) {
        candidates.push(t);
      }
    }
  } catch (e) {}
  return (
    candidates.find((t) => t && t !== tab && gBrowser.tabs.includes(t)) ||
    null
  );
}
