// Constants, preference getters, and persisted state helpers.

export const PREF_POSITIONS = "extensions.zen-proxy-divider.positions";
export const PREF_STYLE = "extensions.zen-proxy-divider.style";
export const PREF_DIVIDER_ORDER = "extensions.zen-proxy-divider.divider-order";
export const PREF_SECTIONS_ORDER =
  "extensions.zen-proxy-divider.sections-order";
export const PREF_COLLAPSED = "extensions.zen-proxy-divider.collapsed";
export const PREF_INDICATOR_POS =
  "extensions.zen-proxy-divider.indicator-position";
export const PREF_INDICATOR_COLOR =
  "extensions.zen-proxy-divider.indicator-color";
export const PREF_NEW_TAB_SIDE = "extensions.zen-proxy-divider.new-tab-side";
export const PREF_RELOAD_ON_SWITCH =
  "extensions.zen-proxy-divider.reload-on-switch";
export const SS_PROXY_KEY = "zen-proxy-divider-proxy";
export const MENU_ITEM_ID = "zen-proxy-divider-menuitem";
export const DIVIDER_CLASS = "zen-proxy-divider";
export const HEADER_CLASS = "zen-proxy-section-header";
export const DOT_CLASS = "zen-proxy-dot";
export const ARROW_CLASS = "zen-proxy-arrow";
export const ARROW_ICON_CLASS = "zen-proxy-arrow-icon";
export const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
export const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";

export const log = (...args) => console.log("[zen-proxy-divider]", ...args);
export const logError = (...args) =>
  console.error("[zen-proxy-divider]", ...args);

export function getStyleMode() {
  try {
    const value = Services.prefs.getStringPref(PREF_STYLE, "divider");
    return value === "sections" ? "sections" : "divider";
  } catch (e) {
    return "divider";
  }
}

// true — DIRECT on top, PROXY below (per the order pref of the active mode)
export function isReversed() {
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

export function topRole() {
  return isReversed() ? "direct" : "proxy";
}

export function bottomRole() {
  return isReversed() ? "proxy" : "direct";
}

export function newTabsGoDirect() {
  try {
    return (
      Services.prefs.getStringPref(PREF_NEW_TAB_SIDE, "proxy") === "direct"
    );
  } catch (e) {
    return false;
  }
}

export function getIndicatorPos() {
  try {
    return Services.prefs.getStringPref(PREF_INDICATOR_POS, "row") ===
      "favicon"
      ? "favicon"
      : "row";
  } catch (e) {
    return "row";
  }
}

export function getIndicatorColor() {
  try {
    return Services.prefs.getStringPref(PREF_INDICATOR_COLOR, "green");
  } catch (e) {
    return "green";
  }
}

export function reloadOnSwitch() {
  try {
    return Services.prefs.getBoolPref(PREF_RELOAD_ON_SWITCH, true);
  } catch (e) {
    return true;
  }
}

export function loadPositions() {
  try {
    const raw = Services.prefs.getStringPref(PREF_POSITIONS, "{}");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function loadCollapsed() {
  try {
    const raw = Services.prefs.getStringPref(PREF_COLLAPSED, "{}");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

export function isCollapsed(collapsedState, key, section) {
  return !!collapsedState[key]?.[section];
}

// Manual proxy flag for pinned/Essentials tabs, persisted in the session
// store so it survives restarts.
export function manualProxyFlag(tab) {
  try {
    return SessionStore.getCustomTabValue(tab, SS_PROXY_KEY) === "true";
  } catch (e) {
    return false;
  }
}

export function setManualProxyFlag(tab, on) {
  try {
    if (on) {
      SessionStore.setCustomTabValue(tab, SS_PROXY_KEY, "true");
    } else {
      SessionStore.deleteCustomTabValue(tab, SS_PROXY_KEY);
    }
  } catch (e) {
    logError("failed to persist proxy flag", e);
  }
}
