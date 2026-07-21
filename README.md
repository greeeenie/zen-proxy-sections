# Zen Proxy Divider

A [Zen Browser](https://zen-browser.app) mod that splits your sidebar into a
**PROXY** and a **DIRECT** zone. Tabs in the proxy zone route traffic through
the proxy configured in the browser; tabs in the direct zone bypass it.
Proxied tabs show a small green dot.

## Install

Requires [Sine](https://github.com/CosmoCreeper/Sine): Zen settings → Sine →
**Install from repository** → paste this repo URL → restart Zen.

## Usage

- Configure a proxy in the browser first (Settings → General → Proxy).
- Drag the `PROXY ↑ · DIRECT ↓` line to move the boundary; drag tabs across
  it to change their mode.
- Pinned tabs and Essentials: right-click → **Use Proxy** (off by default).
- New tabs open on the side picked in settings; tabs opened from another tab
  (links, `target="_blank"`) inherit that tab's side.
- **Alt+Enter** in the URL bar sends the new tab to the opposite of the
  default side.
- A tab that switches sides reloads automatically so the new route applies
  right away (can be turned off in settings).

## Settings (Sine → Zen Proxy Divider)

| Setting | Options |
|---|---|
| Visual style | divider line / collapsible section headers |
| Order (per style) | PROXY·DIRECT / DIRECT·PROXY |
| Proxy indicator | end of row / on favicon; green / gray |
| New tabs: default side | proxy / direct |
| Reload a tab when it switches sides | on / off |

## Notes

- Only tab-bound traffic is affected; background browser requests follow the
  browser default (proxy).
- Divider position, collapsed state, and all settings persist per workspace
  across restarts.
