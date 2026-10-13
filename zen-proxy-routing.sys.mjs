// Sine background module: intercept external navigation before any load,
// including links supplied while a new browser window is starting.

const { BrowserDOMWindow } = ChromeUtils.importESModule(
  "resource:///modules/BrowserDOMWindow.sys.mjs"
);
const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs"
);

export const INBOX_PREF = "extensions.zen-proxy-divider.inbox";
export const EXTERNAL_ROUTE_PREF = "extensions.zen-proxy-divider.external-route";
export const NEW_TAB_ROUTE_PREF = "extensions.zen-proxy-divider.new-tab-side";
export const LINK_ROUTE_PREF = "extensions.zen-proxy-divider.link-route";
const privateEntries = new WeakMap();
const listeners = new Set();
const startupURLs = new WeakMap();
const readyWindows = new WeakSet();

export function routeFor(kind) {
  const config = {
    external: [EXTERNAL_ROUTE_PREF, "manual", ["proxy", "direct", "manual"]],
    newtab: [NEW_TAB_ROUTE_PREF, "proxy", ["proxy", "direct", "manual"]],
    link: [LINK_ROUTE_PREF, "inherit", ["proxy", "direct", "inherit", "manual"]],
  }[kind];
  const value = Services.prefs.getStringPref(config[0], config[1]);
  return config[2].includes(value) ? value : config[1];
}

function deferExternal(win, url, route) {
  startupURLs.set(win, [...(startupURLs.get(win) || []), { url, route }]);
}

export function resumeExternalURLs(win) {
  readyWindows.add(win);
  const pending = startupURLs.get(win) || [];
  startupURLs.delete(win);
  for (const { url, route } of pending) {
    const tab = win.gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      fromExternal: true, skipRoute: true, inBackground: false,
      eventDetail: { zenProxyRoute: route === "proxy" },
    });
    if (tab) {
      win.gBrowser.selectedTab = tab;
    }
  }
}

export function inboxEntries(win) {
  if (PrivateBrowsingUtils.isWindowPrivate(win)) {
    return privateEntries.get(win) || [];
  }
  try {
    const entries = JSON.parse(Services.prefs.getStringPref(INBOX_PREF, "[]"));
    return Array.isArray(entries)
      ? entries.filter((e) => typeof e?.id === "string" && canBuffer(e.url))
      : [];
  } catch (e) {
    return [];
  }
}

function canBuffer(url) {
  // Internal browser pages keep their normal command-line behavior.
  return typeof url === "string" && /^(https?|file|ftp):/i.test(url);
}

function saveEntries(win, entries) {
  if (PrivateBrowsingUtils.isWindowPrivate(win)) {
    privateEntries.set(win, entries);
    for (const listener of listeners) {
      listener();
    }
  } else {
    Services.prefs.setStringPref(INBOX_PREF, JSON.stringify(entries));
  }
}

export function bufferExternalURL(win, url) {
  if (!canBuffer(url)) {
    return false;
  }
  saveEntries(win, [
    ...inboxEntries(win),
    { id: Services.uuid.generateUUID().toString(), url },
  ]);
  return true;
}

export function removeInboxEntry(win, id) {
  saveEntries(win, inboxEntries(win).filter((entry) => entry.id !== id));
}

export function watchInbox(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// No call to the original handler for a buffered URL: no tab, document
// channel, DNS request, or site favicon is created here.
for (const method of ["openURI", "openURIInFrame"]) {
  const original = BrowserDOMWindow.prototype[method];
  BrowserDOMWindow.prototype[method] = function (...args) {
    if (args[3] & Ci.nsIBrowserDOMWindow.OPEN_EXTERNAL && canBuffer(args[0]?.spec)) {
      const route = routeFor("external");
      if (route === "manual" || !readyWindows.has(this.win)) {
        if (route === "manual") {
          bufferExternalURL(this.win, args[0].spec);
        } else {
          deferExternal(this.win, args[0].spec, route);
        }
        this.win.focus();
        return method === "openURI"
          ? this.win.gBrowser?.selectedBrowser?.browsingContext || null
          : this.win.gBrowser?.selectedBrowser || null;
      }
      // A chosen external route belongs to a new tab, even when the browser's
      // external-link preference would otherwise reuse the current tab.
      args[2] = Ci.nsIBrowserDOMWindow.OPEN_NEWTAB;
    }
    return original.apply(this, args);
  };
}

function captureStartup(win) {
  if (win.gBrowserInit?.delayedStartupFinished) {
    return;
  }
  const args = win.arguments;
  if (!args?.[0]) {
    return;
  }
  let urls = [];
  try {
    if (args[0] instanceof Ci.nsIArray) {
      // BrowserContentHandler uses this form for external command-line URLs.
      urls = Array.from(args[0].enumerate(Ci.nsISupportsString), (s) => s.data);
    } else if (
      args[1]?.hasKey?.("fromExternal") &&
      args[1].getPropertyAsBool("fromExternal")
    ) {
      urls = [typeof args[0] === "string" ? args[0] : args[0].data];
    }
  } catch (e) {
    console.error("[zen-proxy-divider] external startup arguments", e);
    return;
  }
  if (!urls.length || !urls.every(canBuffer)) {
    return;
  }
  // Replace startup input before gBrowserInit's first navigation. A cached
  // URI value may already exist if Sine initialized during DOM construction.
  args[0] = "about:blank";
  const cached = Object.getOwnPropertyDescriptor(win.gBrowserInit || {}, "uriToLoadPromise");
  if (cached && "value" in cached) {
    win.gBrowserInit.uriToLoadPromise = "about:blank";
  }
  for (const url of urls) {
    const route = routeFor("external");
    if (route === "manual") {
      bufferExternalURL(win, url);
    } else {
      deferExternal(win, url, route);
    }
  }
}

const startupObserver = {
  observe(win) {
    win.addEventListener("DOMContentLoaded", () => captureStartup(win), {
      once: true,
      capture: true,
    });
  },
};
Services.obs.addObserver(startupObserver, "chrome-document-global-created");
// Includes a first browser window that was created before Sine read mods.json.
for (const win of Services.wm.getEnumerator("navigator:browser")) {
  captureStartup(win);
}
