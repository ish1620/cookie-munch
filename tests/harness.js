// Test harness: stands in for Safari's extension APIs and the background script,
// makes the mock banners behave (close, open settings, open a view inside the settings, flip switches
// and toggle buttons, "object all", load another page), and records every click. Load it before content.js
// on each test page.
//
// Clicks, page loads and the stand-in storage.local are kept in sessionStorage, so they outlive a
// navigation inside one test (a test can load a second page and be judged on its last one) and are
// shared with frames. Messages stay on the top window, for this page's frames.
//
// Page options, as <meta name="..." content="...">:
//   expect               the clicks that should happen, in every page of the test, comma-separated ("" = none)
//   expect-hidden        "yes": every [data-banner] must end up hidden
//   expect-report        what the popup must be told, as the "how" of each "declined" message,
//                        comma-separated (for example "hidden"); this page's messages only
//   expect-loads         how many pages the test loads in all (default 1)
//   expect-last-decline  "none" (no lastDecline in storage.local) or "fresh" (written for this site during this test)
//   continues            "yes" on a page another test page loads: the test goes on (its clicks, loads and storage stay)
//   last-decline-age     seed storage.local's lastDecline this many milliseconds in the past
//   last-decline-site    site for the seeded lastDecline (default: this page's host without www.)
//   last-decline-held    also seed its "held" time, this many milliseconds from now
//   mode                 "hide" for Hide-only mode (default: decline)
//   disabled-sites       sites switched off in the popup
//   site-rules           extra list selectors for this test site, comma-separated
// Elements marked data-keep must still be visible at the end.
//
// Banner behavior, as attributes on the mock's buttons:
//   data-open="id"     hide this banner and show the element with that id
//   data-close         hide this banner
//   data-view="id"     a tab or button that opens a view inside the banner, which stays open: the
//                      <template> with that id is replaced by its content VIEW_DRAW_MS later. Until then
//                      the view's switches are not in the page at all (hidden ones would not do:
//                      content.js also switches off switches it can't see)
//   data-all-off="id"  turn off every role="switch" inside the element with that id
//   data-go="page"     load that page, as a site's script does after a click

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content;

// What the test did so far, in all its pages: { clicks: [...], loads: n, startedAt: ms, removed: [...] }.
// The stand-in for browser.storage.local is kept in sessionStorage too. A new test starts both afresh.
const HISTORY = 'cookie-munch-test-history';
const STORAGE = 'cookie-munch-test-storage';
const testRun = {
  read: () => JSON.parse(sessionStorage.getItem(HISTORY) ?? '{"clicks":[],"loads":0,"startedAt":0,"removed":[]}'),
  change(update) {
    const data = this.read();
    update(data);
    sessionStorage.setItem(HISTORY, JSON.stringify(data));
  },
};
const store = {
  read: () => JSON.parse(sessionStorage.getItem(STORAGE) ?? '{}'),
  write(data) { sessionStorage.setItem(STORAGE, JSON.stringify(data)); },
};
if (window === window.top) {
  if (meta('continues') !== 'yes') {
    sessionStorage.removeItem(HISTORY);
    sessionStorage.removeItem(STORAGE);
    const now = Date.now();
    testRun.change((data) => { data.startedAt = now; });
    const age = meta('last-decline-age');
    if (age !== undefined) {
      const site = meta('last-decline-site') ?? location.hostname.replace(/^www\./, '');
      const held = meta('last-decline-held');
      store.write({ lastDecline: { site, at: now - Number(age), ...(held === undefined ? {} : { held: now + Number(held) }) } });
    }
  }
  testRun.change((data) => { data.loads++; });
}

// The real hiding rules, loaded the same way the background script does.
const rulesReady = new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = '../../extension/rules.js';
  script.onload = async () => {
    const rules = await CookieRules.load('../../extension/cookie-rules.json');
    const extra = meta('site-rules');
    if (extra) rules.sites[location.hostname] = extra.split(',').map((s) => s.trim());
    resolve();
  };
  document.head.append(script);
});

// Record every frame's messages on the top window so they survive a frame being removed or navigated away.
const record = (() => {
  try {
    window.top.__messages ??= [];
    return window.top;
  } catch {
    window.__messages ??= [];
    return window;
  }
})();

async function fakeBackground(message) {
  record.__messages.push(message);
  if (message.type === 'siteSelectors') {
    await rulesReady;
    return CookieRules.siteSelectors(message.host);
  }
  if (message.type === 'hide') {
    await rulesReady;
    return { css: CookieRules.cssFor(message.host, message) }; // content.js adds it as a <style>
  }
  return undefined;
}

window.browser = {
  storage: {
    local: {
      get: async (defaults) => ({
        ...defaults,
        ...store.read(),
        disabledSites: meta('disabled-sites')?.split(',') ?? [],
        mode: meta('mode') ?? new URLSearchParams(location.search).get('mode') ?? 'decline',
      }),
      set: async (items) => {
        store.write({ ...store.read(), ...items });
      },
      remove: async (keys) => {
        const list = [].concat(keys);
        const saved = store.read();
        for (const key of list) delete saved[key];
        store.write(saved);
        testRun.change((data) => data.removed.push(...list));
      },
    },
  },
  runtime: { sendMessage: fakeBackground },
};

const VIEW_DRAW_MS = 400; // a real panel draws a view a moment after the click that opens it

// Record what was clicked (the nearest data-test label).
document.addEventListener('click', (event) => {
  const target = event.composedPath()[0];
  const tagged = target.closest?.('[data-test]');
  testRun.change((data) => data.clicks.push(tagged ? tagged.dataset.test : String(target.tagName).toLowerCase()));
}, true);

// Mock banner behavior.
document.addEventListener('click', (event) => {
  const target = event.composedPath()[0];
  if (!target.closest) return;
  const toggle = target.closest('[role="switch"]');
  if (toggle) toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true'));
  const pressable = target.closest('[aria-pressed]');
  if (pressable) pressable.setAttribute('aria-pressed', String(pressable.getAttribute('aria-pressed') !== 'true'));
  const opener = target.closest('[data-open]');
  if (opener) {
    opener.closest('[data-banner]').hidden = true;
    document.getElementById(opener.dataset.open).hidden = false;
  }
  const viewOpener = target.closest('[data-view]');
  if (viewOpener) {
    const view = document.getElementById(viewOpener.dataset.view); // gone once it has been drawn
    if (view) setTimeout(() => view.replaceWith(view.content.cloneNode(true)), VIEW_DRAW_MS);
  }
  const allOff = target.closest('[data-all-off]');
  if (allOff) {
    for (const box of document.getElementById(allOff.dataset.allOff).querySelectorAll('[role="switch"]')) {
      box.setAttribute('aria-checked', 'false');
    }
  }
  const closer = target.closest('[data-close]');
  if (closer) closer.closest('[data-banner]').hidden = true;
  if (target.closest('a[href]')) event.preventDefault(); // keep test pages from navigating
  const go = target.closest('[data-go]');
  if (go) location.assign(go.dataset.go);
});

function allElements(doc, selector) {
  const roots = [doc, ...[...doc.querySelectorAll('*')].filter((el) => el.shadowRoot).map((el) => el.shadowRoot)];
  return roots.flatMap((root) => [...root.querySelectorAll(selector)]);
}

function toggleStates(doc) {
  return allElements(doc, 'input[type="checkbox"], [role="switch"], [aria-pressed]')
    .map((box) => `${box.dataset.test}=${box.type === 'checkbox' ? box.checked : box.getAttribute('aria-checked') ?? box.getAttribute('aria-pressed')}`)
    .join(' ');
}

// Called by the test runner.
window.__result = () => {
  // Banners inside an iframe that is itself hidden don't count: nobody can see them. (WebKit's
  // checkVisibility() inside a frame doesn't look at the hidden <iframe> around it.)
  const frames = [...document.querySelectorAll('iframe')];
  const docs = [document, ...frames.filter((f) => f.checkVisibility()).map((f) => f.contentDocument).filter(Boolean)];
  const { clicks: clicked, loads, startedAt, removed } = testRun.read();
  const clicks = clicked.join(',');
  const expect = meta('expect');
  const expectLoads = Number(meta('expect-loads') ?? 1);
  const bannersLeft = docs.flatMap((d) => allElements(d, '[data-banner]')).filter((el) => el.checkVisibility()).length;
  const notKept = docs.flatMap((d) => allElements(d, '[data-keep]')).filter((el) => !el.checkVisibility()).length;
  const scrollLocked = [document.documentElement, document.body]
    .some((el) => getComputedStyle(el).overflow.includes('hidden')) || getComputedStyle(document.body).position === 'fixed';
  const expectHidden = meta('expect-hidden') === 'yes';
  const messages = record.__messages;
  const report = messages.filter((m) => m.type === 'declined').map((m) => m.how).join(',');
  const expectReport = meta('expect-report');
  const lastDecline = store.read().lastDecline ?? null;
  const expectLastDecline = meta('expect-last-decline');
  const here = location.hostname.replace(/^www\./, '');
  const lastDeclineOk = expectLastDecline === undefined
    || (expectLastDecline === 'none' && lastDecline === null)
    || (expectLastDecline === 'fresh' && lastDecline !== null && lastDecline.site === here && lastDecline.at >= startedAt);
  return {
    page: location.pathname.split('/').pop(),
    pass: clicks === expect && loads === expectLoads && (!expectHidden || bannersLeft === 0) &&
      notKept === 0 && !scrollLocked && (expectReport === undefined || report === expectReport) && lastDeclineOk,
    expect,
    clicks,
    loads,
    bannersLeft,
    notKept,
    scrollLocked,
    toggles: toggleStates(document),
    report,
    lastDecline,
    removed,
    messages: messages.map((m) => m.type + (m.how ? `:${m.how}` : '')).join(' '),
  };
};
