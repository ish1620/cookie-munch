// Checks tests/live/run_live.mjs against local pages in Playwright's WebKit (no real sites visited):
//   - a page whose script blocks its main thread ends with SKIP "timed out at <step>" within the limit
//   - a record reader whose script blocks its main thread also ends with SKIP "timed out at <step>"
//   - the browser goes on to the next site after a timed-out visit
//   - "Verifying Device" and a short "Verification failed. Please try again." page read as challenge pages
//   - near misses ("Verifying your email address", the words inside a longer title, and a long page
//     containing the sentence) do not
// Local only (not run in GitHub Actions).
//
// Setup once:  npm ci && npx playwright install webkit
// Then:        node tests/live/test_live.mjs
import { createServer } from 'node:http';
import { webkit } from 'playwright';
import { visit } from './run_live.mjs';

const VISIT_LIMIT_MS = 110000; // overall limit per visit (the watch, then one step's limit, and room) so an unfixed run fails instead of hanging
const CLOSE_LIMIT_MS = 5000;

const pages = {
  '/freeze': `<!doctype html>
<title>Frozen page</title>
<p>Loading…</p>
<script>setTimeout(() => { while (true) {} }, 200);</script>`,

  '/freeze-tcf': `<!doctype html>
<title>Frozen record</title>
<p>Article</p>
<script>window.__tcfapi = () => { while (true) {} };</script>`,

  '/challenge-title': `<!doctype html>
<title>Verifying Device</title>
<p>Please wait while we check your browser.</p>`,

  '/challenge-body': `<!doctype html>
<title>Example</title>
<style>.box { padding: 1rem; }</style>
<div class="shell"><div class="wrap"><div class="card">
  <div class="icon"><span></span><span></span><span></span></div>
  <div class="msg"><p>Verification failed.</p><p>Please try again.</p></div>
  <div class="foot"><span></span><span></span><span></span><span></span></div>
</div></div></div>
<script>const padding = "not visible text ".repeat(50);</script>`,

  '/near-miss-title': `<!doctype html>
<title>Verifying your email address</title>
<article>
  <h1>Verifying your email address</h1>
  <p>When you open a new account we send a link to confirm that the address belongs to you.</p>
</article>`,

  '/near-miss-body': `<!doctype html>
<title>Troubleshooting sign-in errors</title>
<article>
  <h1>Troubleshooting sign-in errors</h1>
  <p>If your browser blocks third-party storage or your clock is out of sync, you may see this message when signing in: Verification failed. Please try again.</p>
  <p>To resolve this, check that your system time is accurate, reload the page once, and try the form again from a normal browsing window. If the problem continues after a reload, contact support with the time of the attempt.</p>
</article>`,

  '/near-miss-title-words': `<!doctype html>
<title>Guide to Verifying Device Drivers</title>
<div id="onetrust-banner-sdk">
  <p>We use cookies.</p>
  <button id="onetrust-reject-all-handler">Reject all</button>
</div>
<script>
  document.getElementById('onetrust-reject-all-handler').addEventListener('click', () => {
    document.cookie = 'OptanonAlertBoxClosed=2026-01-01T00:00:00.000Z; path=/';
    document.cookie = 'OptanonConsent=groups=C0001:1,C0002:0; path=/';
    document.getElementById('onetrust-banner-sdk').remove();
  });
</script>`,

  '/next-ok': `<!doctype html>
<title>Next site</title>
<div id="onetrust-banner-sdk">
  <p>We use cookies.</p>
  <button id="onetrust-reject-all-handler">Reject all</button>
</div>
<script>
  document.getElementById('onetrust-reject-all-handler').addEventListener('click', () => {
    document.cookie = 'OptanonAlertBoxClosed=2026-01-01T00:00:00.000Z; path=/';
    document.cookie = 'OptanonConsent=groups=C0001:1,C0002:0; path=/';
    document.getElementById('onetrust-banner-sdk').remove();
  });
</script>`,
};

function startServer() {
  const server = createServer((req, res) => {
    const html = pages[req.url];
    if (!html) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function boundedVisit(browser, site) {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ hung: true }), VISIT_LIMIT_MS);
  });
  try {
    return await Promise.race([visit(browser, site), limit]);
  } finally {
    clearTimeout(timer);
  }
}

async function runCase(browser, baseUrl, spec) {
  const started = Date.now();
  const outcome = await boundedVisit(browser, { name: spec.name, url: `${baseUrl}${spec.path}`, platform: 'local', record: spec.record });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (outcome.hung) {
    return { ok: false, line: `FAIL  ${spec.name}  visit did not finish within ${VISIT_LIMIT_MS / 1000} s` };
  }
  const ok = outcome.verdict === spec.verdict && spec.match.test(outcome.reason);
  const status = ok ? 'PASS' : 'FAIL';
  const detail = ok
    ? `${outcome.verdict} (${outcome.reason}) [${seconds}s]`
    : `got ${outcome.verdict} (${outcome.reason}), want ${spec.verdict} matching ${spec.match} [${seconds}s]`;
  return { ok, line: `${status}  ${spec.name}  ${detail}` };
}

const parallelCases = [
  { name: 'frozen page', path: '/freeze', record: 'tcf', verdict: 'SKIP', match: /^timed out at / },
  { name: 'frozen record reader', path: '/freeze-tcf', record: 'tcf', verdict: 'SKIP', match: /^timed out at / },
  { name: 'challenge title ("Verifying Device")', path: '/challenge-title', record: 'tcf', verdict: 'SKIP', match: /^challenge or block page \(/ },
  { name: 'challenge body ("Verification failed")', path: '/challenge-body', record: 'tcf', verdict: 'SKIP', match: /^challenge or block page \(/ },
  { name: 'near miss title ("Verifying your email address")', path: '/near-miss-title', record: 'tcf', verdict: 'SKIP', match: /^no banner, no record, no decline:/ },
  { name: 'near miss title (the words inside a longer title, on a page that is declined)', path: '/near-miss-title-words', record: 'onetrust', verdict: 'PASS', match: /^refused:/ },
  { name: 'near miss body (long page with sentence)', path: '/near-miss-body', record: 'tcf', verdict: 'SKIP', match: /^no banner, no record, no decline:/ },
];
const afterFreezeCase = {
  name: 'next site after frozen page',
  path: '/next-ok',
  record: 'onetrust',
  verdict: 'PASS',
  match: /^refused:/,
};

const server = await startServer();
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
let browser;
let failed = 0;

try {
  browser = await webkit.launch();
  const results = await Promise.all(parallelCases.map((spec) => runCase(browser, baseUrl, spec)));
  results.push(await runCase(browser, baseUrl, afterFreezeCase));
  for (const result of results) {
    console.log(result.line);
    if (!result.ok) failed++;
  }
  console.log(`\n${results.length - failed} passed, ${failed} failed.`);
} finally {
  if (browser) {
    let timer;
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, CLOSE_LIMIT_MS); }),
    ]);
    clearTimeout(timer);
  }
  server.close();
}

process.exit(failed ? 1 : 0);
