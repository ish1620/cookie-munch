// Runs content.js on random consent-settings panels (panels.js) in Playwright's WebKit and says which
// ones it did not leave with every optional switch off. Not part of the regular checks: it is for
// finding weak spots in the switch code, and for comparing two versions of it.
//
//   npm ci && npx playwright install webkit      (once)
//   node tests/random/run.mjs                    both levels, the working copy's extension/
//   node tests/random/run.mjs --level unit --seeds 1,2,3 --panels 2000
//   node tests/random/run.mjs --level pages --seeds 1 --pages 120
//   node tests/random/run.mjs --ext base=/some/older/copy/extension --ext current=extension
//   node tests/random/run.mjs --level pages --only 2:17        one panel again, with its details
//
// Two levels:
//   unit   the switch functions alone (switchesIn, isOn, isLocked, canSwitchOff, switchOff), cut out of
//          content.js's source the way tests/labels.mjs cuts out the labels, on thousands of panels
//   pages  the whole content.js, loaded into page.html, through the settings flow on each panel
// Every panel comes from a seed and an index, printed with each failure: --only seed:index runs it
// again, and tests/random/page.html?seed=S&index=I&ext=/extension shows it in a browser (serve the
// repository root first). With several --ext, a panel the first one handled and a later one doesn't
// is listed as a regression. Exits with 1 if the last --ext failed on a panel whose switches a reader
// can go by (a shape marked unreadable in panels.js is expected to stay on, and is counted apart).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LOCALE = 'en';
const TIME_ZONE = 'UTC';
const UNIT_CHUNK = 100;        // panels built and judged side by side
const UNIT_SETTLE_MS = 200;    // after switchOff, time for every switch to redraw (panels.js RENDER_DELAY_MS)
const PAGES_SIDE_BY_SIDE = 10;
const PAGE_AFTER_SAVE_MS = 2500; // after "saved" is reported, time for a wrong click to still happen
const PAGE_LIMIT_MS = 16000;     // a panel that is never saved is hidden about 10 s in

function fail(message) {
  console.error(message);
  process.exit(2);
}

function options() {
  const found = { level: 'both', seeds: [1, 2, 3], panels: 2000, pages: 120, ext: [], only: null, port: 8791 };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = [args[i], args[i + 1]];
    if (value === undefined) fail(`${name} needs a value`);
    if (name === '--level' && ['unit', 'pages', 'both'].includes(value)) found.level = value;
    else if (name === '--seeds') found.seeds = value.split(',').map(Number);
    else if (name === '--panels') found.panels = Number(value);
    else if (name === '--pages') found.pages = Number(value);
    else if (name === '--port') found.port = Number(value);
    else if (name === '--only' && /^\d+:\d+$/.test(value)) found.only = value.split(':').map(Number);
    else if (name === '--ext' && value.includes('=')) found.ext.push([value.slice(0, value.indexOf('=')), resolve(value.slice(value.indexOf('=') + 1))]);
    else fail(`Don't know ${name} ${value}. See the top of tests/random/run.mjs.`);
  }
  if (!found.ext.length) found.ext.push(['current', join(ROOT, 'extension')]);
  for (const [name, dir] of found.ext) {
    if (!/^[\w-]+$/.test(name)) fail(`An --ext name is letters, digits, "-" or "_": ${name}`);
    if (!existsSync(join(dir, 'content.js'))) fail(`No content.js in ${dir}`);
  }
  return found;
}

// The switch code of one content.js, as the body of a function that returns its pieces. It is cut
// out by the lines that open and close it, so a content.js that moves them stops the run here.
function switchCode(source, name) {
  const cut = (from, to, what) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    if (start < 0 || end < 0) fail(`Can't find ${what} in ${name}'s content.js.`);
    return source.slice(start, end);
  };
  // The timings, then the labels and the helpers: everything from the label lists to the "Finding buttons" part.
  let code = cut('  const WATCH_MS = ', '  // In these web apps', 'the timings')
    + cut('  const REJECT = [', '  // Finding buttons', 'the labels and helpers');
  if (/^ {2}(async )?function switchOff\(banner\) \{$/m.test(source)) {
    if (source.includes('\n  const pause = ')) code += cut('  const pause = ', '\n', 'pause') + '\n';
    code += cut(source.match(/^ {2}(async )?function switchOff\(banner\) \{$/m)[0], '\n  }\n', 'switchOff') + '\n  }\n';
  } else {
    // Older: the loop is inside switchOffAndSave.
    const loop = cut('    let switched = 0;', '    log(`switched off', 'the switch-off loop').replaceAll('save.banner', 'banner');
    code += `  function switchOff(banner) {\n${loop}    return switched;\n  }\n`;
  }
  return `'use strict';\n${code}\nreturn { switchesIn, isOn, isLocked, hasToggles, canSwitchOff, switchOff };`;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Serves the repository, and each --ext folder under /__ext/<name>/.
function serve(exts, port) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const ext = path.match(/^\/__ext\/([\w-]+)\/(.*)$/);
    const base = ext ? exts.find(([name]) => name === ext[1])?.[1] : ROOT;
    const file = base && resolve(base, `.${ext ? `/${ext[2]}` : path}`);
    if (!file || !(file === base || file.startsWith(base + sep)) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }
    try {
      response.writeHead(200, { 'content-type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((done, failed) => {
    server.once('error', failed);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

// --- unit level: runs inside unit.html ---------------------------------------------------------------
async function unitInPage({ seed, from, to, names, settle, details }) {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const runs = [];
  for (let index = from; index < to; index++) {
    const spec = RandomPanels.specFor(seed, index, false);
    for (const name of names) {
      const mount = document.createElement('div');
      document.body.append(mount);
      const panel = RandomPanels.build(spec, document, mount);
      const api = window.__switchCode[name];
      const saved = api.canSwitchOff(panel.banner); // the settings flow saves only then
      const run = { index, name, panel, mount, saved, error: null };
      run.done = Promise.resolve().then(() => api.switchOff(panel.banner)).catch((error) => { run.error = String(error); });
      runs.push(run);
    }
  }
  await Promise.all(runs.map((run) => run.done));
  await sleep(settle);
  return runs.map(({ index, name, panel, mount, saved, error }) => {
    const verdict = RandomPanels.judge(panel, saved);
    mount.remove();
    if (error) Object.assign(verdict, { kind: 'harm', shapes: [`error: ${error}`] });
    return details || verdict.kind !== 'pass' ? { index, name, ...verdict } : { index, name, kind: 'pass' };
  });
}

async function runUnit(context, origin, opts, seed, record) {
  const page = await context.newPage();
  page.on('pageerror', (error) => fail(`unit.html: ${error}`));
  await page.goto(`${origin}/tests/random/unit.html`);
  for (const [name, dir] of opts.ext) {
    await page.evaluate(([n, code]) => { (window.__switchCode ??= {})[n] = new Function(code)(); },
      [name, switchCode(readFileSync(join(dir, 'content.js'), 'utf8'), name)]);
  }
  const names = opts.ext.map(([name]) => name);
  const [first, last] = opts.only ? [opts.only[1], opts.only[1] + 1] : [0, opts.panels];
  for (let from = first; from < last; from += UNIT_CHUNK) {
    const results = await page.evaluate(unitInPage,
      { seed, from, to: Math.min(from + UNIT_CHUNK, last), names, settle: UNIT_SETTLE_MS, details: Boolean(opts.only) });
    for (const result of results) record('unit', seed, result);
  }
  await page.close();
}

// --- pages level -------------------------------------------------------------------------------------
async function runPage(context, origin, seed, index, name) {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/tests/random/page.html?seed=${seed}&index=${index}&ext=/__ext/${name}`);
    const started = Date.now();
    for (;;) {
      await page.waitForTimeout(500);
      const verdict = await page.evaluate(() => { const v = window.__verdict?.(); return v && { ...v, now: Date.now() }; });
      const elapsed = Date.now() - started;
      if (verdict && ((verdict.reportedAt && verdict.now - verdict.reportedAt > PAGE_AFTER_SAVE_MS) || elapsed > PAGE_LIMIT_MS)) {
        return { index, name, ...verdict };
      }
      if (elapsed > PAGE_LIMIT_MS + 5000) return { index, name, kind: 'harm', shapes: ['error: the page gave no verdict'] };
    }
  } catch (error) {
    return { index, name, kind: 'harm', shapes: [`error: ${String(error).split('\n')[0]}`] };
  } finally {
    await page.close();
  }
}

async function runPages(context, origin, opts, seed, record) {
  const jobs = [];
  const [first, last] = opts.only ? [opts.only[1], opts.only[1] + 1] : [0, opts.pages];
  for (let index = first; index < last; index++) for (const [name] of opts.ext) jobs.push([index, name]);
  const workers = Array.from({ length: Math.min(PAGES_SIDE_BY_SIDE, jobs.length) }, async () => {
    while (jobs.length) {
      const [index, name] = jobs.shift();
      record('pages', seed, await runPage(context, origin, seed, index, name));
    }
  });
  await Promise.all(workers);
}

// --- the report --------------------------------------------------------------------------------------
const opts = options();
const names = opts.ext.map(([name]) => name);
const results = new Map(); // "level seed index" -> { name: verdict }
function record(level, seed, result) {
  const key = `${level} ${seed} ${result.index}`;
  results.set(key, { ...(results.get(key) ?? {}), [result.name]: result });
}

const server = await serve(opts.ext, opts.port).catch((error) => fail(`Can't serve on port ${opts.port}: ${error.message}`));
const origin = `http://127.0.0.1:${opts.port}`;
const browser = await webkit.launch();
let exitCode = 0;
try {
  const context = await browser.newContext({ locale: LOCALE, timezoneId: TIME_ZONE });
  const seeds = opts.only ? [opts.only[0]] : opts.seeds;
  console.log(`seeds ${seeds.join(', ')}; versions: ${opts.ext.map(([name, dir]) => `${name} = ${dir.startsWith(ROOT + sep) ? dir.slice(ROOT.length + 1) : dir}`).join(', ')}`);
  for (const seed of seeds) {
    if (opts.level !== 'pages') await runUnit(context, origin, opts, seed, record);
    if (opts.level !== 'unit') await runPages(context, origin, opts, seed, record);
  }

  if (opts.only) {
    for (const [key, byName] of results) console.log(key, JSON.stringify(byName, null, 2));
  }
  const failedHere = (verdict) => verdict.kind !== 'pass';
  // Totals per level, seed and version. "readable" leaves out failures that only unreadable shapes caused.
  console.log('\nlevel  seed  version      panels  failed  (readable)  harm  false-saved  not-saved');
  const totals = new Map();
  for (const [key, byName] of results) {
    const [level, seed] = key.split(' ');
    for (const name of names) {
      const verdict = byName[name];
      const total = totals.get(`${level} ${seed} ${name}`) ?? { panels: 0, failed: 0, readable: 0, harm: 0, 'false-saved': 0, 'not-saved': 0 };
      total.panels++;
      if (failedHere(verdict)) {
        total.failed++;
        total[verdict.kind]++;
        if (!verdict.unreadableOnly) total.readable++;
      }
      totals.set(`${level} ${seed} ${name}`, total);
    }
  }
  for (const [key, t] of totals) {
    const [level, seed, name] = key.split(' ');
    console.log(`${level.padEnd(6)} ${seed.padEnd(5)} ${name.padEnd(12)} ${String(t.panels).padStart(6)}  ${String(t.failed).padStart(6)}  ${String(t.readable).padStart(10)}  ${String(t.harm).padStart(4)}  ${String(t['false-saved']).padStart(11)}  ${String(t['not-saved']).padStart(9)}`);
    if (name === names.at(-1) && t.readable > 0) exitCode = 1;
  }

  // Failure classes: what was left on (or harmed), per level, with how many panels per version and one to run again.
  const classes = new Map();
  for (const [key, byName] of results) {
    const [level, seed, index] = key.split(' ');
    for (const name of names) {
      const verdict = byName[name];
      if (!failedHere(verdict)) continue;
      // A panel with several shapes left on counts once for each.
      for (const shape of verdict.shapes) {
        const id = `${level}  ${verdict.kind}: ${shape}${verdict.master ? ' [with an "all" switch]' : ''}`;
        const entry = classes.get(id) ?? { counts: {}, example: `${seed}:${index}`, regressions: 0 };
        entry.counts[name] = (entry.counts[name] ?? 0) + 1;
        if (name !== names[0] && !failedHere(byName[names[0]])) {
          if (!entry.regressions) entry.example = `${seed}:${index}`;
          entry.regressions++;
        }
        classes.set(id, entry);
      }
    }
  }
  const sorted = [...classes].sort((a, b) => b[1].regressions - a[1].regressions || Object.values(b[1].counts).reduce((x, y) => x + y, 0) - Object.values(a[1].counts).reduce((x, y) => x + y, 0));
  console.log(`\n${sorted.length} failure classes (panels per version; "regressions": ${names[0]} handled the panel)`);
  for (const [id, entry] of sorted.slice(0, 60)) {
    console.log(`  ${names.map((name) => `${name} ${entry.counts[name] ?? 0}`).join(', ')}${names.length > 1 ? `, regressions ${entry.regressions}` : ''}  e.g. ${entry.example}  ${id}`);
  }
  if (sorted.length > 60) console.log(`  ... and ${sorted.length - 60} more classes`);
} finally {
  await browser.close();
  server.close();
}
process.exit(exitCode);
