"""Check the real Sine dialog and its save handlers in the isolated profile."""

import base64
import time


def run(driver, profile, wait_for):
    driver.command("Marionette:SetContext", {"value": "content"})
    before = driver.command("WebDriver:GetWindowHandles", {})
    before = before.get("value", before) if isinstance(before, dict) else before
    driver.command("Marionette:SetContext", {"value": "chrome"})
    driver.js("gBrowser.selectedTab = gBrowser.addTrustedTab('about:preferences#sineMods'); return true;")
    driver.command("Marionette:SetContext", {"value": "content"})
    handles = driver.command("WebDriver:GetWindowHandles", {})
    handles = handles.get("value", handles) if isinstance(handles, dict) else handles
    handle = next(h for h in handles if h not in before)
    driver.command("WebDriver:SwitchToWindow", {"handle": handle})
    try:
        wait_for(lambda: driver.js("return !!document.querySelector('dialog.zen-proxy-settings');"), "Improved Sine dialog did not initialize")
    except Exception:
        print(driver.js("return { url: location.href, rows: [...document.querySelectorAll('[id*=zen-proxy-divider]')].map(e => e.id), sine: !!document.querySelector('#category-sine-mods'), styles: document.querySelectorAll('style').length, dialog: document.querySelector('dialog.sineItemPreferenceDialog')?.outerHTML };"), flush=True)
        raise
    driver.js("gotoPref('paneSineMods'); return true;")
    wait_for(lambda: driver.js("return !document.getElementById('sineInstalledGroup').hidden;"), "Sine category did not open")
    driver.js("document.querySelector('dialog.zen-proxy-settings').showModal(); return true;")
    time.sleep(0.4)
    geometry = driver.js("""
      const dialog = document.querySelector('dialog.zen-proxy-settings');
      const rect = dialog.getBoundingClientRect();
      const controls = [...dialog.querySelectorAll('menulist')]
        .filter(e => e.getBoundingClientRect().height > 0).map(e => e.getBoundingClientRect());
      return { width: rect.width, viewport: innerWidth, open: dialog.open,
        display: getComputedStyle(dialog).display, connected: dialog.isConnected,
        parentHidden: dialog.closest('[hidden]')?.id,
        sections: dialog.querySelectorAll('.zen-proxy-settings-section').length,
        widths: controls.map(r => r.width),
        clipped: [...dialog.querySelectorAll('.zen-proxy-settings-section')]
          .some(e => e.getBoundingClientRect().right > rect.right),
        color: dialog.querySelector('input').type,
        divider: getComputedStyle(document.getElementById('extensions-zen-proxy-divider-divider-order')).display,
        headers: getComputedStyle(document.getElementById('extensions-zen-proxy-divider-sections-order')).display };
    """)

    def capture(filename):
        result = driver.command("WebDriver:TakeScreenshot", {"id": None, "full": True})
        result = result.get("value", result) if isinstance(result, dict) else result
        (profile / filename).write_bytes(base64.b64decode(result))

    capture("settings.png")
    assert geometry["width"] > 0 and geometry["width"] <= geometry["viewport"] and geometry["sections"] == 2, geometry
    assert len(set(geometry["widths"])) == 1 and geometry["color"] == "color", geometry
    assert not geometry["clipped"], geometry
    assert geometry["divider"] != "none" and geometry["headers"] == "none", geometry
    driver.js("""
      const list = document.querySelector('#extensions-zen-proxy-divider-style menulist');
      list.value = 'sections'; list.dispatchEvent(new Event('command', { bubbles: true }));
      return true;
    """)
    time.sleep(0.3)
    assert driver.js("""
      return getComputedStyle(document.getElementById('extensions-zen-proxy-divider-divider-order')).display === 'none'
        && getComputedStyle(document.getElementById('extensions-zen-proxy-divider-sections-order')).display !== 'none';
    """), "Style change did not switch the relevant order setting"
    driver.js("""
      const list = document.querySelector('#extensions-zen-proxy-divider-external-route menulist');
      list.value = 'direct'; list.dispatchEvent(new Event('command', { bubbles: true }));
      document.getElementById('extensions-zen-proxy-divider-reload-on-switch').click();
      const input = document.querySelector('#extensions-zen-proxy-divider-accent-color input');
      input.value = '#aabbcc'; input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    """)
    time.sleep(0.3)
    assert driver.js("return document.querySelector('.zen-proxy-color-control output').textContent === '#AABBCC';"), "HEX display did not update"
    driver.command("Marionette:SetContext", {"value": "chrome"})
    saved = driver.js("""
      return { style: Services.prefs.getStringPref('extensions.zen-proxy-divider.style'),
        external: Services.prefs.getStringPref('extensions.zen-proxy-divider.external-route'),
        reload: Services.prefs.getBoolPref('extensions.zen-proxy-divider.reload-on-switch'),
        color: Services.prefs.getStringPref('extensions.zen-proxy-divider.accent-color') };
    """)
    assert saved == {"style": "sections", "external": "direct", "reload": False, "color": "#aabbcc"}, saved
    driver.command("Marionette:SetContext", {"value": "content"})
    driver.js("document.querySelector('dialog.zen-proxy-settings').scrollTop = 1000; return true;")
    capture("settings-appearance.png")
    driver.js("document.querySelector('.zen-proxy-settings .sineItemPreferenceDialogTopBar button').click(); return true;")
    assert driver.js("return !document.querySelector('dialog.zen-proxy-settings').open;"), "Close button stopped working"
    print("PASS Sine settings: layout, conditional order, native saves, color value, Close; screenshots:", profile, flush=True)
