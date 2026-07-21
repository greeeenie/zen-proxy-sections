// Wiring: listeners, observers, init and teardown.

import {
  DIVIDER_CLASS,
  HEADER_CLASS,
  DOT_CLASS,
  PREF_STYLE,
  PREF_DIVIDER_ORDER,
  PREF_SECTIONS_ORDER,
  PREF_INDICATOR_POS,
  PREF_INDICATOR_COLOR,
  getStyleMode,
  log,
  logError,
} from "./prefs.mjs";
import { registerFilter, unregisterFilter, directBrowserIds } from "./proxy.mjs";
import { ensureDividers } from "./divider.mjs";
import { applyIndicatorAttrs } from "./indicator.mjs";
import { recompute, scheduleUpdate } from "./update.mjs";
import {
  handleDragStart,
  handleContainerDragover,
  handleContainerDrop,
  handleDragEnd,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
} from "./dnd.mjs";
import {
  markInitTime,
  handleTabOpen,
  handleTabAttrMutation,
  handleKeyDown,
} from "./newtab.mjs";
import { setupContextMenu, removeContextMenu } from "./menu.mjs";

const VERSION = "0.10.0";

const STYLE_PREFS = [
  PREF_STYLE,
  PREF_DIVIDER_ORDER,
  PREF_SECTIONS_ORDER,
  PREF_INDICATOR_POS,
  PREF_INDICATOR_COLOR,
];

let mutationObserver = null;

const stylePrefObserver = {
  observe() {
    scheduleUpdate();
  },
};

function addListeners() {
  const container = gBrowser.tabContainer;
  for (const type of [
    "TabOpen",
    "TabClose",
    "TabMove",
    "TabPinned",
    "TabUnpinned",
    "TabBrowserInserted",
  ]) {
    container.addEventListener(type, scheduleUpdate);
  }
  container.addEventListener("TabOpen", handleTabOpen);
  mutationObserver = new MutationObserver((mutations) => {
    let relevant = false;
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (handleTabAttrMutation(m)) {
          relevant = true;
        }
        continue;
      }
      if (
        [...m.addedNodes, ...m.removedNodes].some(
          (n) =>
            !(
              n.classList?.contains?.(DIVIDER_CLASS) ||
              n.classList?.contains?.(HEADER_CLASS) ||
              n.classList?.contains?.(DOT_CLASS)
            )
        )
      ) {
        relevant = true;
      }
    }
    if (relevant) {
      scheduleUpdate();
    }
  });
  mutationObserver.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["zen-empty-tab"],
    attributeOldValue: true,
  });
  // Capture phase on window for everything: Zen's own handlers may
  // stopPropagation(), and window-capture is the one spot they cannot
  // silence. Ordering relative to Zen's commit is handled by deferring
  // placements via setTimeout instead of listener phase.
  window.addEventListener("dragstart", handleDragStart, true);
  window.addEventListener("dragover", handleContainerDragover, true);
  window.addEventListener("drop", handleContainerDrop, true);
  window.addEventListener("dragend", handleDragEnd, true);
  window.addEventListener("pointerdown", handleMouseDown, true);
  window.addEventListener("pointermove", handleMouseMove, true);
  window.addEventListener("pointerup", handleMouseUp, true);
  window.addEventListener("mousedown", handleMouseDown, true);
  window.addEventListener("mousemove", handleMouseMove, true);
  window.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("keydown", handleKeyDown, true);
  for (const pref of STYLE_PREFS) {
    Services.prefs.addObserver(pref, stylePrefObserver);
  }
  setupContextMenu();
  window.addEventListener("unload", teardown, { once: true });
}

function teardown() {
  unregisterFilter();
  removeContextMenu();
  try {
    gBrowser.tabContainer.removeEventListener("TabOpen", handleTabOpen);
  } catch (e) {}
  for (const pref of STYLE_PREFS) {
    try {
      Services.prefs.removeObserver(pref, stylePrefObserver);
    } catch (e) {}
  }
  mutationObserver?.disconnect();
  window.removeEventListener("dragstart", handleDragStart, true);
  window.removeEventListener("dragover", handleContainerDragover, true);
  window.removeEventListener("drop", handleContainerDrop, true);
  window.removeEventListener("dragend", handleDragEnd, true);
  window.removeEventListener("pointerdown", handleMouseDown, true);
  window.removeEventListener("pointermove", handleMouseMove, true);
  window.removeEventListener("pointerup", handleMouseUp, true);
  window.removeEventListener("mousedown", handleMouseDown, true);
  window.removeEventListener("mousemove", handleMouseMove, true);
  window.removeEventListener("mouseup", handleMouseUp, true);
  window.removeEventListener("keydown", handleKeyDown, true);
  directBrowserIds.clear();
}

function init() {
  if (!window.gBrowser?.tabContainer) {
    setTimeout(init, 500);
    return;
  }
  try {
    markInitTime();
    registerFilter();
    addListeners();
    applyIndicatorAttrs();
    ensureDividers();
    recompute();
    log(
      `initialized (v${VERSION}, style:`,
      getStyleMode() + ");",
      directBrowserIds.size,
      "direct tab(s)"
    );
  } catch (e) {
    logError("init failed", e);
  }
}

export function bootstrap() {
  if (gBrowserInit?.delayedStartupFinished) {
    // Give Zen workspaces a moment to finish building the sidebar DOM.
    setTimeout(init, 300);
  } else {
    const observer = (subject) => {
      if (subject === window) {
        Services.obs.removeObserver(
          observer,
          "browser-delayed-startup-finished"
        );
        setTimeout(init, 300);
      }
    };
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
  }
}
