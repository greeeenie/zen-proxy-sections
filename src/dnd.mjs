// Divider-aware tab drag&drop.
//
// Zen commits the final tab position from its own drag bookkeeping when
// the drag ends, and over the empty areas around the divider a drop
// event may not fire at all. So we never fight the native code: while a
// tab drag is in flight we only track the pointer, and once the drag has
// fully finished we re-place the tabs and the divider if native handling
// left them on the wrong side of it. A short follow-up check re-applies
// the placement once if Zen asynchronously overwrote it.
//
// Tab drags run as a real OS drag session, which suppresses pointer and
// mouse events entirely; Zen also stops propagation of drag events, so
// everything is listened to in the capture phase on the window — the one
// spot that cannot be silenced. The pointer/mouse listeners cover
// hypothetical non-DnD drags as a belt-and-braces backup.

import {
  FOLLOWING,
  TAB_DROP_TYPE,
  log,
} from "./prefs.mjs";
import {
  unpinnedTabs,
  filterMovableTabs,
  tabFromEventTarget,
  moveTabNextTo,
} from "./tabs.mjs";
import { allDividers } from "./divider.mjs";
import { scheduleUpdate } from "./update.mjs";

let lastDragInfo = null;
let pendingPlacement = null;
let dndDraggedTabs = null;
let mouseDrag = null;

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

function tabsFromDragEndTarget(event) {
  const tab = tabFromEventTarget(event.target);
  if (!tab) {
    return [];
  }
  return filterMovableTabs(
    tab.multiselected ? gBrowser.selectedTabs : [tab]
  );
}

// Zones are purely geometric relative to the visible divider: the drop
// only has to land in the sidebar column (horizontally aligned with the
// divider). The divider midpoint alone decides the requested side.
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

// dragend's target and dataTransfer proved unreliable in Zen (custom drag
// source, protected-mode dataTransfer), so the dragged tabs are captured
// at dragstart, where the target is by definition the drag source.
export function handleDragStart(event) {
  const tabEl = tabFromEventTarget(event.target);
  if (tabEl) {
    // Record the tabs unfiltered: Zen may toggle attributes on them for
    // the duration of the drag, so movability is judged in
    // applyPlacement(), after the drag has fully finished.
    dndDraggedTabs = tabEl.multiselected
      ? [...gBrowser.selectedTabs]
      : [tabEl];
  } else {
    dndDraggedTabs = null;
  }
}

// True when applying the placement would actually move a tab across the
// divider (used both to skip no-op placements and to drive the drop hint).
export function placementWouldMove({ divider, tabs, placeBelow }) {
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

// Zen's own drop indicator knows nothing about the divider and points at
// the wrong slot when a tab is about to cross it. Glow the divider on
// the side the tab will actually land on instead.
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

export function handleContainerDragover(event) {
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

export function handleContainerDrop(event) {
  const tabs = draggedTabsFromEvent(event);
  if (!tabs.length) {
    return;
  }
  const placement = computePlacement(event.clientX, event.clientY, tabs);
  if (placement) {
    pendingPlacement = placement;
  }
}

export function handleDragEnd(event) {
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
  // No drop event fired (empty zone): reconstruct the intent from the
  // last tracked pointer position, or from dragend's own coordinates.
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
    }
  }
  if (pendingPlacement) {
    // Let every native dragend handler (Zen's commit/cleanup) run first.
    setTimeout(applyPendingPlacement, 0);
  }
}

export function handleMouseDown(event) {
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

export function handleMouseMove(event) {
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

export function handleMouseUp(event) {
  const drag = mouseDrag;
  mouseDrag = null;
  if (!drag || !drag.moved) {
    return;
  }
  updateDropHint(null);
  const placement = computePlacement(event.clientX, event.clientY, drag.tabs);
  if (!placement) {
    return;
  }
  pendingPlacement = placement;
  // Let Zen's own mouseup handlers commit their move first.
  setTimeout(applyPendingPlacement, 0);
}

function applyPendingPlacement() {
  const placement = pendingPlacement;
  pendingPlacement = null;
  if (!placement) {
    return;
  }
  applyPlacement(placement);
  // Zen may re-shuffle tabs asynchronously right after a drag; verify a
  // moment later and re-apply once if the placement got overwritten.
  setTimeout(() => {
    if (!placementHolds(placement)) {
      log("placement was overridden — re-applying once");
      applyPlacement(placement);
    }
  }, 300);
}

export function placementHolds({ divider, tabs, placeBelow }) {
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

export function applyPlacement(placement) {
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
    return; // native drag&drop already left them on the requested side
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
    return; // nowhere to anchor the move
  }

  // Move the dragged tabs to the divider boundary, keeping their order.
  let anchor = lastAbove;
  for (const tab of tabs) {
    if (anchor) {
      moveTabNextTo(tab, anchor, false);
    } else if (firstBelow) {
      moveTabNextTo(tab, firstBelow, true);
    }
    anchor = tab;
  }

  // Finally put the divider on the requested side of the moved block.
  if (placeBelow) {
    tabs[0].before(divider);
  } else {
    tabs[tabs.length - 1].after(divider);
  }
  log("placement applied:", placeBelow ? "below" : "above");
  scheduleUpdate();
}
