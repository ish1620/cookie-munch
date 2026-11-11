// Probes whether Safari's own automation (safaridriver, plain WebDriver over HTTP) runs Cookie Munch.
// It starts a session, opens tests/demo.html, and reads whether the page says "✓ Rejected"; then it asks
// Safari to install extension/ as a temporary extension (the WebDriver "webextension" command) and reads
// the page again. Every WebDriver answer is printed as it came. The session and safaridriver always stop.
// Safari shows a visible automation window while this runs (about 30 seconds).
//
// Needs, once: safaridriver --enable (asks for an administrator password).
// Serve the repository first:  python3 -m http.server 8765 --bind 127.0.0.1
// Then:                         node tools/probe_safaridriver.mjs
// Exits with 0 if the demo page showed the extension's result, 1 if not, 2 if no session started.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEMO_URL = 'http://127.0.0.1:8765/tests/demo.html';
const PORT = 4471;
const REQUEST_TIMEOUT_MS = 20000; // per WebDriver request
const STARTUP_TIMEOUT_MS = 5000;  // for safaridriver to listen
const SHUTDOWN_TIMEOUT_MS = 3000; // for safaridriver to exit when asked, before it is forced to
const RESULT_WAIT_MS = 8000;      // the demo page is answered within a few seconds when the extension runs
const EXTENSION_PATH = fileURLToPath(new URL('../extension', import.meta.url));
const base = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One WebDriver request; returns { status, body } or { error }, never throws.
async function webdriver(method, path, body) {
  try {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { error: error.message };
  }
}

function show(step, outcome) {
  console.log(`${step}: ${outcome.error ? `no answer (${outcome.error})` : `HTTP ${outcome.status} ${outcome.body}`}`);
}

async function demoResult(session) {
  await sleep(RESULT_WAIT_MS);
  const read = await webdriver('POST', `/session/${session}/execute/sync`, {
    script: 'return { result: document.getElementById("result")?.textContent, title: document.title };',
    args: [],
  });
  show('demo page', read);
  return !read.error && read.body.includes('Rejected');
}

// Stop safaridriver and wait until it has exited, forcing it if it doesn't exit when asked.
async function stopDriver(driver) {
  const exited = () => driver.exitCode !== null || driver.signalCode !== null;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (exited()) return;
    driver.kill(signal);
    const gone = new Promise((resolve) => driver.once('exit', resolve));
    await Promise.race([gone, sleep(SHUTDOWN_TIMEOUT_MS)]);
  }
  if (!exited()) console.log(`safaridriver (process ${driver.pid}) didn't exit; stop it by hand.`);
}

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] });
driver.stderr.on('data', (data) => process.stdout.write(`safaridriver: ${data}`));
let session;
let loaded = false;
try {
  for (const started = Date.now(); Date.now() - started < STARTUP_TIMEOUT_MS; await sleep(250)) {
    if (!(await webdriver('GET', '/status')).error) break;
  }
  const created = await webdriver('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } });
  show('new session', created);
  session = created.error ? undefined : JSON.parse(created.body).value?.sessionId;
  if (!session) process.exitCode = 2;
  else {
    console.log(`\n1. The installed app's extension, as Safari has it:`);
    show('open demo', await webdriver('POST', `/session/${session}/url`, { url: DEMO_URL }));
    loaded = await demoResult(session);

    console.log(`\n2. extension/ as a temporary extension:`);
    const installed = await webdriver('POST', `/session/${session}/webextension`, { type: 'path', path: EXTENSION_PATH });
    show('install', installed);
    const extensionId = installed.error ? undefined : JSON.parse(installed.body).value?.extension;
    if (extensionId) {
      show('reload demo', await webdriver('POST', `/session/${session}/url`, { url: DEMO_URL }));
      loaded = (await demoResult(session)) || loaded;
      show('uninstall', await webdriver('DELETE', `/session/${session}/webextension/${encodeURIComponent(extensionId)}`));
    }
    console.log(`\nLoaded: ${loaded ? 'yes, the demo page showed the extension\'s result' : 'no'}`);
    process.exitCode = loaded ? 0 : 1;
  }
} finally {
  if (session) show('end session', await webdriver('DELETE', `/session/${session}`));
  await stopDriver(driver);
}
