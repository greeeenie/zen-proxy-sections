// The divider element, section headers, their styling, dragging with the
// mouse, and position/collapse persistence.

import {
  DIVIDER_CLASS,
  HEADER_CLASS,
  ARROW_CLASS,
  ARROW_ICON_CLASS,
  FOLLOWING,
  PREF_POSITIONS,
  PREF_COLLAPSED,
  getStyleMode,
  isReversed,
  topRole,
  bottomRole,
  loadPositions,
  loadCollapsed,
  isCollapsed,
  logError,
} from "./prefs.mjs";
import { unpinnedTabs, workspaceKeyFor } from "./tabs.mjs";
import { scheduleUpdate, recompute } from "./update.mjs";

export function allDividers() {
  return [...document.querySelectorAll("." + DIVIDER_CLASS)];
}

export function allHeaders() {
  return [...document.querySelectorAll("." + HEADER_CLASS)];
}

export function savePositions() {
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

export function ensureDividers() {
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
