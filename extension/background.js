/*
 * Cookie Munch: background script.
 * - Adds the hiding CSS from EasyList's Cookie List to pages that ask for it, and, with
 *   "Also hide other popups" on, the CSS from the Newsletter and Notifications lists.
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
async function insert(sender, css) {
  if (!css) return {};
  try {
    await api.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, css });
    return {};
  } catch {
    return { css }; // the page will add it itself
  }
}

async function hide(sender, { host, site, generic }) {
  await rulesReady;
  return insert(sender, CookieRules.cssFor(host, { site, generic }));
}

// "Also hide other popups": its own rule set, loaded on the first request that needs it (not on
// every wake of this script), and only while the option is on. Hiding only: nothing here reaches
// siteSelectors, which content.js uses to find banners it may click in.
const otherPopups = HidingRules.create();
let otherPopupsReady = null;
function loadOtherPopups() {
  otherPopupsReady ??= otherPopups.load(api.runtime.getURL('rules/other-popups.json')).catch((error) => {
    otherPopupsReady = null; // try again on the next request
    throw error;
  });
  return otherPopupsReady;
}

async function hideOtherPopups(sender, { host, generic }) {
  const { hideOtherPopups: on } = await api.storage.local.get({ hideOtherPopups: false });
  if (on !== true) return {};
  await loadOtherPopups();
  return insert(sender, otherPopups.cssFor(host, { site: true, generic }));
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

const OUTCOME_RANK = {
  hidden: 1,
  paywall: 2,
  rejected: 3,
  'saved with optional cookies off': 3,
};
const OUTCOMES = new Set(Object.keys(OUTCOME_RANK));

const tabQueue = new Map();
function queueTab(tabId, work) {
  const next = (tabQueue.get(tabId) ?? Promise.resolve()).then(work, work);
  tabQueue.set(tabId, next);
  next.finally(() => { if (tabQueue.get(tabId) === next) tabQueue.delete(tabId); });
  return next;
}

function onHandled(tabId, { platform, how }) {
  return queueTab(tabId, async () => {
    const already = await getTabStatus(tabId);
    if (!already) {
      const { total = 0 } = await api.storage.local.get({ total: 0 });
      await api.storage.local.set({ total: total + 1 });
    }
    // A decline beats a paywall, and a paywall beats a plain "hidden".
    if (!already || (OUTCOME_RANK[how] ?? 0) > (OUTCOME_RANK[already.how] ?? 0)) {
      await setTabStatus(tabId, { platform, how, at: Date.now() });
    }
    quietly(api.action.setBadgeText({ tabId, text: '✓' }));
    try {
      quietly(api.action.setBadgeBackgroundColor({ tabId, color: '#2B8A3E' }));
    } catch {
      // Not every Safari version supports badge colors.
    }
  });
}

// ---------------------------------------------------------------------------
// Messages from pages and the popup
// ---------------------------------------------------------------------------
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
    case 'hideOtherPopups':
      if (sender.tab?.id == null || typeof message.host !== 'string') return false;
      return reply(hideOtherPopups(sender, { host: message.host, generic: message.generic === true }));
    case 'siteSelectors':
      return typeof message.host === 'string'
        ? reply(rulesReady.then(() => CookieRules.siteSelectors(message.host)))
        : false;
    case 'getTabStatus':
      return Number.isInteger(message.tabId) ? reply(queueTab(message.tabId, () => getTabStatus(message.tabId))) : false;
    default:
      return false;
  }
});

// A new page in the tab: forget the old status and clear the badge.
api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  // Both in the tab's queue, behind a report that is still being saved: cleared ahead of it, the
  // badge would get its ✓ back from that report, for a status the next step forgets.
  quietly(queueTab(tabId, async () => {
    await clearTab(tabId);
    quietly(api.action.setBadgeText({ tabId, text: '' }));
  }));
});

api.tabs.onRemoved.addListener((tabId) => quietly(queueTab(tabId, () => clearTab(tabId))));
