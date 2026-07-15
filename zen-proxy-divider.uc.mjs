// ==UserScript==
// @name           Zen Proxy Divider
// @description    Draggable divider in the Zen sidebar: tabs above it use the browser proxy, tabs below it connect directly.
// @include        chrome://browser/content/browser.xhtml
// ==/UserScript==

(() => {
  if (window.__zenProxyDivider) {
    return;
  }
  window.__zenProxyDivider = true;

  const PREF_POSITIONS = "extensions.zen-proxy-divider.positions";
  const PREF_STYLE = "extensions.zen-proxy-divider.style";
  const PREF_DIVIDER_ORDER = "extensions.zen-proxy-divider.divider-order";
  const PREF_SECTIONS_ORDER = "extensions.zen-proxy-divider.sections-order";
  const PREF_COLLAPSED = "extensions.zen-proxy-divider.collapsed";
  const DIVIDER_CLASS = "zen-proxy-divider";
  const HEADER_CLASS = "zen-proxy-section-header";
  const ARROW_CLASS = "zen-proxy-arrow";
  const ARROW_ICON_CLASS = "zen-proxy-arrow-icon";
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

  const directBrowserIds = new Set();
  let mutationObserver = null;
  let updateScheduled = false;
  let filterRegistered = false;

  const log = (...args) => console.log("[zen-proxy-divider]", ...args);
  const logError = (...args) => console.error("[zen-proxy-divider]", ...args);

  const stylePrefObserver = {
    observe() {
      scheduleUpdate();
    },
  };

  const proxyFilter = {
    applyFilter(channel, defaultProxyInfo, callback) {
      let result = defaultProxyInfo;
      try {
        if (defaultProxyInfo && directBrowserIds.size) {
          const browserId = browserIdForChannel(channel);
          if (browserId && directBrowserIds.has(browserId)) {
            result = null;
          }
        }
      } catch (e) {}
      callback.onProxyFilterResult(result);
    },
  };

  function browserIdForChannel(channel) {
    const loadInfo = channel.loadInfo;
    if (!loadInfo) {
      return 0;
    }
    let bc = null;
    try {
      bc = loadInfo.browsingContext;
    } catch (e) {}
    if (!bc) {
      try {
        bc = loadInfo.workerAssociatedBrowsingContext;
      } catch (e) {}
    }
    try {
      return bc?.top?.browserId || 0;
    } catch (e) {
      return 0;
    }
  }

  function registerFilter() {
    if (filterRegistered) {
      return;
    }
    const pps = Cc[
      "@mozilla.org/network/protocol-proxy-service;1"
    ].getService(Ci.nsIProtocolProxyService);
    pps.registerChannelFilter(proxyFilter, 1000);
    filterRegistered = true;
  }

  function unregisterFilter() {
    if (!filterRegistered) {
      return;
    }
    try {
      const pps = Cc[
        "@mozilla.org/network/protocol-proxy-service;1"
      ].getService(Ci.nsIProtocolProxyService);
      pps.unregisterChannelFilter(proxyFilter);
    } catch (e) {}
    filterRegistered = false;
  }

  function unpinnedTabs() {
    return gBrowser.tabs.filter(
      (tab) =>
        !tab.pinned &&
        !tab.hasAttribute("zen-essential") &&
        !tab.hasAttribute("zen-empty-tab") &&
        !tab.hasAttribute("zen-glance-tab") &&
        tab.isConnected
    );
  }

  function browserIdForTab(tab) {
    try {
      const browser = tab.linkedBrowser;
      return (
        browser?.browserId ||
        browser?.browsingContext?.browserId ||
        0
      );
    } catch (e) {
      return 0;
    }
  }

  function workspaceKeyFor(container) {
    const section = container.closest?.(
      "[zen-workspace-id], .zen-workspace-tabs-section"
    );
    return (
      section?.getAttribute?.("zen-workspace-id") ||
      section?.id ||
      "default"
    );
  }

  function loadPositions() {
    try {
      const raw = Services.prefs.getStringPref(PREF_POSITIONS, "{}");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePositions() {
    try {
      const positions = loadPositions();
      for (const divider of allDividers()) {
        const container = divider.parentNode;
        if (!container) {
          continue;
        }
        const key = workspaceKeyFor(container);
        let above = 0;
        for (const tab of unpinnedTabs()) {
          if (!container.contains(tab)) {
            continue;
          }
          if (!(divider.compareDocumentPosition(tab) & FOLLOWING)) {
            above++;
          }
        }
        positions[key] = above;
      }
      Services.prefs.setStringPref(PREF_POSITIONS, JSON.stringify(positions));
    } catch (e) {
      logError("failed to save positions", e);
    }
  }

  function allDividers() {
    return [...document.querySelectorAll("." + DIVIDER_CLASS)];
  }

  function allHeaders() {
    return [...document.querySelectorAll("." + HEADER_CLASS)];
  }

  function getStyleMode() {
    try {
      const value = Services.prefs.getStringPref(PREF_STYLE, "divider");
      return value === "sections" ? "sections" : "divider";
    } catch (e) {
      return "divider";
    }
  }

  // true — DIRECT on top, PROXY below (per the order pref of the active mode)
  function isReversed() {
    const pref =
      getStyleMode() === "sections" ? PREF_SECTIONS_ORDER : PREF_DIVIDER_ORDER;
    try {
      return (
        Services.prefs.getStringPref(pref, "proxy-direct") === "direct-proxy"
      );
    } catch (e) {
      return false;
    }
  }

  function topRole() {
    return isReversed() ? "direct" : "proxy";
  }

  function bottomRole() {
    return isReversed() ? "proxy" : "direct";
  }

  function loadCollapsed() {
    try {
      const raw = Services.prefs.getStringPref(PREF_COLLAPSED, "{}");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function isCollapsed(collapsedState, key, section) {
    return !!collapsedState[key]?.[section];
  }

  function toggleCollapsed(container, section) {
    if (!container) {
      return;
    }
    const key = workspaceKeyFor(container);
    const state = loadCollapsed();
    const entry = state[key] || (state[key] = {});
    entry[section] = !entry[section];
    try {
      Services.prefs.setStringPref(PREF_COLLAPSED, JSON.stringify(state));
    } catch (e) {
      logError("failed to save collapsed state", e);
    }
    scheduleUpdate();
  }

  function createArrow() {
    // Icon is drawn in CSS (mask-image), so it renders the same in the
    // expanded and collapsed states and just rotates.
    const arrow = document.createXULElement("hbox");
    arrow.className = ARROW_CLASS;
    return arrow;
  }

  // Static up/down SVG arrow shown next to PROXY/DIRECT in divider-line mode
  function createArrowIcon(direction) {
    const icon = document.createXULElement("hbox");
    icon.className = ARROW_ICON_CLASS;
    icon.setAttribute("direction", direction);
    return icon;
  }

  function createDividerLabel(value) {
    const label = document.createXULElement("label");
    label.className = DIVIDER_CLASS + "-label";
    label.setAttribute("value", value);
    return label;
  }

  function applyDividerStyle(divider) {
    const mode = getStyleMode();
    const reversed = isReversed();
    divider.setAttribute("mode", mode);
    divider.setAttribute(
      "tooltiptext",
      mode === "sections"
        ? reversed
          ? "PROXY section: tabs below go through the proxy, tabs above connect directly. Drag to move the boundary, click to collapse."
          : "DIRECT section: tabs below connect directly, tabs above go through the proxy. Drag to move the boundary, click to collapse."
        : reversed
          ? "Tabs above connect directly, tabs below go through the proxy. Drag to move."
          : "Tabs above go through the proxy, tabs below connect directly. Drag to move."
    );
    // Rebuild children only when mode/order actually changed
    const sig = mode + ":" + (reversed ? "r" : "n");
    if (divider.getAttribute("content-sig") === sig) {
      return;
    }
    divider.setAttribute("content-sig", sig);
    while (divider.firstChild) {
      divider.firstChild.remove();
    }
    if (mode === "sections") {
      divider.appendChild(createArrow());
      divider.appendChild(createDividerLabel(reversed ? "PROXY" : "DIRECT"));
    } else {
      const [top, bottom] = reversed
        ? ["DIRECT", "PROXY"]
        : ["PROXY", "DIRECT"];
      divider.appendChild(createDividerLabel(top));
      divider.appendChild(createArrowIcon("up"));
      divider.appendChild(createDividerLabel("·"));
      divider.appendChild(createDividerLabel(bottom));
      divider.appendChild(createArrowIcon("down"));
    }
  }

  function applyHeaderStyle(header) {
    const reversed = isReversed();
    header.setAttribute(
      "tooltiptext",
      reversed
        ? "DIRECT section: tabs below (down to the PROXY section) connect directly. Click to collapse."
        : "PROXY section: tabs below (down to the DIRECT section) go through the proxy. Click to collapse."
    );
    const label = header.querySelector("." + HEADER_CLASS + "-label");
    label?.setAttribute("value", reversed ? "DIRECT" : "PROXY");
  }

  function createDivider() {
    const divider = document.createXULElement("hbox");
    divider.className = DIVIDER_CLASS;
    applyDividerStyle(divider);
    hookDividerDrag(divider);
    return divider;
  }

  function createSectionHeader() {
    const header = document.createXULElement("hbox");
    header.className = HEADER_CLASS;
    header.appendChild(createArrow());
    const label = document.createXULElement("label");
    label.className = HEADER_CLASS + "-label";
    header.appendChild(label);
    applyHeaderStyle(header);
    header.addEventListener("click", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.stopPropagation();
      toggleCollapsed(header.parentNode, topRole());
    });
    return header;
  }

  function insertDividerAt(divider, tabs, index, container) {
    const clamped = Math.max(0, Math.min(index, tabs.length));
    if (clamped >= tabs.length) {
      tabs[tabs.length - 1].after(divider);
    } else {
      container.insertBefore(divider, tabs[clamped]);
    }
  }

  function ensureDividers() {
    const positions = loadPositions();
    const tabs_ = unpinnedTabs();
    const groups = new Map();
    for (const tab of tabs_) {
      const container = tab.parentNode;
      if (!container) {
        continue;
      }
      if (!groups.has(container)) {
        groups.set(container, []);
      }
      groups.get(container).push(tab);
    }
    for (const stray of allDividers()) {
      if (!tabs_.some((t) => stray.parentNode?.contains(t))) {
        stray.remove();
      }
    }
    for (const [container, tabs] of groups) {
      const existing = container.querySelector(
        ":scope > ." + DIVIDER_CLASS
      );
      if (existing || !tabs.length) {
        if (existing) {
          applyDividerStyle(existing);
        }
        continue;
      }
      const divider = createDivider();
      const key = workspaceKeyFor(container);
      const index = Number.isInteger(positions[key])
        ? positions[key]
        : tabs.length;
      insertDividerAt(divider, tabs, index, container);
    }
    ensureSectionHeaders(groups, tabs_);
  }

  function ensureSectionHeaders(groups, tabs_) {
    const sectionsMode = getStyleMode() === "sections";
    for (const header of allHeaders()) {
      if (
        !sectionsMode ||
        !tabs_.some((t) => header.parentNode?.contains(t))
      ) {
        header.remove();
      }
    }
    if (!sectionsMode) {
      return;
    }
    const collapsedState = loadCollapsed();
    for (const [container, tabs] of groups) {
      if (!tabs.length) {
        continue;
      }
      // The PROXY header goes before the first element of the section:
      // either the first tab, or the DIRECT divider if it sits above all tabs.
      const divider = container.querySelector(":scope > ." + DIVIDER_CLASS);
      let first = tabs[0];
      if (divider && divider.compareDocumentPosition(first) & FOLLOWING) {
        first = divider;
      }
      let header = container.querySelector(":scope > ." + HEADER_CLASS);
      if (!header) {
        header = createSectionHeader();
      }
      if (header.parentNode !== container || header.nextElementSibling !== first) {
        container.insertBefore(header, first);
      }
      applyHeaderStyle(header);
      const key = workspaceKeyFor(container);
      // NOTE: not "collapsed" — that's a built-in XUL attribute that would
      // hide the element itself.
      header.toggleAttribute(
        "zen-section-collapsed",
        isCollapsed(collapsedState, key, topRole())
      );
      divider?.toggleAttribute(
        "zen-section-collapsed",
        isCollapsed(collapsedState, key, bottomRole())
      );
    }
  }

  function hookDividerDrag(divider) {
    divider.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const container = divider.parentNode;
      if (!container) {
        return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const onMove = (ev) => {
        if (!moved) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (dx * dx + dy * dy < 16) {
            return;
          }
          moved = true;
          divider.setAttribute("dragging", "true");
        }
        const tabs = unpinnedTabs().filter((t) => container.contains(t));
        if (!tabs.length) {
          return;
        }
        let placed = false;
        for (const tab of tabs) {
          const rect = tab.getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) {
            if (tab.previousElementSibling !== divider) {
              tab.parentNode.insertBefore(divider, tab);
            }
            placed = true;
            break;
          }
        }
        if (!placed) {
          const last = tabs[tabs.length - 1];
          if (divider.previousElementSibling !== last) {
            last.after(divider);
          }
        }
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        divider.removeAttribute("dragging");
        if (moved) {
          savePositions();
          recompute();
        } else if (getStyleMode() === "sections") {
          toggleCollapsed(container, bottomRole());
        }
      };

      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    });
  }

  let lastDragInfo = null;
  let pendingPlacement = null;
  let dndDraggedTabs = null;

  function moveTabNextTo(tab, anchor, before) {
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

  function filterMovableTabs(tabs) {
    return tabs.filter(
      (t) =>
        t &&
        !t.pinned &&
        !t.hasAttribute("zen-essential") &&
        gBrowser.tabs.includes(t)
    );
  }

  function draggedTabsFromEvent(event) {
    let tab = null;
    try {
      if (!event.dataTransfer?.types?.includes(TAB_DROP_TYPE)) {
        return [];
      }
      tab = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);
    } catch (e) {
      return [];
    }
    if (!tab || !gBrowser.tabs.includes(tab)) {
      return [];
    }
    return filterMovableTabs(
      tab.multiselected ? gBrowser.selectedTabs : [tab]
    );
  }

  function tabFromEventTarget(target) {
    const el =
      target && target.nodeType === Node.ELEMENT_NODE
        ? target
        : target?.parentElement;
    return el?.closest?.("tab.tabbrowser-tab") || null;
  }

  function tabsFromDragEndTarget(event) {
    const tab = tabFromEventTarget(event.target);
    if (!tab) {
      return [];
    }
    return filterMovableTabs(
      tab.multiselected ? gBrowser.selectedTabs : [tab]
    );
  }

  function computePlacement(clientX, clientY, tabs) {
    for (const divider of allDividers()) {
      const rect = divider.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        continue;
      }
      if (clientX < rect.left - 8 || clientX > rect.right + 8) {
        return null;
      }
      const placeBelow = clientY > rect.top + rect.height / 2;
      return { divider, tabs, placeBelow };
    }
    return null;
  }

  function handleDragStart(event) {
    const tabEl = tabFromEventTarget(event.target);
    if (tabEl) {
      dndDraggedTabs = tabEl.multiselected
        ? [...gBrowser.selectedTabs]
        : [tabEl];
      log(
        "dragstart tab:",
        (tabEl.getAttribute("label") || "").slice(0, 40),
        "| pinned:",
        !!tabEl.pinned,
        "| essential:",
        tabEl.hasAttribute("zen-essential"),
        "| inTabs:",
        gBrowser.tabs.includes(tabEl),
        "| multi:",
        !!tabEl.multiselected
      );
    } else {
      dndDraggedTabs = null;
      const t = event.target;
      log(
        "dragstart on non-tab element:",
        t?.localName || String(t),
        t?.id || "(no id)",
        t?.className || "(no class)"
      );
    }
  }

  function placementWouldMove({ divider, tabs, placeBelow }) {
    if (!divider.isConnected) {
      return false;
    }
    const container = divider.parentNode;
    return filterMovableTabs(tabs.filter((t) => t.isConnected)).some(
      (t) =>
        !container.contains(t) ||
        !!(divider.compareDocumentPosition(t) & FOLLOWING) !== placeBelow
    );
  }

  function updateDropHint(placement) {
    for (const divider of allDividers()) {
      if (placement && divider === placement.divider) {
        divider.setAttribute(
          "drop-side",
          placement.placeBelow ? "below" : "above"
        );
      } else {
        divider.removeAttribute("drop-side");
      }
    }
  }

  function handleContainerDragover(event) {
    if (!lastDragInfo || Date.now() - lastDragInfo.time > 1000) {
      log("drag session tracked at", event.clientX, event.clientY);
    }
    lastDragInfo = {
      clientX: event.clientX,
      clientY: event.clientY,
      time: Date.now(),
    };
    if (dndDraggedTabs?.length) {
      const placement = computePlacement(
        event.clientX,
        event.clientY,
        dndDraggedTabs
      );
      updateDropHint(
        placement && placementWouldMove(placement) ? placement : null
      );
    }
    try {
      if (event.dataTransfer?.types?.includes(TAB_DROP_TYPE)) {
        event.preventDefault();
      }
    } catch (e) {}
  }

  function handleContainerDrop(event) {
    const tabs = draggedTabsFromEvent(event);
    if (!tabs.length) {
      return;
    }
    const placement = computePlacement(event.clientX, event.clientY, tabs);
    if (placement) {
      pendingPlacement = placement;
      log(
        "drop recorded:",
        placement.placeBelow ? "below" : "above",
        "divider"
      );
    }
  }

  function handleDragEnd(event) {
    updateDropHint(null);
    mouseDrag = null;
    const draggedAtStart = dndDraggedTabs;
    dndDraggedTabs = null;
    let cancelled = false;
    try {
      cancelled = !!event.dataTransfer?.mozUserCancelled;
    } catch (e) {}
    const dragInfo = lastDragInfo;
    lastDragInfo = null;
    if (cancelled) {
      pendingPlacement = null;
      return;
    }
    if (!pendingPlacement) {
      let tabs = draggedTabsFromEvent(event);
      if (!tabs.length) {
        tabs = tabsFromDragEndTarget(event);
      }
      if (!tabs.length && draggedAtStart) {
        tabs = draggedAtStart.filter((t) => t.isConnected);
      }
      if (tabs.length) {
        const point =
          dragInfo && Date.now() - dragInfo.time < 2000 ? dragInfo : event;
        pendingPlacement = computePlacement(point.clientX, point.clientY, tabs);
        log(
          "dragend:",
          pendingPlacement
            ? (pendingPlacement.placeBelow ? "below" : "above") + " divider"
            : "outside sidebar column",
          "at",
          point.clientX,
          point.clientY
        );
      } else if (dragInfo) {
        let types = [];
        try {
          types = [...(event.dataTransfer?.types || [])];
        } catch (e) {}
        log(
          "dragend: no dragged tabs identified; target:",
          event.target?.localName || String(event.target),
          "types:",
          types.join(", ") || "(none)"
        );
      }
    }
    if (pendingPlacement) {
      setTimeout(applyPendingPlacement, 0);
    }
  }

  let mouseDrag = null;

  function handleMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    const tabEl = tabFromEventTarget(event.target);
    if (!tabEl) {
      return;
    }
    const tabs = filterMovableTabs(
      tabEl.multiselected ? gBrowser.selectedTabs : [tabEl]
    );
    if (!tabs.length) {
      return;
    }
    mouseDrag = {
      tabs,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  function handleMouseMove(event) {
    if (!mouseDrag) {
      return;
    }
    if (!mouseDrag.moved) {
      const dx = event.clientX - mouseDrag.startX;
      const dy = event.clientY - mouseDrag.startY;
      if (dx * dx + dy * dy < 25) {
        return;
      }
      mouseDrag.moved = true;
    }
    const placement = computePlacement(
      event.clientX,
      event.clientY,
      mouseDrag.tabs
    );
    updateDropHint(
      placement && placementWouldMove(placement) ? placement : null
    );
  }

  function handleMouseUp(event) {
    const drag = mouseDrag;
    mouseDrag = null;
    if (!drag || !drag.moved) {
      return;
    }
    updateDropHint(null);
    const placement = computePlacement(event.clientX, event.clientY, drag.tabs);
    log(
      `${event.type} drag ended:`,
      placement
        ? (placement.placeBelow ? "below" : "above") + " divider"
        : "outside sidebar column",
      "at",
      event.clientX,
      event.clientY
    );
    if (!placement) {
      return;
    }
    pendingPlacement = placement;
    setTimeout(applyPendingPlacement, 0);
  }

  function applyPendingPlacement() {
    const placement = pendingPlacement;
    pendingPlacement = null;
    if (!placement) {
      return;
    }
    applyPlacement(placement);
    setTimeout(() => {
      if (!placementHolds(placement)) {
        log("placement was overridden — re-applying once");
        applyPlacement(placement);
      }
    }, 300);
  }

  function placementHolds({ divider, tabs, placeBelow }) {
    if (!divider.isConnected) {
      return false;
    }
    return tabs.every((tab) => {
      if (!tab.isConnected) {
        return true;
      }
      if (!divider.parentNode?.contains(tab)) {
        return false;
      }
      const below = !!(divider.compareDocumentPosition(tab) & FOLLOWING);
      return below === placeBelow;
    });
  }

  function applyPlacement(placement) {
    const { divider, placeBelow } = placement;
    if (!divider.isConnected) {
      return;
    }
    const tabs = filterMovableTabs(
      placement.tabs.filter((t) => t.isConnected)
    );
    if (!tabs.length) {
      return;
    }
    const container = divider.parentNode;
    if (!placementWouldMove(placement)) {
      return;
    }
    const local = unpinnedTabs().filter(
      (t) => container.contains(t) && !tabs.includes(t)
    );
    const belowTabs = local.filter(
      (t) => divider.compareDocumentPosition(t) & FOLLOWING
    );
    const aboveTabs = local.filter((t) => !belowTabs.includes(t));
    const lastAbove = aboveTabs[aboveTabs.length - 1] || null;
    const firstBelow = belowTabs[0] || null;
    if (!lastAbove && !firstBelow && !container.contains(tabs[0])) {
      return;
    }

    let anchor = lastAbove;
    for (const tab of tabs) {
      if (anchor) {
        moveTabNextTo(tab, anchor, false);
      } else if (firstBelow) {
        moveTabNextTo(tab, firstBelow, true);
      }
      anchor = tab;
    }

    if (placeBelow) {
      tabs[0].before(divider);
    } else {
      tabs[tabs.length - 1].after(divider);
    }
    log("placement applied:", placeBelow ? "below" : "above");
    scheduleUpdate();
  }

  function recompute() {
    const prevSize = directBrowserIds.size;
    directBrowserIds.clear();
    const dividers = allDividers();
    const collapsedState = loadCollapsed();
    const sectionsMode = getStyleMode() === "sections";
    const reversed = isReversed();
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
      if (direct) {
        tab.setAttribute("zen-proxy-direct", "true");
        const browserId = browserIdForTab(tab);
        if (browserId) {
          directBrowserIds.add(browserId);
        }
      } else {
        tab.removeAttribute("zen-proxy-direct");
      }
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
      if (tab.pinned || tab.hasAttribute("zen-essential")) {
        tab.removeAttribute("zen-proxy-direct");
        tab.removeAttribute("zen-proxy-hidden");
      }
    }
    if (directBrowserIds.size !== prevSize) {
      log(directBrowserIds.size, "direct tab(s)");
    }
  }

  function scheduleUpdate() {
    if (updateScheduled) {
      return;
    }
    updateScheduled = true;
    setTimeout(() => {
      updateScheduled = false;
      try {
        ensureDividers();
        savePositions();
        recompute();
      } catch (e) {
        logError("update failed", e);
      }
    }, 50);
  }

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
    mutationObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((m) =>
        [...m.addedNodes, ...m.removedNodes].some(
          (n) =>
            !(
              n.classList?.contains?.(DIVIDER_CLASS) ||
              n.classList?.contains?.(HEADER_CLASS)
            )
        )
      );
      if (relevant) {
        scheduleUpdate();
      }
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
    });
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
    for (const pref of [PREF_STYLE, PREF_DIVIDER_ORDER, PREF_SECTIONS_ORDER]) {
      Services.prefs.addObserver(pref, stylePrefObserver);
    }
    window.addEventListener("unload", teardown, { once: true });
  }

  function teardown() {
    unregisterFilter();
    for (const pref of [PREF_STYLE, PREF_DIVIDER_ORDER, PREF_SECTIONS_ORDER]) {
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
    directBrowserIds.clear();
  }

  function init() {
    if (!window.gBrowser?.tabContainer) {
      setTimeout(init, 500);
      return;
    }
    try {
      registerFilter();
      addListeners();
      ensureDividers();
      recompute();
      log(
        "initialized (v0.5.0, style:",
        getStyleMode() + ");",
        directBrowserIds.size,
        "direct tab(s)"
      );
    } catch (e) {
      logError("init failed", e);
    }
  }

  if (gBrowserInit?.delayedStartupFinished) {
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
})();
