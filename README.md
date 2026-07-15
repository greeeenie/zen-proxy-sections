# Zen Proxy Divider

A mod for [Zen Browser](https://zen-browser.app): adds an extra divider to the
sidebar (similar to the separator between pinned and regular tabs).

- **Tabs ABOVE the divider** — traffic goes through the proxy configured in the
  browser (Settings → General → Proxy: manual, PAC, or system).
- **Tabs BELOW the divider** — connect directly, bypassing the proxy.
- Pinned tabs, Essentials, and folders are always "above" the divider → proxied.

The divider is draggable with the mouse; its position is saved per workspace
and survives browser restarts.

## Why this is not a regular Zen Mod from the store

Mods from the Zen store are CSS-only: they cannot control network traffic.
This mod ships privileged JS (`zen-proxy-divider.uc.mjs`) that intercepts
proxy resolution via `nsIProtocolProxyService`. That's why it is installed
through **Sine** (a mod manager for Zen) or manually via **fx-autoconfig**.

## Installation

### Option 1 — Sine (recommended)

1. Install [Sine](https://github.com/CosmoCreeper/Sine) (follow their README).
2. Open Zen settings → Sine section → "Install from repository".
3. Paste this repository's URL and install the mod.
4. Restart Zen.

### Option 2 — fx-autoconfig manually

1. Install [fx-autoconfig](https://github.com/MrOtherGuy/fx-autoconfig)
   (copy `config.js` into the program directory, `chrome/` into your profile).
2. Copy `zen-proxy-divider.uc.mjs` into `<profile>/chrome/JS/`.
3. Hook up the styles: add to `<profile>/chrome/userChrome.css`:
   ```css
   @import "zen-proxy-divider/chrome.css";
   ```
   (or copy the contents of `chrome.css` into `userChrome.css`).
4. In `about:support` click "Clear startup cache…" and restart Zen.

## Usage

1. Configure a proxy in the browser itself (without one the mod changes
   nothing — everything already goes direct).
2. A dashed `PROXY ↑ · DIRECT ↓` line appears in the sidebar — drag it with
   the mouse to the desired spot among your regular tabs.
3. Drag tabs above/below the line to change their mode. Tabs without a proxy
   are marked with a small dot on the right.

By default the divider appears **below all existing tabs** (everything goes
through the proxy). New tabs open at the end of the list, i.e. **below** the
divider — without a proxy.

## Appearance: divider line or sections

The mod has two visual styles:

- **Divider line** (default) — a single dashed `PROXY ↑ · DIRECT ↓` line.
- **Section headers** — two section headers: `PROXY ↓` above the proxied tabs
  and `DIRECT ↓` above the direct ones. The `DIRECT ↓` header is the same
  boundary: it can be dragged; `PROXY ↓` is static.

Switch it in the mod settings (Sine → Zen Proxy Divider preferences) or
manually via the `extensions.zen-proxy-divider.style` pref
(`divider` / `sections`) in `about:config` — it applies on the fly, no
restart needed.

## Limitations and notes

- Applies only to traffic bound to a tab. Background browser requests
  (updates, telemetry, extension requests without a tab) follow the proxy —
  i.e. the browser default.
- Already open connections do not switch instantly: after dragging a tab
  across the divider, reload it (F5) to guarantee the new mode applies.
- Split View / Glance: a glance has its own container — its traffic follows
  the default (through the proxy).
- DNS: for SOCKS the "Proxy DNS when using SOCKS" setting is respected as
  usual, since the mod does not replace the proxy — it only disables it for
  the tabs below.
- The divider position is stored in the
  `extensions.zen-proxy-divider.positions` pref (JSON, keyed by workspace id).

## Files

| File | Purpose |
|---|---|
| `zen-proxy-divider.uc.mjs` | Logic: divider + per-tab proxy filter |
| `chrome.css` | Styles for the divider and the "no proxy" marker |
| `theme.json` | Mod metadata for Sine |
| `preferences.json` | Mod settings (visual style switcher) |
