// Static and unit checks for the extension folder: manifest, translations, version numbers,
// safe hiding rules, tab status precedence and "Also hide other popups" in background.js, and the
// popup's outcome mapping and its "Also hide other popups" switch in popup.js.
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

// The demo page's address: wherever a GitHub Pages address is written, it is the one of the
// repository in extension/config.js (tools/set_repo_url.sh moves both together).
const repoUrl = read('extension/config.js').match(/COOKIE_MUNCH_REPO_URL = '([^']+)'/)?.[1] ?? '';
const [owner, repoName] = repoUrl.replace('https://github.com/', '').split('/');
const pagesBase = `https://${owner}.github.io/${repoName}/`;
for (const file of ['README.md', 'CONTRIBUTING.md', 'xcode/Cookie Munch/Shared (App)/Resources/Base.lproj/Main.html']) {
  for (const found of read(file).match(/https:\/\/[\w.-]+\.github\.io\/[\w.-]+\//g) ?? []) {
    if (found !== pagesBase) problems.push(`${file} names ${found}, but the repository's Pages address is ${pagesBase}`);
  }
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

// Hiding rules, in both JSON files: each has rules of its own, and every selector stays a plain
// selector (no braces that could end the CSS rule, no comments).
const UNSAFE = /[{}]|\/\*|\*\//;
const ruleFiles = { 'extension/cookie-rules.json': null, 'extension/rules/other-popups.json': null };
let allSelectors = [];
for (const file of Object.keys(ruleFiles)) {
  const rules = JSON.parse(read(file));
  ruleFiles[file] = rules;
  const sites = Object.values(rules.sites ?? {}).flat();
  if (!rules.generic?.length || !sites.length) {
    problems.push(`${file} has no rules of its own (${rules.generic?.length ?? 0} generic, ${sites.length} for named sites)`);
  }
  const selectors = [rules.generic ?? [], sites, ...Object.values(rules.exceptions ?? {})].flat();
  const unsafe = selectors.filter((s) => typeof s !== 'string' || UNSAFE.test(s));
  if (unsafe.length) problems.push(`${file}: ${unsafe.length} unsafe hiding selectors, e.g. ${JSON.stringify(unsafe[0]).slice(0, 80)}`);
  allSelectors = allSelectors.concat(selectors);
}

// Scroll fixes (other-popups.json): the one style besides display: none. Each must be on html, body
// or the two, set only overflow, overflow-x, overflow-y, position or height, to a plain keyword.
const SCROLL_SELECTOR = /^(html|body|html,body|body,html)$/;
const SCROLL_DECLARATION = (d) => Array.isArray(d) && d.length === 2 &&
  /^(overflow|overflow-x|overflow-y|position|height)$/.test(d[0]) && typeof d[1] === 'string' && /^[a-z]+(-[a-z]+)*$/.test(d[1]);
const scrollFixes = Object.entries(ruleFiles['extension/rules/other-popups.json'].scroll ?? {})
  .flatMap(([site, fixes]) => (Array.isArray(fixes) ? fixes : [fixes]).map((fix) => [site, fix]));
if (!scrollFixes.length) problems.push('extension/rules/other-popups.json has no scroll fixes');
for (const [site, fix] of scrollFixes) {
  const [selector, declarations] = Array.isArray(fix) ? fix : [];
  if (!SCROLL_SELECTOR.test(selector ?? '') || !Array.isArray(declarations) || !declarations.length || !declarations.every(SCROLL_DECLARATION)) {
    problems.push(`other-popups.json: a scroll fix for ${site} outside the allowed form: ${JSON.stringify(fix).slice(0, 120)}`);
  }
}

// Version: the manifest, the Xcode project and the newest changelog entry agree.
const xcode = read('xcode/Cookie Munch/Cookie Munch.xcodeproj/project.xcproj');
const xcodeVersions = new Set([...xcode.matchAll(/"MARKETING_VERSION": "([^"]+)"/g)].map((m) => m[1]));
const changelog = read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m)?.[1];
const short = (v) => v.replace(/\.0$/, '');
if (xcodeVersions.size !== 1 || short([...xcodeVersions][0]) !== short(manifest.version)) {
  problems.push(`version mismatch: manifest ${manifest.version}, Xcode ${[...xcodeVersions].join(', ')}`);
}
if (changelog !== manifest.version) problems.push(`CHANGELOG.md's newest entry is ${changelog}, manifest says ${manifest.version}`);

// Run background.js as Safari would, with rules.js loaded by its importScripts() and the rule files
// fetched from extension/. Returns its message sender and what it did.
function startBackground(localStore = {}) {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
  const sessionStore = {};
  const seen = { onMessage: null, onUpdated: null, badges: {}, inserted: [], fetched: [] };
  const noop = { addListener() {} };
  const browser = {
    runtime: {
      id: 'cookie-munch-test',
      getURL: (p) => p,
      onInstalled: noop,
      onStartup: noop,
      onMessage: { addListener(fn) { seen.onMessage = fn; } },
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
    action: { setBadgeText: async ({ tabId, text }) => { seen.badges[tabId] = text; }, setBadgeBackgroundColor: async () => {} },
    tabs: { onUpdated: { addListener(fn) { seen.onUpdated = fn; } }, onRemoved: noop },
    declarativeNetRequest: { updateEnabledRulesets: async () => {} },
    scripting: { insertCSS: async ({ target, css }) => { seen.inserted.push({ tabId: target.tabId, css }); } },
  };
  const ctx = vm.createContext({
    browser,
    console,
    Date,
    Map,
    Set,
    Promise,
    Number,
    Object,
    Array,
    JSON,
    setTimeout,
    fetch: async (path) => {
      seen.fetched.push(path);
      const text = read(`extension/${path}`);
      return { json: async () => JSON.parse(text) };
    },
  });
  ctx.globalThis = ctx;
  ctx.importScripts = (...files) => {
    for (const file of files) vm.runInContext(read(`extension/${file}`), ctx, { filename: `extension/${file}` });
  };
  vm.runInContext(read('extension/background.js'), ctx, { filename: 'extension/background.js' });
  const send = (message, sender) => new Promise((resolve) => {
    const asyncReply = seen.onMessage?.(message, sender ?? {}, resolve);
    if (!asyncReply) resolve(undefined);
  });
  return { seen, send, localStore };
}

// Tab status precedence: run background.js and verify decline > paywall > hidden on one tab.
async function checkBackgroundStatus() {
  const { seen, send: sendAs } = startBackground();
  const { badges } = seen;
  const onMessage = seen.onMessage;
  const onUpdated = seen.onUpdated;
  if (!onMessage) {
    problems.push('background.js did not register a runtime.onMessage listener');
    return;
  }
  const send = (message, tabId) => sendAs(message, tabId == null ? {} : { tab: { id: tabId } });
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

// "Also hide other popups" in background.js: its real handling inserts the lists' CSS only while the
// option is on, loads their file only when first needed, and never adds their selectors to the cookie
// list's (content.js clicks inside what siteSelectors names).
async function checkBackgroundOtherPopups() {
  const OTHER = 'rules/other-popups.json';
  const other = ruleFiles['extension/rules/other-popups.json'];
  const genericSample = other.generic?.[0];
  const [site, siteList] = Object.entries(other.sites ?? {}).find(([key, list]) => !key.includes('*') && list.length) ?? [];
  if (!genericSample || !site) return; // reported above: the file has no rules of its own
  const frame = (tabId) => ({ tab: { id: tabId }, frameId: 0 });
  const ask = { type: 'hideOtherPopups', host: site, generic: true };

  for (const stored of [{}, { hideOtherPopups: false }]) {
    const { seen, send } = startBackground({ ...stored });
    await send(ask, frame(1));
    const label = JSON.stringify(stored);
    if (seen.inserted.length) problems.push(`background (option off, ${label}): inserted other-popup CSS: ${seen.inserted[0].css.slice(0, 80)}`);
    if (seen.fetched.includes(OTHER)) problems.push(`background (option off, ${label}): loaded ${OTHER}`);
  }

  const { seen, send } = startBackground({ hideOtherPopups: true });
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (seen.fetched.includes(OTHER)) problems.push(`background: loads ${OTHER} when it starts, not on the first request`);
  await send(ask, frame(2));
  const css = seen.inserted.filter((i) => i.tabId === 2).map((i) => i.css).join('\n');
  if (!css.includes(genericSample) || !css.includes(siteList[0])) {
    problems.push(`background (option on): the other-popup CSS for ${site} lacks ${JSON.stringify(genericSample)} or ${JSON.stringify(siteList[0])}`);
  }
  if (!/display: none !important/.test(css)) problems.push('background (option on): no hiding CSS inserted');
  const cookieSelectors = (await send({ type: 'siteSelectors', host: site }, frame(3))) ?? [];
  const cookieSite = new Set(ruleFiles['extension/cookie-rules.json'].sites[site] ?? []);
  const leaked = cookieSelectors.filter((selector) => siteList.includes(selector) && !cookieSite.has(selector));
  if (leaked.length) problems.push(`background: siteSelectors for ${site} names other-popup selectors: ${leaked.slice(0, 3).join(', ')}`);
  await send({ type: 'hide', host: site, site: true, generic: true }, frame(4));
  const cookieCss = seen.inserted.filter((i) => i.tabId === 4).map((i) => i.css).join('\n');
  if (cookieCss.includes(siteList[0]) && !cookieSite.has(siteList[0])) problems.push(`background: the cookie list's CSS for ${site} carries other-popup rules`);
}

// rules.js, where the CSS is built, writes scroll fixes only in the allowed form, whatever the JSON says.
async function checkScrollCss() {
  const good = [['body', [['overflow', 'auto']]], ['html,body', [['overflow-y', 'visible'], ['position', 'initial']]]];
  const bad = [
    ['div', [['overflow', 'auto']]],
    ['body', [['width', 'auto']]],
    ['body', [['overflow', 'auto; color: red']]],
    ['body', [['overflow', 'auto} div {display: none']]],
    ['body', []],
    'body { overflow: auto }',
  ];
  const ctx = vm.createContext({
    fetch: async () => ({ json: async () => ({ generic: [], sites: {}, exceptions: {}, noGeneric: [], scroll: { 'example.org': [...bad, ...good] } }) }),
    Object, Array, Set, JSON, Promise,
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('extension/rules.js'), ctx, { filename: 'extension/rules.js' });
  const rules = ctx.HidingRules.create();
  await rules.load('x');
  let css;
  try {
    css = rules.cssFor('www.example.org', { site: true });
  } catch (error) {
    css = `an error: ${error.message}`;
  }
  const want = 'body { overflow: auto !important; }\nhtml,body { overflow-y: visible !important; position: initial !important; }';
  if (css !== want) problems.push(`rules.js scroll fixes: got ${JSON.stringify(css)}, want ${JSON.stringify(want)}`);
}

// The popup's "Also hide other popups" switch shows what is stored, saves a change and shows the
// reload hint, on any tab (also one whose address Safari hides).
async function checkPopupOtherPopups() {
  for (const tab of [{ id: 1, url: 'https://example.org/' }, { id: 1 }]) {
    for (const stored of [true, false]) {
      const { getEl, saved } = await runPopup('en', 'decline', null, { stored: { hideOtherPopups: stored }, tab });
      const where = tab.url ? 'a web page' : 'a tab without an address';
      const box = getEl('other-popups');
      if (box.checked !== stored) problems.push(`popup (${where}): the other-popups switch shows ${box.checked}, stored ${stored}`);
      getEl('reload-hint').hidden = true; // as popup.html has it
      box.checked = !stored;
      await box.fire('change');
      if (saved.at(-1)?.hideOtherPopups !== !stored) {
        problems.push(`popup (${where}): turning the other-popups switch to ${!stored} saved ${JSON.stringify(saved.at(-1) ?? null)}`);
      }
      if (getEl('reload-hint').hidden !== false) problems.push(`popup (${where}): no reload hint after the other-popups switch changed`);
    }
  }
}

// Run popup.js in a stand-in popup: `stored` is storage.local, `tab` the active tab.
const formatMsg = (table, key, subs = []) => {
  const entry = table[key];
  if (!entry) return '';
  const text = entry.message.replace(/\$([A-Z_]+)\$/g, (_, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? '');
  return text.replace(/\$(\d)/g, (_, i) => subs[i - 1] ?? '');
};
async function runPopup(locale, mode, status, { stored = {}, tab = { id: 1, url: 'https://example.org/' } } = {}) {
  const table = messages[locale];
  const els = new Map();
  const saved = [];
  const makeEl = (id) => {
    const listeners = {};
    return {
      id,
      textContent: '',
      hidden: false,
      checked: false,
      value: id === 'mode-hide' ? 'hide' : 'decline',
      dataset: {},
      classList: { add() {} },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      async fire(type) { for (const fn of listeners[type] ?? []) await fn(); },
    };
  };
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
    tabs: { query: async () => [tab] },
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, total: 1, disabledSites: [], mode, ...stored }),
        set: async (items) => { saved.push(items); },
      },
    },
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
  vm.runInContext(read('extension/popup.js'), ctx, { filename: 'extension/popup.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { headline: getEl('headline').textContent, detail: getEl('detail').textContent, getEl, saved };
}

// Popup outcome mapping: run popup.js across every locale and check headline/detail texts.
async function checkPopupMapping() {
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
await checkBackgroundOtherPopups();
await checkScrollCss();
await checkPopupMapping();
await checkPopupOtherPopups();

if (problems.length) {
  console.log(problems.map((p) => `PROBLEM  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`extension checks passed (${locales.length} locales, ${used.size} message keys in use, ${allSelectors.length} safe selectors, tab status, other popups + popup outcomes ok, version ${manifest.version})`);
