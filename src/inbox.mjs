// Incoming URLs are sidebar cards, not lazy tabs: selecting a lazy tab
// would load it before the user has chosen PROXY or DIRECT.

import { allDividers, ensureDividers } from "./divider.mjs";
import { FOLLOWING, isReversed, logError } from "./prefs.mjs";
import { unpinnedTabs, moveTabNextTo } from "./tabs.mjs";
import { applyPlacement, updateDropHint } from "./dnd.mjs";
import { recompute } from "./update.mjs";
import { browserIdForTab, directBrowserIds, initialProxySides } from "./proxy.mjs";

export const inbox = ChromeUtils.importESModule(
  new URL("../zen-proxy-routing.sys.mjs", import.meta.url).href
);
export const INBOX_DROP_TYPE = "application/x-zen-proxy-inbox";
let panel = null;
let unwatch = null;
let dropIndicator = null;

function renderInbox() {
  if (!panel) {
    return;
  }
  const entries = inbox.inboxEntries(window);
  panel.hidden = !entries.length;
  const list = panel.querySelector(".zen-proxy-inbox-list");
  list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    row.className = "zen-proxy-inbox-entry";
    row.draggable = true;
    row.title = entry.url;
    const label = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    label.textContent = entry.url;
    const close = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
    close.className = "zen-proxy-inbox-close";
    close.type = "button";
    close.title = "Убрать из буфера";
    close.setAttribute("aria-label", close.title);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      inbox.removeInboxEntry(window, entry.id);
    });
    close.addEventListener("dragstart", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    row.append(label, close);
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(INBOX_DROP_TYPE, entry.id);
      event.dataTransfer.effectAllowed = "move";
    });
    list.appendChild(row);
  }
}

const inboxObserver = { observe: renderInbox };

function placeInbox() {
  if (!panel) {
    return;
  }
  const workspace = window.gZenWorkspaces?.activeWorkspaceElement;
  const periphery = workspace?.querySelector("#tabbrowser-arrowscrollbox-periphery") ||
    document.getElementById("tabbrowser-arrowscrollbox-periphery");
  if (periphery?.parentNode && periphery.nextElementSibling !== panel) {
    periphery.after(panel);
  }
}

export function setupInbox() {
  const tabstrip = document.getElementById("tabbrowser-tabs");
  if (!tabstrip?.parentNode || panel) {
    return;
  }
  panel = document.createElementNS("http://www.w3.org/1999/xhtml", "section");
  panel.id = "zen-proxy-inbox";
  const header = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  header.className = "zen-proxy-inbox-heading";
  header.textContent = "Unsorted";
  const list = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  list.className = "zen-proxy-inbox-list";
  panel.append(header, list);
  // The normal-tab list is below Essentials and pinned tabs. Insert after
  // New Tab, then move this shared inbox when the active workspace changes.
  placeInbox();
  window.addEventListener("ZenWorkspacesUIUpdate", placeInbox);
  window.addEventListener("AfterWorkspacesSessionRestore", placeInbox);
  Services.prefs.addObserver(inbox.INBOX_PREF, inboxObserver);
  unwatch = inbox.watchInbox(renderInbox);
  window.addEventListener("dragover", handleInboxDragover, true);
  window.addEventListener("drop", handleInboxDrop, true);
  window.addEventListener("dragend", clearInboxDropHint, true);
  window.addEventListener("dragleave", handleInboxDragleave, true);
  renderInbox();
}

function dropDestination(event) {
  if (panel.contains(event.target)) {
    return null;
  }
  const sidebar = document.getElementById("tabbrowser-tabs");
  const area = sidebar?.getBoundingClientRect();
  if (!area || event.clientY < area.top || event.clientY > area.bottom) {
    return null;
  }
  for (const divider of allDividers()) {
    const rect = divider.getBoundingClientRect();
    if (
      rect.width && rect.height &&
      event.clientX >= rect.left - 8 && event.clientX <= rect.right + 8
    ) {
      const below = event.clientY > rect.top + rect.height / 2;
      const tabs = unpinnedTabs().filter((tab) => {
        const tabRect = tab.getBoundingClientRect();
        return tab.parentNode === divider.parentNode && tabRect.width && tabRect.height &&
          !!(divider.compareDocumentPosition(tab) & FOLLOWING) === below;
      });
      const next = tabs.find((tab) => {
        const tabRect = tab.getBoundingClientRect();
        return event.clientY < tabRect.top + tabRect.height / 2;
      });
      const anchor = next || tabs.at(-1) || null;
      const before = !!next;
      const anchorRect = anchor?.getBoundingClientRect();
      const lineY = anchorRect
        ? (before ? anchorRect.top : anchorRect.bottom)
        : (below ? rect.bottom : rect.top);
      const lineRect = anchorRect || rect;
      return { proxyOn: below === isReversed(), divider, placeBelow: below,
        anchor, before, lineY, lineLeft: lineRect.left + 2, lineWidth: lineRect.width - 4 };
    }
  }
  return null;
}

function clearInboxDropHint() {
  if (dropIndicator) {
    if (window.gZenPinnedTabManager._dragIndicator === dropIndicator) {
      window.gZenPinnedTabManager.removeTabContainersDragoverClass(false);
    } else {
      dropIndicator.remove();
    }
    dropIndicator = null;
  }
  updateDropHint(null);
}

function handleInboxDragleave(event) {
  if (event.target === document.documentElement && !event.relatedTarget) {
    clearInboxDropHint();
  }
}

function handleInboxDragover(event) {
  if (!event.dataTransfer?.types?.includes(INBOX_DROP_TYPE)) {
    return;
  }
  event.stopImmediatePropagation();
  const destination = dropDestination(event);
  if (destination) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    updateDropHint(destination);
    dropIndicator = gBrowser.tabContainer.tabDragAndDrop._placeDropIndicator({
      left: destination.lineLeft, width: destination.lineWidth, top: destination.lineY,
    });
  } else {
    event.dataTransfer.dropEffect = "none";
    clearInboxDropHint();
  }
}

function handleInboxDrop(event) {
  if (!event.dataTransfer?.types?.includes(INBOX_DROP_TYPE)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const destination = dropDestination(event);
  clearInboxDropHint();
  if (!destination) {
    return;
  }
  const id = event.dataTransfer.getData(INBOX_DROP_TYPE);
  const entry = inbox.inboxEntries(window).find((e) => e.id === id);
  if (entry) {
    openInboxEntry(entry, destination);
  }
}

export function openInboxEntry(entry, { proxyOn, divider, anchor, before }) {
  let tab;
  try {
    tab = gBrowser.addTab("about:blank", {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      inBackground: true,
      skipRoute: true,
      // Makes the route available during TabOpen, before a document can load.
      eventDetail: { zenProxyRoute: proxyOn },
      zenWorkspaceId: divider?.closest("[zen-workspace-id]")?.getAttribute("zen-workspace-id"),
    });
    if (!tab) {
      return;
    }
    ensureDividers();
    divider ||= allDividers().find((d) => d.parentNode?.contains(tab));
    if (!divider) {
      throw new Error("No proxy divider for the incoming tab");
    }
    applyPlacement({ divider, tabs: [tab], placeBelow: proxyOn === isReversed() });
    if (anchor?.isConnected) {
      moveTabNextTo(tab, anchor, before);
    }
    initialProxySides.delete(tab);
    recompute();
    const browserId = browserIdForTab(tab);
    if (proxyOn) {
      directBrowserIds.delete(browserId);
    } else {
      directBrowserIds.add(browserId);
    }
    tab.linkedBrowser.loadURI(Services.io.newURI(entry.url), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL |
        Ci.nsIWebNavigation.LOAD_FLAGS_FROM_EXTERNAL,
    });
    inbox.removeInboxEntry(window, entry.id);
    gBrowser.selectedTab = tab;
  } catch (e) {
    if (tab?.isConnected && tab.linkedBrowser.currentURI.spec === "about:blank") {
      gBrowser.removeTab(tab, { animate: false });
    }
    logError("opening incoming URL failed; kept in inbox", e);
  }
}

export function removeInbox() {
  Services.prefs.removeObserver(inbox.INBOX_PREF, inboxObserver);
  unwatch?.();
  window.removeEventListener("dragover", handleInboxDragover, true);
  window.removeEventListener("drop", handleInboxDrop, true);
  window.removeEventListener("dragend", clearInboxDropHint, true);
  window.removeEventListener("dragleave", handleInboxDragleave, true);
  window.removeEventListener("ZenWorkspacesUIUpdate", placeInbox);
  window.removeEventListener("AfterWorkspacesSessionRestore", placeInbox);
  panel?.remove();
  panel = null;
  clearInboxDropHint();
}
