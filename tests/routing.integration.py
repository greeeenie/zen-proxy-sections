"""Run routing checks in a separate headless Zen profile with real HTTP traffic.

Requires the locally installed Zen/Sine runtime. Does not touch the user profile.
Run: rtk proxy python tests/routing.integration.py
"""

import http.client
import http.server
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]
ZEN = Path(os.environ.get("ZEN_TEST_BINARY", r"C:\Program Files\Zen Browser\zen.exe"))
SINE = Path(os.environ.get("ZEN_SINE_PROFILE", str(Path(os.environ["APPDATA"]) / "zen/Profiles/etaoff5o.Default (release)")))
requests = []


class Origin(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        route = "proxy" if self.headers.get("X-Routing-Test") else "direct"
        requests.append((self.path, route))
        body = b"<html><title>Routing test</title><body>test</body></html>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Proxy(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.hostname != "127.0.0.1" or url.port != origin.server_port:
            self.send_error(502)
            return
        connection = http.client.HTTPConnection(url.hostname, url.port)
        connection.request("GET", url.path, headers={"X-Routing-Test": "1"})
        response = connection.getresponse()
        body = response.read()
        self.send_response(response.status)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        connection.close()

    def do_CONNECT(self):
        self.send_error(502)

    def log_message(self, *args):
        pass


class Marionette:
    def __init__(self, port):
        deadline = time.monotonic() + 30
        while True:
            try:
                self.socket = socket.create_connection(("127.0.0.1", port), timeout=2)
                self.socket.settimeout(30)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.1)
        self.seq = 0
        self.receive()
        self.command("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
        self.command("Marionette:SetContext", {"value": "chrome"})

    def receive(self):
        length = b""
        while (char := self.socket.recv(1)) != b":":
            if not char:
                raise RuntimeError("Marionette connection closed")
            length += char
        data = b""
        while len(data) < int(length):
            data += self.socket.recv(int(length) - len(data))
        return json.loads(data)

    def command(self, name, params):
        self.seq += 1
        data = json.dumps([0, self.seq, name, params]).encode()
        self.socket.sendall(str(len(data)).encode() + b":" + data)
        response = self.receive()
        if response[2]:
            raise RuntimeError(response[2])
        return response[3]

    def js(self, script):
        result = self.command("WebDriver:ExecuteScript", {
            "script": script, "args": [], "newSandbox": False,
            "sandbox": "system", "line": 1, "filename": "routing.integration.py",
        })
        return result.get("value", result) if isinstance(result, dict) else result


def wait_for(check, description):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError(description)


def assert_route(path, route):
    wait_for(lambda: any(p == path for p, _ in requests), "No request for " + path)
    seen = [r for p, r in requests if p == path]
    assert seen == [route], (path, seen, route)
    print("PASS first and only request:", path, route, flush=True)


origin = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Origin)
proxy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Proxy)
for server in (origin, proxy):
    threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{origin.server_port}"
profile = Path(tempfile.mkdtemp(prefix="zen-proxy-routing-test-"))
chrome = profile / "chrome"
for folder in ("JS", "utils"):
    shutil.copytree(SINE / "chrome" / folder, chrome / folder)
mod_dir = chrome / "sine-mods/zen-proxy-divider"
mod_dir.mkdir(parents=True)
theme = json.loads((REPO / "theme.json").read_text(encoding="utf-8"))
for filename in ("chrome.css", "theme.json", "preferences.json", "README.md", *theme["scripts"]):
    shutil.copy2(REPO / filename, mod_dir / filename)
shutil.copytree(REPO / "src", mod_dir / "src")
theme.update(enabled=True, origin="store", **{"no-updates": True})
mods = {theme["id"]: theme}
if "--arc" in sys.argv:
    installed = json.loads((SINE / "chrome/sine-mods/mods.json").read_text(encoding="utf-8"))
    mods["Arc-2.0"] = installed["Arc-2.0"]
    mods["Arc-2.0"].update(enabled=True, **{"no-updates": True})
    shutil.copytree(SINE / "chrome/sine-mods/Arc-2.0", chrome / "sine-mods/Arc-2.0")
(chrome / "sine-mods/mods.json").write_text(json.dumps(mods), encoding="utf-8")
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    marionette_port = listener.getsockname()[1]
prefs = {
    "marionette.port": marionette_port,
    "browser.shell.checkDefaultBrowser": False,
    "browser.startup.page": 0,
    "browser.startup.homepage": "about:blank",
    "browser.startup.homepage_override.mstone": "ignore",
    "zen.welcome-screen.seen": True,
    "zen.workspaces.skip-workspace-init": False,
    "sine.mods.disable-all": False,
    "sine.auto-update": False,
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": proxy.server_port,
    "network.proxy.ssl": "127.0.0.1",
    "network.proxy.ssl_port": proxy.server_port,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": True,
    "toolkit.legacyUserProfileCustomizations.stylesheets": True,
    "app.update.auto": False,
    "datareporting.policy.dataSubmissionEnabled": False,
    "toolkit.telemetry.enabled": False,
}
(profile / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()), encoding="utf-8")
if "--arc" in sys.argv:
    arc_prefs = [line for line in (SINE / "prefs.js").read_text(encoding="utf-8").splitlines() if line.startswith('user_pref("arc-')]
    with (profile / "user.js").open("a", encoding="utf-8") as pref_file:
        pref_file.write("\n" + "\n".join(arc_prefs))
print("Isolated test profile:", profile, flush=True)
log_file = (profile / "test.log").open("w", encoding="utf-8")
process = None
driver = None


def start(url=None):
    global process, driver
    args = [str(ZEN), "--headless", "--no-remote", "--profile", str(profile), "--marionette", "--remote-allow-system-access"]
    if url:
        args.append(url)
    process = subprocess.Popen(args, stdout=log_file, stderr=log_file, creationflags=subprocess.CREATE_NO_WINDOW)
    driver = Marionette(marionette_port)
    try:
        wait_for(lambda: driver.js("return !!window.__zenProxyDivider && !!document.getElementById('zen-proxy-inbox');"), "Mod/inbox did not initialize")
    except Exception:
        print(driver.js("return {url: location.href, mod: !!window.__zenProxyDivider, browser: !!window.gBrowser, errors: Services.console.getMessageArray().slice(-25).map(e => e.message)};"), flush=True)
        raise
    print("Zen version:", driver.js("return Services.appinfo.version;"), flush=True)


def stop():
    global process, driver
    if driver:
        try:
            driver.command("Marionette:Quit", {"flags": ["eForceQuit"]})
        except (OSError, RuntimeError):
            pass
        driver.socket.close()
        driver = None
    if process:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=10)
        process = None


try:
    start(base + "/startup-inbox")
    if "--settings" in sys.argv:
        from settings_check import run
        run(driver, profile, wait_for)
        sys.exit(0)
    time.sleep(0.5)
    assert not any(p == "/startup-inbox" for p, _ in requests), requests
    assert driver.js("return JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox', '[]')).some(e => e.url.endsWith('/startup-inbox'));"), "Startup URL missing"
    print("PASS external startup URL buffered without request", flush=True)
    driver.js(f"window.browserDOMWindow.openURI(Services.io.newURI('{base}/external-inbox'), null, Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL, Services.scriptSecurityManager.getSystemPrincipal()); return true;")
    time.sleep(0.3)
    assert not any(p == "/external-inbox" for p, _ in requests), requests
    driver.js("document.querySelector('.zen-proxy-inbox-entry').click(); return true;")
    assert not any(p in ('/startup-inbox', '/external-inbox') for p, _ in requests)
    print("PASS external link and clicking incoming card make no request", flush=True)

    # Identical URLs still have separate IDs; closing must remove only the
    # clicked card without creating or closing a real tab, or loading the URL.
    tab_count = driver.js("return gBrowser.tabs.length;")
    driver.js(f"""
      for (let i = 0; i < 2; i++) {{
        window.browserDOMWindow.openURI(Services.io.newURI('{base}/remove-inbox'),
          null, 0, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
          Services.scriptSecurityManager.getSystemPrincipal());
      }}
      window.testRemoveIds = JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox'))
        .filter(e => e.url.endsWith('/remove-inbox')).map(e => e.id);
      return true;
    """)
    for duplicate_index in (1, 0):
        driver.js(f"""
          const rows = [...document.querySelectorAll('.zen-proxy-inbox-entry')]
            .filter(row => row.title.endsWith('/remove-inbox'));
          const row = rows[{duplicate_index}];
          row.querySelector('.zen-proxy-inbox-close').click();
          return true;
        """)
        if duplicate_index == 1:
            assert driver.js("return JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox')).filter(e => e.url.endsWith('/remove-inbox')).map(e => e.id).join() === window.testRemoveIds[0];"), "Close icon removed the wrong duplicate"
    assert driver.js("return gBrowser.tabs.length;") == tab_count, "Close icon changed browser tabs"
    assert not any(p == "/remove-inbox" for p, _ in requests), requests
    print("PASS close icon removes only the chosen incoming card without loading", flush=True)

    if "--arc" in sys.argv:
        driver.js("""
          for (let i = 0; i < 6; i++) {
            gBrowser.addTab('about:blank', {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
              pinned: true, essential: true, inBackground: true,
            });
          }
          gBrowser.addTab('about:blank', {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            inBackground: true,
          });
          return true;
        """)
        time.sleep(0.5)
        geometry = driver.js("""
          const inbox = document.getElementById('zen-proxy-inbox');
          const workspace = gZenWorkspaces.activeWorkspaceElement;
          const button = workspace.querySelector('#tabs-newtab-button');
          const rect = inbox.getBoundingClientRect();
          return {
            inNormalTabs: inbox.parentNode === workspace.tabsContainer,
            inboxTop: rect.top, inboxBottom: rect.bottom,
            buttonBottom: button.getBoundingClientRect().bottom,
            essentialBottoms: [...document.querySelectorAll('[zen-essential]')]
              .filter(t => t.getBoundingClientRect().height > 0).map(t => t.getBoundingClientRect().bottom),
            normalTabTops: gBrowser.tabs.filter(t => !t.pinned && !t.hasAttribute('zen-essential') &&
              !t.hasAttribute('zen-empty-tab') && t.getBoundingClientRect().height > 0)
              .map(t => t.getBoundingClientRect().top),
          };
        """)
        assert geometry["inNormalTabs"], geometry
        assert geometry["buttonBottom"] <= geometry["inboxTop"] + 1, geometry
        assert geometry["essentialBottoms"] and all(y <= geometry["inboxTop"] for y in geometry["essentialBottoms"]), geometry
        assert geometry["normalTabTops"] and all(y >= geometry["inboxBottom"] for y in geometry["normalTabTops"]), geometry
        screenshot = driver.command("WebDriver:TakeScreenshot", {"id": None, "full": True})
        screenshot = screenshot.get("value", screenshot) if isinstance(screenshot, dict) else screenshot
        (profile / "layout.png").write_bytes(base64.b64decode(screenshot))
        print("PASS Arc layout: Essentials, New Tab, inbox, normal tabs; screenshot:", profile / "layout.png", flush=True)

    # Route selection uses the real sidebar drop handler with the private MIME type.
    if "--arc" not in sys.argv:
        driver.js("gBrowser.addTab('about:blank', { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), inBackground: true }); return true;")
        time.sleep(0.3)
    driver.js("""
      const add = proxyOn => gBrowser.addTab('about:blank', {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        eventDetail: { zenProxyRoute: proxyOn }, inBackground: true,
      });
      window.testProxyAnchor = add(true);
      window.testProxyTail = add(true);
      window.testDirectTail = add(false);
      window.testDirectAnchor = add(false);
      return true;
    """)
    time.sleep(0.4)
    for suffix, route in (("startup-inbox", "proxy"), ("external-inbox", "direct")):
        preview = driver.js(f"""
          const entries = JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox'));
          const entry = entries.find(e => e.url.endsWith('/{suffix}'));
          const dt = new DataTransfer(); dt.setData('application/x-zen-proxy-inbox', entry.id);
          const divider = [...document.querySelectorAll('.zen-proxy-divider:not([drag-preview])')]
            .find(d => d.getBoundingClientRect().height > 0);
          const below = '{route}' === 'direct';
          const anchor = below ? window.testDirectAnchor : window.testProxyAnchor;
          const rect = anchor.getBoundingClientRect();
          window.testDropOptions = {{
            bubbles: true, cancelable: true, dataTransfer: dt,
            clientX: rect.left + rect.width / 2,
            clientY: below ? rect.bottom - 2 : rect.top + 2,
          }};
          divider.style.setProperty('--zen-primary-color', '#010101');
          divider.parentNode.dispatchEvent(new DragEvent('dragover', window.testDropOptions));
          const line = document.getElementById('zen-drag-indicator');
          const directLabel = divider.querySelector('[data-route="direct"].zen-proxy-divider-label');
          return {{ visible: line.isConnected, y: parseFloat(line.style.top),
            expectedY: below ? rect.bottom : rect.top,
            side: divider.getAttribute('drop-side'),
            native: line === gZenPinnedTabManager.dragIndicator,
            directColor: getComputedStyle(directLabel).color,
            inheritedColor: getComputedStyle(divider).color,
            directOpacity: getComputedStyle(directLabel).opacity }};
        """)
        assert preview["visible"] and abs(preview["y"] - preview["expectedY"]) < 1, preview
        assert preview["side"] == ("below" if route == "direct" else "above"), preview
        assert preview["native"], preview
        assert preview["directColor"] == preview["inheritedColor"] and float(preview["directOpacity"]) >= 0.65, preview
        assert not any(p == "/" + suffix for p, _ in requests), requests
        if "--arc" in sys.argv:
            screenshot = driver.command("WebDriver:TakeScreenshot", {"id": None, "full": True})
            screenshot = screenshot.get("value", screenshot) if isinstance(screenshot, dict) else screenshot
            (profile / f"preview-{route}.png").write_bytes(base64.b64decode(screenshot))
        # Cancelling the drag clears its preview and leaves the queue untouched.
        driver.js("document.documentElement.dispatchEvent(new DragEvent('dragend', { bubbles: true })); return true;")
        assert driver.js("return !document.getElementById('zen-drag-indicator');"), "Cancelled drag left a preview"
        driver.js(f"""
          const divider = [...document.querySelectorAll('.zen-proxy-divider:not([drag-preview])')]
            .find(d => d.getBoundingClientRect().height > 0);
          divider.parentNode.dispatchEvent(new DragEvent('dragover', window.testDropOptions));
          divider.parentNode.dispatchEvent(new DragEvent('drop', window.testDropOptions));
          return true;
        """)
        assert_route("/" + suffix, route)
        wait_for(lambda: driver.js(f"""
          const anchor = '{route}' === 'direct' ? window.testDirectAnchor : window.testProxyAnchor;
          const tab = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec.endsWith('/{suffix}'));
          return !!tab && ('{route}' === 'direct' ? anchor.nextElementSibling === tab : tab.nextElementSibling === anchor);
        """), "Incoming tab missed the previewed slot")
        assert driver.js("return !document.getElementById('zen-drag-indicator');"), "Drop left a preview"
        print("PASS insertion preview, cancellation, readable DIRECT, and actual slot:", route, flush=True)
    time.sleep(0.4)
    assert driver.js("return document.getElementById('zen-proxy-inbox').hidden;"), "Empty inbox still visible"

    for route, proxy_on in (("proxy", True), ("direct", False)):
        driver.js(f"""
          window.testParent = gBrowser.addTab('{base}/parent-{route}', {{
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            eventDetail: {{ zenProxyRoute: {str(proxy_on).lower()} }}, inBackground: false,
          }});
          return true;
        """)
        assert_route("/parent-" + route, route)
        driver.js(f"""
          gBrowser.addTab('{base}/child-{route}', {{
            triggeringPrincipal: window.testParent.linkedBrowser.contentPrincipal,
            openerBrowser: window.testParent.linkedBrowser, inBackground: true,
          }});
          return true;
        """)
        assert_route("/child-" + route, route)
        time.sleep(0.4)

    # A foreground owner is not necessarily a link opener (e.g. Ctrl+T).
    driver.js(f"""
      Services.prefs.setStringPref('extensions.zen-proxy-divider.new-tab-side', 'proxy');
      gBrowser.addTab('{base}/unrelated-default', {{
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        ownerTab: window.testParent, inBackground: false,
      }}); return true;
    """)
    assert_route("/unrelated-default", "proxy")

    assert driver.js("return document.querySelector('.zen-proxy-inbox-heading').textContent === 'Unsorted';")

    def assert_buffered(path):
        wait_for(lambda: driver.js(f"return JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox', '[]')).some(e => e.url.endsWith('{path}'));"), "URL missing from Unsorted: " + path)
        time.sleep(0.35)
        assert not any(p == path for p, _ in requests), (path, requests)
        print("PASS Manual: no request, URL in Unsorted:", path, flush=True)

    # Source settings are independent and apply immediately, without restart.
    for mode in ("proxy", "direct", "manual"):
        path = "/external-setting-" + mode
        driver.js(f"""
          Services.prefs.setStringPref('extensions.zen-proxy-divider.external-route', '{mode}');
          Services.prefs.setStringPref('extensions.zen-proxy-divider.new-tab-side', 'manual');
          window.browserDOMWindow.openURI(Services.io.newURI('{base}{path}'), null,
            Ci.nsIBrowserDOMWindow.OPEN_CURRENTWINDOW, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL,
            Services.scriptSecurityManager.getSystemPrincipal()); return true;
        """)
        if mode == "manual":
            assert_buffered(path)
        else:
            assert_route(path, mode)
        time.sleep(0.4)
    driver.js("Services.prefs.setStringPref('extensions.zen-proxy-divider.external-route', 'manual'); return true;")

    # Use the same browser command as Ctrl+T and the real address-bar commit.
    for mode in ("proxy", "direct", "manual"):
        path = "/ctrl-t-setting-" + mode
        driver.js(f"""
          Services.prefs.setStringPref('extensions.zen-proxy-divider.new-tab-side', '{mode}');
          Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', 'manual');
          BrowserCommands.openTab(); return true;
        """)
        time.sleep(0.2)
        driver.js(f"gURLBar.value = '{base}{path}'; gURLBar.handleCommand(); return true;")
        if mode == "manual":
            assert_buffered(path)
        else:
            assert_route(path, mode)
        time.sleep(0.45)
    driver.js("Services.prefs.setStringPref('extensions.zen-proxy-divider.new-tab-side', 'proxy'); return true;")

    # Both opener sides, including Inherit; force opposite defaults to catch
    # accidental use of the fresh-tab setting instead of the link setting.
    for parent_route in ("proxy", "direct"):
        for mode in ("proxy", "direct", "inherit", "manual"):
            path = f"/link-setting-{parent_route}-{mode}"
            driver.js(f"""
              Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', '{mode}');
              const parent = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec.endsWith('/parent-{parent_route}'));
              gBrowser.addTab('{base}{path}', {{
                triggeringPrincipal: parent.linkedBrowser.contentPrincipal,
                openerBrowser: parent.linkedBrowser, inBackground: true,
              }}); return true;
            """)
            if mode == "manual":
                assert_buffered(path)
            else:
                assert_route(path, parent_route if mode == "inherit" else mode)
            time.sleep(0.4)

    # Actual content-process target=_blank/window.open paths may allocate a
    # blank browsing context first, unlike gBrowser.addTab(url) above.
    for mode in ("direct", "inherit", "manual"):
        path = "/content-link-" + mode
        driver.js(f"""
          Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', '{mode}');
          gBrowser.selectedTab = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec.endsWith('/parent-proxy'));
          return true;
        """)
        driver.command("Marionette:SetContext", {"value": "content"})
        try:
            driver.js(f"const a = document.createElement('a'); a.href = '{base}{path}'; a.target = '_blank'; document.body.append(a); a.click(); return true;")
        finally:
            driver.command("Marionette:SetContext", {"value": "chrome"})
        if mode == "manual":
            assert_buffered(path)
        else:
            assert_route(path, "proxy" if mode == "inherit" else mode)
        time.sleep(0.4)
    driver.js("Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', 'inherit'); return true;")

    for mode in ("direct", "inherit", "manual"):
        path = "/window-open-" + mode
        driver.js(f"""
          Services.prefs.setBoolPref('dom.disable_open_during_load', false);
          Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', '{mode}');
          gBrowser.selectedTab = gBrowser.tabs.find(t => t.linkedBrowser.currentURI.spec.endsWith('/parent-proxy'));
          return true;
        """)
        driver.command("Marionette:SetContext", {"value": "content"})
        try:
            driver.js(f"window.open('{base}{path}', '_blank'); return true;")
        finally:
            driver.command("Marionette:SetContext", {"value": "chrome"})
        if mode == "manual":
            assert_buffered(path)
        else:
            assert_route(path, "proxy" if mode == "inherit" else mode)
        time.sleep(0.4)
    driver.js("Services.prefs.setStringPref('extensions.zen-proxy-divider.link-route', 'inherit'); return true;")

    # The queue survives a full browser shutdown and remains inert after restore.
    driver.js(f"window.browserDOMWindow.openURI(Services.io.newURI('{base}/persist-inbox'), null, 0, Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL, Services.scriptSecurityManager.getSystemPrincipal()); return true;")
    stop()
    start()
    assert driver.js("return JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox', '[]')).some(e => e.url.endsWith('/persist-inbox'));"), "Queue did not survive restart"
    time.sleep(0.4)
    assert not any(p == "/persist-inbox" for p, _ in requests), requests
    assert driver.js("return !JSON.parse(Services.prefs.getStringPref('extensions.zen-proxy-divider.inbox', '[]')).some(e => e.url.endsWith('/remove-inbox'));"), "Removed incoming URL reappeared after restart"
    print("PASS incoming queue survives restart without loading", flush=True)
    for mode in ("proxy", "direct"):
        driver.js(f"Services.prefs.setStringPref('extensions.zen-proxy-divider.external-route', '{mode}'); return true;")
        stop()
        path = "/startup-setting-" + mode
        start(base + path)
        assert_route(path, mode)
    print("All routing integration checks passed.", flush=True)
finally:
    stop()
    origin.shutdown()
    proxy.shutdown()
    log_file.close()
