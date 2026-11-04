/*
 * Cookie Munch: background script.
 * - Adds the hiding CSS from EasyList's Cookie List to pages that ask for it.
 * - Turns the list's script-blocking rules on in Hide-only mode, off in Decline mode.
 * - Puts a ✓ on the toolbar button for tabs where a banner was handled,
 *   remembers what happened there (for the popup), and keeps a running total.
 */
importScripts('rules.js');

const api = globalThis.browser ?? globalThis.chrome;
const quietly = (promise) => promise?.catch?.(() => {});

const rulesReady = CookieRules.load(api.runtime.getURL('cookie-rules.json'));

// ---------------------------------------------------------------------------
// Hiding
// ---------------------------------------------------------------------------
async function hide(sender, { host, site, generic }) {
  await rulesReady;
  const css = CookieRules.cssFor(host, { site, generic });
  if (!css) return {};
  try {
    await api.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, css });
    return {};
  } catch {
    return { css }; // the page will add it itself
  }
}

// ---------------------------------------------------------------------------
// Script blocking (Hide-only mode)
// ---------------------------------------------------------------------------
async function syncScriptBlocking() {
  const { mode = 'decline' } = await api.storage.local.get({ mode: 'decline' });
  const ids = ['cookie_scripts'];
  try {
    await api.declarativeNetRequest.updateEnabledRulesets(
      mode === 'hide' ? { enableRulesetIds: ids } : { disableRulesetIds: ids },
    );
  } catch (error) {
    console.warn('[Cookie Munch] could not switch script blocking', error);
  }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.mode) syncScriptBlocking();
});
api.runtime.onInstalled.addListener(syncScriptBlocking);
api.runtime.onStartup?.addListener(syncScriptBlocking);

// ---------------------------------------------------------------------------
// Per-tab status and the toolbar badge
// ---------------------------------------------------------------------------
// storage.session survives the background script being unloaded; fall back to
// memory where it isn't available.
const session = api.storage.session;
const memory = new Map();
const keyFor = (tabId) => `tab:${tabId}`;

async function getTabStatus(tabId) {
  if (!session) return memory.get(tabId) ?? null;
  const stored = await session.get(keyFor(tabId));
  return stored[keyFor(tabId)] ?? null;
}

async function setTabStatus(tabId, status) {
  if (session) await session.set({ [keyFor(tabId)]: status });
  else memory.set(tabId, status);
}

async function clearTab(tabId) {
  memory.delete(tabId);
  if (session) await session.remove(keyFor(tabId));
}

async function onHandled(tabId, { platform, how }) {
  const already = await getTabStatus(tabId);
  if (!already) {
    const { total = 0 } = await api.storage.local.get({ total: 0 });
    await api.storage.local.set({ total: total + 1 });
  }
  // A decline is worth more than a hide: don't let a later "hidden" replace it.
  if (!already || already.how === 'hidden') await setTabStatus(tabId, { platform, how, at: Date.now() });
  quietly(api.action.setBadgeText({ tabId, text: '✓' }));
  try {
    quietly(api.action.setBadgeBackgroundColor({ tabId, color: '#2B8A3E' }));
  } catch {
    // Not every Safari version supports badge colors.
  }
}

// ---------------------------------------------------------------------------
// Messages from pages and the popup
// ---------------------------------------------------------------------------
const OUTCOMES = new Set(['rejected', 'saved with optional cookies off', 'hidden']);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content scripts and popup can reach here (there's no
  // externally_connectable), but still accept only messages shaped like ours.
  if (sender.id && sender.id !== api.runtime.id) return false;
  const reply = (promise) => {
    promise.then(sendResponse, () => sendResponse(undefined));
    return true; // answer asynchronously
  };
  switch (message?.type) {
    case 'declined':
      if (sender.tab?.id != null && OUTCOMES.has(message.how)) {
        onHandled(sender.tab.id, { how: message.how, platform: text(message.platform, 60) });
      }
      return false;
    case 'hide':
      if (sender.tab?.id == null || typeof message.host !== 'string') return false;
      return reply(hide(sender, { host: message.host, site: message.site === true, generic: message.generic === true }));
    case 'siteSelectors':
      return typeof message.host === 'string'
        ? reply(rulesReady.then(() => CookieRules.siteSelectors(message.host)))
        : false;
    case 'getTabStatus':
      return Number.isInteger(message.tabId) ? reply(getTabStatus(message.tabId)) : false;
    default:
      return false;
  }
});

// A new page in the tab: forget the old status and clear the badge.
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  quietly(clearTab(tabId));
  quietly(api.action.setBadgeText({ tabId, text: '' }));
});

api.tabs.onRemoved.addListener((tabId) => quietly(clearTab(tabId)));
