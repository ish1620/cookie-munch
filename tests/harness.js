// Test harness: stands in for Safari's extension APIs and the background script,
// makes the mock banners behave (close, open settings, flip switches and toggle buttons), and
// records every click. Load it before content.js on each test page.
//
// Page options, as <meta name="..." content="...">:
//   expect          the clicks that should happen, comma-separated ("" = none)
//   expect-hidden   "yes": every [data-banner] must end up hidden
//   expect-report   what the popup must be told, as the "how" of each "declined" message,
//                   comma-separated (for example "hidden")
//   mode            "hide" for Hide-only mode (default: decline)
//   disabled-sites  sites switched off in the popup
//   site-rules      extra list selectors for this test site, comma-separated
// Elements marked data-keep must still be visible at the end.

const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content;

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

async function fakeBackground(message) {
  window.__messages.push(message);
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
        disabledSites: meta('disabled-sites')?.split(',') ?? [],
        mode: meta('mode') ?? new URLSearchParams(location.search).get('mode') ?? 'decline',
      }),
      set: async () => {},
    },
  },
  runtime: { sendMessage: fakeBackground },
};

window.__clicks = [];
window.__messages = [];

// Record what was clicked (the nearest data-test label).
document.addEventListener('click', (event) => {
  const target = event.composedPath()[0];
  const tagged = target.closest?.('[data-test]');
  window.__clicks.push(tagged ? tagged.dataset.test : String(target.tagName).toLowerCase());
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
  const closer = target.closest('[data-close]');
  if (closer) closer.closest('[data-banner]').hidden = true;
  if (target.closest('a[href]')) event.preventDefault(); // keep test pages from navigating
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
  const wins = [window, ...[...document.querySelectorAll('iframe')].map((f) => f.contentWindow)];
  const clicks = wins.flatMap((w) => w.__clicks ?? []).join(',');
  const expect = meta('expect');
  const bannersLeft = docs.flatMap((d) => allElements(d, '[data-banner]')).filter((el) => el.checkVisibility()).length;
  const notKept = docs.flatMap((d) => allElements(d, '[data-keep]')).filter((el) => !el.checkVisibility()).length;
  const scrollLocked = [document.documentElement, document.body]
    .some((el) => getComputedStyle(el).overflow.includes('hidden')) || getComputedStyle(document.body).position === 'fixed';
  const expectHidden = meta('expect-hidden') === 'yes';
  const messages = wins.flatMap((w) => w.__messages ?? []);
  const report = messages.filter((m) => m.type === 'declined').map((m) => m.how).join(',');
  const expectReport = meta('expect-report');
  return {
    page: location.pathname.split('/').pop(),
    pass: clicks === expect && (!expectHidden || bannersLeft === 0) && notKept === 0 && !scrollLocked &&
      (expectReport === undefined || report === expectReport),
    expect,
    clicks,
    bannersLeft,
    notKept,
    scrollLocked,
    toggles: toggleStates(document),
    report,
    messages: messages.map((m) => m.type + (m.how ? `:${m.how}` : '')).join(' '),
  };
};
