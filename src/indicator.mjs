// The dot indicator on proxied tabs.

import { DOT_CLASS, getIndicatorColor } from "./prefs.mjs";

// Geometry is set inline: Zen's tab internals use grid layouts that break
// flow-positioned pseudo-elements, so the dot is a real element with
// absolute inline positioning. Color comes from chrome.css variables.
function positionDot(dot, tab, mode) {
  const s = dot.style;
  s.position = "absolute";
  s.width = "5px";
  s.height = "5px";
  s.borderRadius = "50%";
  s.pointerEvents = "none";
  s.zIndex = "1";
  s.top = "";
  s.bottom = "";
  s.transform = "";
  if (mode === "favicon") {
    // List tabs have an icon container wider than the favicon itself,
    // so the badge needs a nudge left to land on the icon corner.
    s.insetInlineEnd = tab.hasAttribute("zen-essential") ? "-2px" : "8px";
    s.bottom = "-2px";
  } else if (tab.hasAttribute("zen-essential")) {
    s.insetInlineEnd = "4px";
    s.top = "4px";
  } else {
    s.insetInlineEnd = "6px";
    s.top = "50%";
    s.transform = "translateY(-50%)";
  }
}

export function updateDot(tab, proxyOn, mode) {
  let dot = tab.querySelector("." + DOT_CLASS);
  if (!proxyOn) {
    dot?.remove();
    return;
  }
  const content = tab.querySelector(".tab-content");
  if (!content) {
    return;
  }
  let anchor = content;
  if (mode === "favicon") {
    anchor = tab.querySelector(".tab-icon-stack") || content;
  }
  if (!dot) {
    dot = document.createXULElement("hbox");
    dot.className = DOT_CLASS;
  }
  if (dot.parentNode !== anchor) {
    anchor.appendChild(dot);
  }
  try {
    if (getComputedStyle(anchor).position === "static") {
      anchor.style.position = "relative";
    }
  } catch (e) {}
  positionDot(dot, tab, mode);
}

// Indicator color is CSS-driven via an attribute on the root element;
// position is applied per-dot in positionDot().
export function applyIndicatorAttrs() {
  const root = document.documentElement;
  if (getIndicatorColor() === "gray") {
    root.setAttribute("zen-proxy-indicator-color", "gray");
  } else {
    root.removeAttribute("zen-proxy-indicator-color");
  }
}
