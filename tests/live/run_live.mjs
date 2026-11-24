// Runs content.js on the real sites in tests/live/sites.json, in Playwright's WebKit (Safari's engine),
// and judges each site by the consent record the site itself wrote, not by its banner going away:
//   PASS  the record is a refusal (every optional category off)
//   FAIL  the record is not a refusal (a consent, or legitimate interest left on where the site's entry
//         asks for that to be judged), or a banner was seen and the record is missing (or the banner
//         was only hidden)
//   SKIP  a challenge or block page, a step that timed out, or the site didn't load or showed no
//         banner, wrote no record and got no decline
// Nothing here tries to get past a challenge page: that site is skipped. Each site is visited once, in a
// fresh browser with the same plain English locale and UTC time for everyone, and no other changes to how
// the browser looks; each site's address picks its language.
// Local only: real sites change often and answer by where the visitor is.
//
// Setup once:  npm ci && npx playwright install webkit
// Then:        npm run test:live
// Exits with 1 if any site fails or none passes, 2 if it can't start.
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const LOCALE = 'en';     // a language only, no country
const TIME_ZONE = 'UTC'; // no place
const PARALLEL = 3;                  // sites visited side by side
const NAVIGATION_TIMEOUT_MS = 30000; // for the first response
const MARGIN_MS = 2000;              // after the watch ends, time for a click content.js already started
const SETTLE_MS = 3000;              // after a decline, time for the site to write its record
const POLL_MS = 500;
const TCF_TIMEOUT_MS = 3000;         // for an answer from the page's __tcfapi
const STEP_TIMEOUT_MS = 60000;       // for any step that waits on the page after it loads: a busy page answers late, a frozen one never
const MESSAGE_PREFIX = '[Cookie Munch test] '; // as in browser-stub.js
const LOG_PREFIX = '[Cookie Munch]';           // content.js's own log lines
const ONETRUST_NECESSARY_FALLBACK = ['C0001'];  // OneTrust's usual "strictly necessary" group
// Signs of a challenge or block page. A page with these is skipped, never worked around.
const CHALLENGE_STATUS = [401, 403, 429];
const CHALLENGE_TITLE = /just a moment|attention required|access denied|acceso denegado|pardon our interruption|are you a (robot|human)|verify you are human|^verifying device$|captcha|request unsuccessful|security check/i;
const CHALLENGE_TEXT = /\bverification failed\.\s*please try again\.?(?=\s|$)/i;
const CHALLENGE_TEXT_MAX_LENGTH = 200; // only a bare challenge page, not an article mentioning the sentence
const CHALLENGE_FRAME_HOST = /(^|\.)captcha-delivery\.com$/; // DataDome's block page

function stop(message) {
  console.log(message);
  process.exit(2);
}

// The Playwright in node_modules must be the one package.json pins.
const pinned = JSON.parse(read('package.json')).devDependencies.playwright;
const installed = createRequire(import.meta.url)('playwright/package.json').version;
if (installed !== pinned) stop(`Playwright ${installed} is installed, but package.json pins ${pinned}. Run npm ci.`);

const contentScript = read('extension/content.js');
const watchMs = Number(contentScript.match(/^ *const WATCH_MS = (\d+);/m)?.[1]);
if (!watchMs) stop('Can\'t find "const WATCH_MS = <milliseconds>;" in extension/content.js.');

// The manifest runs content.js at document_start in every frame of http and https pages. Playwright runs
// this in each frame before the page's own scripts, but in the page's world (it has no extension world),
// so `browser` is removed again right away: content.js has already kept it, and the page never sees it.
// Playwright runs it before the <html> element exists, where content.js would stop (Safari's document_start
// comes just after), so it waits for that element; the parser runs this before any script of the page.
const initScript = `if (location.protocol === 'http:' || location.protocol === 'https:') {
  const runContentScript = () => {
${read('tests/live/browser-stub.js')}
${contentScript}
    delete globalThis.browser;
  };
  if (document.documentElement) runContentScript();
  else new MutationObserver((changes, observer) => {
    if (!document.documentElement) return;
    observer.disconnect();
    runContentScript();
  }).observe(document, { childList: true });
}`;

class StepTimeoutError extends Error {
  constructor(step) {
    super(`timed out at ${step}`);
    this.step = step;
  }
}

async function timed(step, promise, ms = STEP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(step)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isDecline = (message) => message.type === 'declined' && message.how !== 'hidden';
const isShowing = (page, selector) => timed('banner check', page.evaluate(
  (selector) => [...document.querySelectorAll(selector)].some((el) => el.checkVisibility()), selector));

async function cookie(page, name) {
  const cookies = await timed('reading cookies', page.context().cookies(page.url()));
  return cookies.find((c) => c.name === name)?.value;
}

// Each reader returns { found, refused, summary, bannerShowing }: found means the site recorded an answer.
const records = {
  // OptanonConsent holds every group as id:0 or id:1, also before anyone answers; OptanonAlertBoxClosed
  // is only written once the banner is answered. Groups OneTrust marks "always active" may stay at 1.
  async onetrust(page) {
    const bannerShowing = await isShowing(page, '#onetrust-banner-sdk, #onetrust-pc-sdk');
    const answered = await cookie(page, 'OptanonAlertBoxClosed');
    const value = await cookie(page, 'OptanonConsent');
    if (!answered || !value) return { found: false, summary: 'no OneTrust answer (OptanonAlertBoxClosed)', bannerShowing };
    const params = new URLSearchParams(value.includes('=') ? value : decodeURIComponent(value));
    const groups = (params.get('groups') ?? '').split(',').filter(Boolean);
    const fromSite = await timed('OneTrust groups', page.evaluate(() => window.OneTrust?.GetDomainData?.()?.Groups
      ?.filter((group) => String(group.Status).toLowerCase() === 'always active')
      .map((group) => group.CustomGroupId)).catch(() => undefined));
    const necessary = fromSite ?? ONETRUST_NECESSARY_FALLBACK;
    const on = groups.filter((group) => group.endsWith(':1') && !necessary.includes(group.split(':')[0]));
    const source = fromSite ? 'always active on this site' : 'OneTrust\'s usual id; the site didn\'t say';
    return {
      found: true,
      refused: groups.length > 0 && on.length === 0,
      summary: `groups ${groups.join(',') || '(none)'}; necessary: ${necessary.join(',') || '(none)'} (${source})` +
        (on.length ? `; optional groups on: ${on.join(',')}` : ''),
      bannerShowing,
    };
  },

  // CookieConsent is written once the banner is answered; "-1" means no consent is needed here.
  async cookiebot(page) {
    const bannerShowing = await isShowing(page, '#CybotCookiebotDialog');
    const raw = await cookie(page, 'CookieConsent');
    if (!raw || decodeURIComponent(raw) === '-1') {
      return { found: false, summary: raw ? 'CookieConsent=-1 (no consent needed here)' : 'no CookieConsent', bannerShowing };
    }
    const value = decodeURIComponent(raw);
    const categories = Object.fromEntries([...value.matchAll(/\b(necessary|preferences|statistics|marketing):(true|false)\b/g)]
      .map(([, name, state]) => [name, state === 'true']));
    const optional = ['preferences', 'statistics', 'marketing'];
    return {
      found: true,
      refused: optional.every((name) => categories[name] === false),
      summary: optional.map((name) => `${name}:${categories[name] ?? 'missing'}`).join(' ') +
        ` (method ${value.match(/method:'?(\w+)/)?.[1] ?? 'unknown'})`,
      bannerShowing,
    };
  },

  // The IAB TCF API in the top page. A refusal: every purpose consent off. Legitimate interest for
  // purposes is judged only for a site with "legitimateInterest": "judged" in sites.json (a site whose
  // settings Cookie Munch opens): there the record must hold it, with every purpose off. Elsewhere it is
  // printed for information: a site's own Reject button may leave it on. Vendors' legitimate interest
  // is never judged.
  async tcf(page, site) {
    const data = await timed('TCF record', page.evaluate((timeout) => new Promise((resolve) => {
      if (typeof window.__tcfapi !== 'function') return resolve({ missing: true });
      const timer = setTimeout(() => resolve({ timedOut: true }), timeout);
      window.__tcfapi('ping', 2, (ping) => {
        window.__tcfapi('getTCData', 2, (tcData, success) => {
          clearTimeout(timer);
          resolve({
            success,
            displayStatus: ping?.displayStatus,
            cmpId: tcData?.cmpId,
            eventStatus: tcData?.eventStatus,
            gdprApplies: tcData?.gdprApplies,
            hasString: Boolean(tcData?.tcString),
            consents: tcData?.purpose?.consents ?? {},
            legitimate: tcData?.purpose?.legitimateInterests ?? null, // null: the record doesn't hold it
          });
        });
      });
    }), TCF_TIMEOUT_MS));
    if (data.missing) return { found: false, summary: 'no __tcfapi on the page', bannerShowing: false };
    if (data.timedOut || !data.success) return { found: false, summary: '__tcfapi didn\'t answer', bannerShowing: false };
    const bannerShowing = data.displayStatus === 'visible' || data.eventStatus === 'cmpuishown';
    const ids = (object) => Object.keys(object).filter((id) => object[id]).join(',') || 'none';
    const about = `CMP ${data.cmpId}, ${data.eventStatus}`;
    if (!data.hasString || data.gdprApplies === false || data.eventStatus === 'cmpuishown') {
      return { found: false, summary: `no TC string yet (${about}, gdprApplies ${data.gdprApplies})`, bannerShowing };
    }
    const judged = site.legitimateInterest === 'judged';
    const legitimateOff = data.legitimate !== null && Object.values(data.legitimate).every((kept) => kept === false);
    return {
      found: true,
      refused: Object.values(data.consents).every((given) => given === false) && (!judged || legitimateOff),
      summary: `purpose consents: ${ids(data.consents)}; legitimate interest${judged ? '' : ' (not judged)'}: ` +
        `${data.legitimate === null ? 'missing from the record' : ids(data.legitimate)} (${about})`,
      bannerShowing,
    };
  },
};

async function challengeOf(page, response) {
  const status = response?.status();
  if (CHALLENGE_STATUS.includes(status)) return `HTTP ${status}`;
  const title = await timed('page title', page.title().catch(() => ''));
  if (CHALLENGE_TITLE.test(title)) return `page title "${title}"`;
  const host = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
  const frame = page.frames().find((f) => CHALLENGE_FRAME_HOST.test(host(f.url())));
  if (frame) return `challenge frame from ${host(frame.url())}`;
  const text = await timed('challenge check', page.evaluate(
    () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim()).catch(() => ''));
  if (text.length <= CHALLENGE_TEXT_MAX_LENGTH && CHALLENGE_TEXT.test(text)) return `page text "${text}"`;
  return null;
}

function verdictOf({ record, challenge, messages }) {
  const reports = messages.filter((m) => m.type === 'declined'); // content.js saw a banner and declined or hid it
  const said = reports.map((m) => m.how).join(', ') || 'nothing';
  if (record.found && !record.refused) return ['FAIL', `the site's record is not a refusal: ${record.summary}`];
  if (challenge) return ['SKIP', `challenge or block page (${challenge})`];
  if (record.found) return ['PASS', `refused: ${record.summary}`];
  if (reports.length && !reports.some(isDecline)) return ['FAIL', `banner only hidden, no refusal recorded: ${record.summary}`];
  if (reports.length || record.bannerShowing) return ['FAIL', `banner seen, no refusal recorded (Cookie Munch reported ${said}): ${record.summary}`];
  return ['SKIP', `no banner, no record, no decline: ${record.summary}`];
}

export async function visit(browser, site) {
  const context = await browser.newContext({ locale: LOCALE, timezoneId: TIME_ZONE });
  const actions = [];  // content.js's log lines
  let result;
  let timedOut = false;
  try {
    await context.addInitScript(initScript);
    const page = await context.newPage();
    const messages = []; // what content.js told the background script, from every frame
    page.on('console', (line) => {
      const text = line.text();
      if (text.startsWith(MESSAGE_PREFIX)) messages.push(JSON.parse(text.slice(MESSAGE_PREFIX.length)));
      else if (text.startsWith(LOG_PREFIX)) actions.push(text.slice(LOG_PREFIX.length).trim());
    });
    const started = Date.now();
    let response;
    try {
      response = await page.goto(site.url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      result = { verdict: 'SKIP', reason: `didn't load, so no banner, no record, no decline: ${error.message.split('\n')[0]}`, actions };
    }
    if (!result) {
      while (Date.now() < started + watchMs + MARGIN_MS && !messages.some(isDecline)) await sleep(POLL_MS);
      if (messages.some(isDecline)) await sleep(SETTLE_MS);
      const challenge = await challengeOf(page, response);
      let record;
      try {
        record = await records[site.record](page, site);
      } catch (error) {
        if (error instanceof StepTimeoutError) throw error;
        result = { verdict: 'FAIL', reason: `couldn't read the ${site.record} record: ${error.message.split('\n')[0]}`, actions };
      }
      if (!result) {
        const [verdict, reason] = verdictOf({ record, challenge, messages });
        result = { verdict, reason, actions };
      }
    }
  } catch (error) {
    if (!(error instanceof StepTimeoutError)) throw error;
    timedOut = true;
    result = { verdict: 'SKIP', reason: error.message, actions };
  } finally {
    try {
      await timed('closing context', context.close());
    } catch (error) {
      if (!(error instanceof StepTimeoutError)) throw error;
      // The verdict already reached stands; its reason says the page didn't close in time.
      if (result && !timedOut) result = { ...result, reason: `${result.reason}; then ${error.message}` };
    }
  }
  return result;
}

const isMain = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const sites = JSON.parse(read('tests/live/sites.json'));
  for (const site of sites) {
    if (!records[site.record]) stop(`${site.name}: unknown record "${site.record}" (use ${Object.keys(records).join(', ')}).`);
    if ('legitimateInterest' in site && (site.legitimateInterest !== 'judged' || site.record !== 'tcf')) {
      stop(`${site.name}: "legitimateInterest" can only be "judged", on a site with "record": "tcf".`);
    }
  }

  let browser;
  try {
    browser = await webkit.launch();
  } catch (error) {
    stop(`Can't start Playwright's WebKit. Run npx playwright install webkit first.\n${error.message.split('\n')[0]}`);
  }
  console.log(`Playwright ${installed}, WebKit ${browser.version()}; ${sites.length} sites, about ${Math.ceil((watchMs + MARGIN_MS) / 1000)} s each.`);

  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  const queue = [...sites];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let site = queue.shift(); site; site = queue.shift()) {
      const { verdict, reason, actions } = await visit(browser, site);
      counts[verdict]++;
      console.log(`${verdict}  ${site.name} (${site.platform})  ${reason}`);
      if (actions.length) console.log(`      content.js: ${actions.join(' | ')}`);
    }
  }));
  let closeTimedOut = false;
  await timed('closing browser', browser.close()).catch((error) => {
    if (!(error instanceof StepTimeoutError)) throw error;
    closeTimedOut = true;
    console.log(`warning: ${error.message}`);
  });

  console.log(`\n${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped.`);
  const code = counts.FAIL > 0 || counts.PASS === 0 ? 1 : 0;
  if (code || closeTimedOut) process.exit(code);
}
