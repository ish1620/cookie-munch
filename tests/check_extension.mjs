// Static checks for the extension folder: manifest, translations and version numbers.
// Run: node tests/check_extension.mjs   (exits non-zero on the first kind of problem it finds)
import { readFileSync, readdirSync, existsSync } from 'node:fs';

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

if (problems.length) {
  console.log(problems.map((p) => `PROBLEM  ${p}`).join('\n'));
  process.exit(1);
}
console.log(`extension checks passed (${locales.length} locales, ${used.size} message keys in use, ${allSelectors.length} safe selectors, version ${manifest.version})`);
