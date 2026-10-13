// Improve this mod's Sine dialog while preserving native preference controls
// and their save handlers. Includes the native accent color picker.
(() => {
  const selector = "#extensions-zen-proxy-divider-accent-color input";
  const prefix = "extensions-zen-proxy-divider-";
  const html = (tag, className, text) => {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const style = html("style");
  style.textContent = `
    dialog.zen-proxy-settings {
      width: min(720px, calc(100vw - 32px)) !important;
      min-width: 0 !important;
      max-width: none;
      max-height: calc(100vh - 32px);
      padding: 22px !important;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
      border-radius: 14px;
      overflow: auto;
      scrollbar-width: thin;
    }
    .zen-proxy-settings .sineItemPreferenceDialogTopBar {
      position: sticky;
      top: -22px;
      z-index: 1;
      padding: 0 0 14px;
      margin-bottom: 16px;
      background: var(--zen-proxy-settings-background, #1c1b22);
      border-bottom: 0;
    }
    .zen-proxy-settings .sineItemTitle { margin: 0; font-size: 16px; }
    .zen-proxy-settings .sineItemPreferenceDialogTopBar button {
      border-radius: 7px;
      min-width: 70px;
    }
    .zen-proxy-settings .sineItemPreferenceDialogContent {
      display: grid;
      gap: 16px;
      width: 100%;
      min-width: 0;
      max-width: none;
    }
    .zen-proxy-settings-section {
      display: block;
      box-sizing: border-box;
      min-width: 0;
      padding: 12px 16px 4px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, currentColor 9%, transparent);
      background: color-mix(in srgb, currentColor 2%, transparent);
    }
    .zen-proxy-settings-section h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
    .zen-proxy-settings .zen-proxy-setting-row {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 6px 0;
      margin: 0;
      min-width: 0;
    }
    .zen-proxy-setting-copy { flex: 1; min-width: 0; }
    .zen-proxy-settings .sineItemPreferenceLabel {
      display: block;
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
    }
    .zen-proxy-setting-description {
      font-size: 12px;
      line-height: 1.4;
      margin-top: 3px;
      color: color-mix(in srgb, currentColor 65%, transparent);
    }
    .zen-proxy-settings .zen-proxy-setting-row menulist {
      box-sizing: border-box;
      width: 190px;
      min-width: 190px;
      margin: 0;
      border-radius: 7px;
      font-size: 13px;
      padding: 7px 10px;
      flex: none;
    }
    .zen-proxy-route-help {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 5px 12px;
      padding: 10px 0;
      margin-top: 2px;
      font-size: 12px;
      line-height: 1.4;
    }
    .zen-proxy-route-help span { color: color-mix(in srgb, currentColor 65%, transparent); }
    .zen-proxy-color-control {
      width: 190px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex: none;
    }
    .zen-proxy-color-control input {
      appearance: none;
      width: 40px;
      height: 30px;
      padding: 2px;
      margin: 0;
      border-radius: 6px;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent) !important;
      cursor: pointer;
    }
    .zen-proxy-color-control output { font: 12px ui-monospace, monospace; opacity: 0.75; }
    .zen-proxy-settings .sineItemPreferenceCheckbox {
      margin-top: 4px;
      padding: 10px 0;
      cursor: pointer;
    }
    .zen-proxy-settings .sineItemPreferenceCheckbox checkbox {
      order: 1;
      margin: 0;
    }
    @media (max-width: 550px) {
      dialog.zen-proxy-settings { padding: 16px !important; }
      .zen-proxy-settings-section { padding: 12px 12px 4px; }
      .zen-proxy-settings .zen-proxy-setting-row { gap: 10px; }
      .zen-proxy-settings .zen-proxy-setting-row menulist { width: 155px; min-width: 155px; }
      .zen-proxy-color-control { width: 155px; }
    }
  `;
  document.documentElement.append(style);

  const improveDialog = (input) => {
    const dialog = input.closest("dialog");
    if (!dialog || dialog.classList.contains("zen-proxy-settings")) return;
    const keys = ["external-route", "new-tab-side", "link-route", "reload-on-switch",
      "style", "divider-order", "sections-order", "indicator-position", "indicator-color", "accent-color"];
    const rows = Object.fromEntries(keys.map(key => [key, dialog.querySelector(`#${prefix}${key}`)]));
    if (Object.values(rows).some(row => !row)) return;
    const content = dialog.querySelector(".sineItemPreferenceDialogContent");
    if (!content) return;
    dialog.classList.add("zen-proxy-settings");
    dialog.style.setProperty("--zen-proxy-settings-background", getComputedStyle(dialog).backgroundColor);
    const descriptions = {
      "external-route": "Links from Telegram and other apps.",
      "new-tab-side": "Ctrl+T and the New Tab button.",
      "link-route": "Links opened in a new tab from a page.",
      "reload-on-switch": "Reload the page when moved between Proxy and Direct.",
    };
    for (const [key, row] of Object.entries(rows)) {
      row.classList.add("zen-proxy-setting-row");
      row.removeAttribute("tooltiptext");
      const label = row.querySelector(".sineItemPreferenceLabel");
      const copy = html("div", "zen-proxy-setting-copy");
      label.id = `${row.id}-label`;
      row.insertBefore(copy, label);
      copy.append(label);
      const control = row.querySelector("menulist, input, checkbox");
      control?.setAttribute("aria-labelledby", label.id);
      if (descriptions[key]) {
        const description = html("div", "zen-proxy-setting-description", descriptions[key]);
        description.id = `${row.id}-description`;
        copy.append(description);
        control?.setAttribute("aria-describedby", description.id);
      }
    }
    const routing = html("section", "zen-proxy-settings-section");
    routing.append(html("h4", null, "Opening tabs"));
    for (const key of ["external-route", "new-tab-side", "link-route"]) routing.append(rows[key]);
    const help = html("div", "zen-proxy-route-help");
    help.append(html("strong", null, "Manual"), html("span", null, "Wait in Unsorted without loading."),
      html("strong", null, "Inherit"), html("span", null, "Use the source tab’s route."));
    routing.append(help, rows["reload-on-switch"]);
    const appearance = html("section", "zen-proxy-settings-section");
    appearance.append(html("h4", null, "Appearance"));
    for (const key of ["style", "divider-order", "sections-order", "indicator-position", "indicator-color", "accent-color"])
      appearance.append(rows[key]);
    content.append(routing, appearance);
    const colorControl = html("div", "zen-proxy-color-control");
    const colorValue = html("output", null, input.value.toUpperCase());
    rows["accent-color"].append(colorControl);
    colorControl.append(input, colorValue);
    const updateColor = () => { colorValue.textContent = input.value.toUpperCase(); };
    input.addEventListener("input", updateColor);
    input.addEventListener("change", updateColor);
    const updateOrder = () => {
      const sections = rows.style.querySelector("menulist").getAttribute("value") === "sections";
      rows["divider-order"].style.display = sections ? "none" : "flex";
      rows["sections-order"].style.display = sections ? "flex" : "none";
    };
    rows.style.addEventListener("command", updateOrder);
    updateOrder();
  };

  const upgrade = () => {
    const input = document.querySelector(selector);
    if (!input) {
      return;
    }
    if (input.type !== "color") {
      const value = input.value.trim();
      const color = /^#[0-9a-f]{3}$/i.test(value)
        ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}`
        : /^#[0-9a-f]{6}$/i.test(value)
          ? value
          : "#55d8be";
      input.type = "color";
      input.value = color;
      input.setAttribute("aria-label", "Accent color");
    }
    improveDialog(input);
  };

  upgrade();
  new MutationObserver(upgrade).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
