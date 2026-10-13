# Zen Proxy Divider

A [Zen Browser](https://zen-browser.app) mod that splits your sidebar into a
**PROXY** and a **DIRECT** zone. Tabs in the proxy zone route traffic through
the proxy configured in the browser; tabs in the direct zone bypass it.
Proxied tabs show a green indicator.

## Install

Requires [Sine](https://github.com/CosmoCreeper/Sine): Zen settings → Sine →
**Install from repository** → paste this repo URL → restart Zen.

## Usage

- Configure a proxy in the browser first (Settings → General → Proxy).
- Drag the `PROXY ↑ / DIRECT ↓` capsule to move the boundary; drag tabs across
  it to change their mode.
- Pinned tabs and Essentials: right-click → **Use Proxy** (off by default).
- Each source has its own route setting: external apps, fresh tabs (Ctrl+T),
  and tabs opened from existing tabs (links, `target="_blank"`, middle-click).
  **Inherit** follows the source tab's side, including pinned tabs and Essentials.
  **Proxy** and **Direct** choose the route before the first request.
- **Manual** sends a URL to **Unsorted** below New Tab
  and above the normal tabs in the sidebar.
  They stay as URL cards without loading pages or site favicons. Drag a card
  into the PROXY/DIRECT section to create a tab and start its first load
  through that route. The insertion line previews the exact destination.
  Incoming cards use Zen's native insertion indicator while dragging.
  Selecting the card does not load it. Ordinary incoming links
  can be removed with the close icon on the right. They
  persist across restarts and appear in every workspace. Private-window
  incoming links stay in that private window's memory only.
  For Ctrl+T, enter an address normally; Manual queues it without loading it.
  By default external apps use Manual, fresh tabs use Proxy, and links use Inherit.
- **Alt+Enter** in the URL bar sends the new tab to the opposite of the
  default side.
- A tab that switches sides reloads automatically so the new route applies
  right away (can be turned off in settings).

## Settings (Sine → Zen Proxy Divider)

The dialog groups settings into **Opening tabs** and **Appearance**, explains
Manual/Inherit, and shows only the order control for the selected sidebar style.
The native color picker includes its current HEX value. Settings save immediately.

| Setting | Options |
|---|---|
| Visual style | capsule divider / collapsible section headers |
| Order (per style) | PROXY·DIRECT / DIRECT·PROXY |
| Proxy indicator | left edge / end of row / on favicon; green / gray |
| Accent color | Pick any color in the Sine settings; applies to PROXY and the green indicator mode |
| Links opened from outside Zen | Proxy / Direct / Manual (Unsorted) |
| New tabs (Ctrl+T) | Proxy / Direct / Manual (Unsorted) |
| Tabs opened from an existing tab | Proxy / Direct / Inherit / Manual (Unsorted) |
| Reload a tab when it switches sides | on / off |

## Notes

- Only tab-bound traffic is affected; background browser requests follow the
  browser default (proxy).
- Divider position, collapsed state, and all settings persist per workspace
  across restarts.
