// "Use Proxy" checkbox in the tab context menu — manual proxy toggle for
// pinned/Essentials tabs (regular tabs are controlled by the divider).

import {
  MENU_ITEM_ID,
  manualProxyFlag,
  setManualProxyFlag,
} from "./prefs.mjs";
import { isManualTab } from "./tabs.mjs";
import { scheduleUpdate } from "./update.mjs";

function contextMenuTabs() {
  const tab = window.TabContextMenu?.contextTab;
  if (!tab) {
    return [];
  }
  const tabs = tab.multiselected ? gBrowser.selectedTabs : [tab];
  return tabs.filter((t) => isManualTab(t));
}

function handleContextMenuShowing(event) {
  const menu = event.currentTarget;
  if (event.target !== menu) {
    return;
  }
  const item = menu.querySelector("#" + MENU_ITEM_ID);
  if (!item) {
    return;
  }
  const tabs = contextMenuTabs();
  item.hidden = !tabs.length;
  if (tabs.length && tabs.every((t) => manualProxyFlag(t))) {
    item.setAttribute("checked", "true");
  } else {
    item.removeAttribute("checked");
  }
}

export function setupContextMenu() {
  const menu = document.getElementById("tabContextMenu");
  if (!menu || menu.querySelector("#" + MENU_ITEM_ID)) {
    return;
  }
  const item = document.createXULElement("menuitem");
  item.id = MENU_ITEM_ID;
  item.setAttribute("type", "checkbox");
  item.setAttribute("label", "Use Proxy");
  item.setAttribute(
    "tooltiptext",
    "Route this tab's traffic through the browser proxy"
  );
  item.addEventListener("command", () => {
    const tabs = contextMenuTabs();
    if (!tabs.length) {
      return;
    }
    const on = !tabs.every((t) => manualProxyFlag(t));
    for (const tab of tabs) {
      setManualProxyFlag(tab, on);
    }
    scheduleUpdate();
  });
  menu.appendChild(item);
  menu.addEventListener("popupshowing", handleContextMenuShowing);
}

export function removeContextMenu() {
  const menu = document.getElementById("tabContextMenu");
  if (!menu) {
    return;
  }
  menu.removeEventListener("popupshowing", handleContextMenuShowing);
  menu.querySelector("#" + MENU_ITEM_ID)?.remove();
}
