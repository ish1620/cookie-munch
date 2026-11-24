// Static and unit checks for the extension folder: manifest, translations, version numbers,
// tab status precedence in background.js, and popup outcome mapping in popup.js.
// Run: node tests/check_extension.mjs   (exits non-zero on any problem it finds)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const problems = [];

// Manifest: valid JSON, every file it names exists.
const manifest = JSON.parse(read('extension/manifest.json'));
const named = [
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
  ...(manifest.declarative_net_request?.rule_resources ?? []).map((r) => r.path),
].filter(Boolean);
for (const file of named) {
  if (!existsSync(new URL(`extension/${file}`, root))) problems.push(`manifest names a missing file: ${file}`);
}

// Translations: every locale has the same keys, and every key the popup and manifest use exists.
const locales = readdirSync(new URL('extension/_locales/', root));
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`extension/_locales/${l}/messages.json`))]));
const base = messages[manifest.default_locale];
if (!base) problems.push(`default_locale "${manifest.default_locale}" has no messages.json`);
for (const [locale, table] of Object.entries(messages)) {
  for (const key of Object.keys(base ?? {})) if (!table[key]) problems.push(`${locale} is missing "${key}"`);
  for (const key of Object.keys(table)) if (!base?.[key]) problems.push(`${locale} has an extra key "${key}"`);
  for (const [key, entry] of Object.entries(table)) {
    for (const [, name] of entry.message.matchAll(/\$([A-Za-z_]+)\$/g)) {
      if (!entry.placeholders?.[name.toLowerCase()]) problems.push(`${locale}/${key} uses $${name}$ without a placeholder`);
    }
  }
}
const used = new Set([
  ...[...read('extension/popup.html').matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
  ...[...read('extension/popup.js').matchAll(/\bt\('([A-Za-z]+)'/g)].map((m) => m[1]),
  ...[...read('extension/popup.js').matchAll(/'((?:head|detail|help)[A-Z][A-Za-z]*)'/g)].map((m) => m[1]),
  ...[...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z]+)__/g)].map((m) => m[1]),
]);
for (const key of used) if (!base?.[key]) problems.push(`"${key}" is used but not in _locales/${manifest.default_locale}`);

// Hiding rules: every selector stays a plain selector (no braces that could end the CSS rule, no comments).
const cookieRules = JSON.parse(read('extension/cookie-rules.json'));
const UNSAFE = /[{}]|\/\*|\*\//;
const allSelectors = [cookieRules.generic, ...Object.values(cookieRules.sites), ...Object.values(cookieRules.exceptions)].flat();
const unsafe = allSelectors.filter((s) => typeof s !== 'string' || UNSAFE.test(s));
if (unsafe.length) problems.push(`${unsafe.length} unsafe hiding selectors, e.g. ${JSON.stringify(unsafe[0]).slice(0, 80)}`);

// Version: the manifest, the Xcode project and the newest changelog entry agree.
const xcode = read('xcode/Cookie Munch/Cookie Munch.xcodeproj/project.xcproj');
const xcodeVersions = new Set([...xcode.matchAll(/"MARKETING_VERSION": "([^"]+)"/g)].map((m) => m[1]));
const changelog = read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m)?.[1];
const short = (v) => v.replace(/\.0$/, '');
if (xcodeVersions.size !== 1 || short([...xcodeVersions][0]) !== short(manifest.version)) {
  problems.push(`version mismatch: manifest ${manifest.version}, Xcode ${[...xcodeVersions].join(', ')}`);
}
if (changelog !== manifest.version) problems.push(`CHANGELOG.md's newest entry is ${changelog}, manifest says ${manifest.version}`);

// Tab status precedence: run background.js and verify decline > paywall > hidden on one tab.
async function checkBackgroundStatus() {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  const localStore = {};
  const sessionStore = {};
  let onMessage = null;
  let onUpdated = null;
  const badges = {};
  const noop = { addListener() {} };
  const browser = {
    runtime: {
      id: 'cookie-munch-test',
      getURL: (p) => p,
      onInstalled: noop,
      onStartup: noop,
      onMessage: { addListener(fn) { onMessage = fn; } },
    },
    storage: {
      local: {
        get: async (defaults) => { await tick(); return { ...defaults, ...localStore }; },
        set: async (items) => { await tick(); Object.assign(localStore, items); },
      },
      session: {
        get: async (key) => { await tick(); return key in sessionStore ? { [key]: sessionStore[key] } : {}; },
        set: async (items) => { await tick(); Object.assign(sessionStore, items); },
        remove: async (key) => { await tick(); delete sessionStore[key]; },
      },
      onChanged: noop,
    },
    action: { setBadgeText: async ({ tabId, text }) => { badges[tabId] = text; }, setBadgeBackgroundColor: async () => {} },
    tabs: { onUpdated: { addListener(fn) { onUpdated = fn; } }, onRemoved: noop },
    declarativeNetRequest: { updateEnabledRulesets: async () => {} },
  };
  const ctx = vm.createContext({
    browser,
    importScripts() {},
    CookieRules: { load: async () => {}, cssFor: () => '', siteSelectors: () => [] },
    console,
    Date,
    Map,
    Set,
    Promise,
    Number,
    Object,
    setTimeout,
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('extension/background.js'), ctx, { filename: 'extension/background.js' });
  if (!onMessage) {
    problems.push('background.js did not register a runtime.onMessage listener');
    return;
  }
  const send = (message, tabId) => new Promise((resolve) => {
    const asyncReply = onMessage(message, tabId == null ? {} : { tab: { id: tabId } }, resolve);
    if (!asyncReply) resolve(undefined);
  });
  const wait = () => new Promise((resolve) => setTimeout(resolve, 15));
  const cases = [
    ['paywall then hidden keeps paywall', ['paywall', 'hidden'], 'paywall'],
    ['paywall then rejected becomes rejected', ['paywall', 'rejected'], 'rejected'],
    ['paywall then saved becomes saved', ['paywall', 'saved with optional cookies off'], 'saved with optional cookies off'],
    ['hidden then paywall becomes paywall', ['hidden', 'paywall'], 'paywall'],
    ['rejected then paywall keeps rejected', ['rejected', 'paywall'], 'rejected'],
    ['saved then paywall keeps saved', ['saved with optional cookies off', 'paywall'], 'saved with optional cookies off'],
    ['unknown outcome is ignored', ['bogus'], null],
  ];
  let tabId = 1;
  for (const [label, seq, want] of cases) {
    const id = tabId++;
    for (const how of seq) {
      await send({ type: 'declined', how, platform: null }, id);
      await wait();
    }
    const status = await send({ type: 'getTabStatus', tabId: id });
    const got = status?.how ?? null;
    if (got !== want) problems.push(`background tab status (${label}): got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // Concurrent reports from two frames on the same tab: paywall survives a simultaneous hidden.
  const raceTab = tabId++;
  onMessage({ type: 'declined', how: 'paywall', platform: null }, { tab: { id: raceTab } }, () => {});
  onMessage({ type: 'declined', how: 'hidden', platform: null }, { tab: { id: raceTab } }, () => {});
  await wait();
  const raceStatus = await send({ type: 'getTabStatus', tabId: raceTab });
  if ((raceStatus?.how ?? null) !== 'paywall') {
    problems.push(`background tab status (concurrent paywall + hidden): got ${JSON.stringify(raceStatus?.how ?? null)}, want "paywall"`);
  }
  // A new page starts loading while a report is still being saved: no ✓ may stay without a status.
  const navTab = tabId++;
  onMessage({ type: 'declined', how: 'paywall', platform: null }, { tab: { id: navTab } }, () => {});
  onUpdated?.(navTab, { status: 'loading' });
  await wait();
  const navStatus = await send({ type: 'getTabStatus', tabId: navTab });
  if (!onUpdated) problems.push('background.js did not register a tabs.onUpdated listener');
  if ((navStatus?.how ?? null) !== null || badges[navTab] !== '') {
    problems.push(`background tab status (page load during a report): got status ${JSON.stringify(navStatus?.how ?? null)} and badge ${JSON.stringify(badges[navTab])}, want no status and an empty badge`);
  }
}

// Popup outcome mapping: run popup.js across every locale and check headline/detail texts.
async function checkPopupMapping() {
  const popupSource = read('extension/popup.js');
  const formatMsg = (table, key, subs = []) => {
    const entry = table[key];
    if (!entry) return '';
    const text = entry.message.replace(/\$([A-Z_]+)\$/g, (_, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? '');
    return text.replace(/\$(\d)/g, (_, i) => subs[i - 1] ?? '');
  };
  async function runPopup(locale, mode, status) {
    const table = messages[locale];
    const els = new Map();
    const makeEl = (id) => ({
      id,
      textContent: '',
      hidden: false,
      checked: false,
      value: id === 'mode-hide' ? 'hide' : 'decline',
      dataset: {},
      classList: { add() {} },
      addEventListener() {},
    });
    const getEl = (id) => {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    };
    const document = {
      documentElement: { lang: '' },
      body: { classList: { add() {} } },
      getElementById: getEl,
      querySelectorAll: () => [],
    };
    const browser = {
      i18n: {
        getUILanguage: () => locale,
        getMessage: (key, subs) => formatMsg(table, key, subs),
      },
      tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }] },
      storage: { local: { get: async (defaults) => ({ ...defaults, total: 1, disabledSites: [], mode }), set: async () => {} } },
      runtime: { sendMessage: async () => status, getManifest: () => ({ version: manifest.version }) },
    };
    const ctx = vm.createContext({
      browser,
      document,
      navigator: { userAgent: 'Macintosh', maxTouchPoints: 0 },
      URL,
      URLSearchParams,
      Intl,
      Object,
      String,
      Math,
      Set,
      console,
    });
    ctx.globalThis = ctx;
    vm.runInContext(popupSource, ctx, { filename: 'extension/popup.js' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { headline: getEl('headline').textContent, detail: getEl('detail').textContent };
  }

  for (const locale of locales) {
    const table = messages[locale];
    const checks = [
      ['decline', { how: 'paywall', platform: null }, table.headHidden.message, table.detailHiddenWall.message],
      ['decline', { how: 'hidden', platform: null }, table.headHidden.message, table.detailHiddenDecline.message],
      ['hide', { how: 'hidden', platform: null }, table.headHidden.message, table.detailHiddenHide.message],
      ['decline', { how: 'rejected', platform: null }, table.headMunched.message, table.detailRejected.message],
      ['decline', { how: 'saved with optional cookies off', platform: null }, table.headMunched.message, table.detailSaved.message],
    ];
    for (const [mode, status, wantHead, wantDetail] of checks) {
      const { headline, detail } = await runPopup(locale, mode, status);
      if (headline !== wantHead || detail !== wantDetail) {
        problems.push(`popup (${locale}, ${mode}, ${status.how}): got ${JSON.stringify(headline)} / ${JSON.stringify(detail)}, want ${JSON.stringify(wantHead)} / ${JSON.stringify(wantDetail)}`);
      }
    }
    if (table.detailHiddenWall.message === table.detailHiddenDecline.message) {
      problems.push(`${locale}: detailHiddenWall matches detailHiddenDecline`);
    }
  }
}

await checkBackgroundStatus();
await checkPopupMapping();

if (problems.length) {
  console.log(problems.map((p) => `PROBLEM  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`extension checks passed (${locales.length} locales, ${used.size} message keys in use, ${allSelectors.length} safe selectors, tab status + popup outcomes ok, version ${manifest.version})`);
