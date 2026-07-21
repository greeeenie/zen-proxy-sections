// Per-channel proxy filter: every browserId in directBrowserIds bypasses
// the browser proxy (the filter returns null → direct connection).

export const directBrowserIds = new Set();

// Route the last top-level document load of each browser actually took
// (true = proxied). Lets newtab.mjs detect a first load that raced ahead
// of the side assignment and went through the wrong route.
export const lastRouteProxied = new Map();

let filterRegistered = false;

const proxyFilter = {
  applyFilter(channel, defaultProxyInfo, callback) {
    let result = defaultProxyInfo;
    try {
      const browserId = browserIdForChannel(channel);
      if (result && browserId && directBrowserIds.has(browserId)) {
        result = null;
      }
      if (
        browserId &&
        channel.loadInfo?.externalContentPolicyType ===
          Ci.nsIContentPolicy.TYPE_DOCUMENT
      ) {
        lastRouteProxied.set(browserId, result !== null);
      }
    } catch (e) {}
    callback.onProxyFilterResult(result);
  },
};

function browserIdForChannel(channel) {
  const loadInfo = channel.loadInfo;
  if (!loadInfo) {
    return 0;
  }
  let bc = null;
  try {
    bc = loadInfo.browsingContext;
  } catch (e) {}
  if (!bc) {
    try {
      bc = loadInfo.workerAssociatedBrowsingContext;
    } catch (e) {}
  }
  try {
    return bc?.top?.browserId || 0;
  } catch (e) {
    return 0;
  }
}

export function browserIdForTab(tab) {
  try {
    const browser = tab.linkedBrowser;
    return (
      browser?.browserId ||
      browser?.browsingContext?.browserId ||
      0
    );
  } catch (e) {
    return 0;
  }
}

export function registerFilter() {
  if (filterRegistered) {
    return;
  }
  const pps = Cc[
    "@mozilla.org/network/protocol-proxy-service;1"
  ].getService(Ci.nsIProtocolProxyService);
  pps.registerChannelFilter(proxyFilter, 1000);
  filterRegistered = true;
}

export function unregisterFilter() {
  if (!filterRegistered) {
    return;
  }
  try {
    const pps = Cc[
      "@mozilla.org/network/protocol-proxy-service;1"
    ].getService(Ci.nsIProtocolProxyService);
    pps.unregisterChannelFilter(proxyFilter);
  } catch (e) {}
  filterRegistered = false;
}
