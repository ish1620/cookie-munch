/*
 * Cookie Munch: hiding rules from EasyList's lists.
 * Builds the CSS that hides cookie banners on one site (cookie-rules.json), and, for "Also hide
 * other popups", sign-up boxes, app banners and notification pre-prompts (rules/other-popups.json).
 * Each list is its own instance (HidingRules.create()), so the other popups' selectors never mix
 * with the cookie list's: content.js treats a cookie-list match as a banner it may decline.
 * Used by background.js, and by the test pages.
 */
(function (global) {
  'use strict';

  const CHUNK = 40; // selectors per CSS rule, so one bad selector only disables its own group

  // A selector has to stay a selector: no braces (which could end the rule and add CSS of its own)
  // and no comment markers. The converter already drops these; this is the second line of defence.
  const UNSAFE = /[{}]|\/\*|\*\//;
  const safe = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === 'string' && !UNSAFE.test(s)) : []);
  const safeMap = (map) => Object.fromEntries(Object.entries(map ?? {}).map(([key, list]) => [key, safe(list)]));

  // Scroll fixes (other-popups.json only): the one style these rules write besides display: none.
  // Only on html and body, only these properties, only a plain keyword; anything else is dropped
  // here as the converter drops it (tools/build_cookie_rules.py, SCROLL_*).
  const SCROLL_SELECTORS = new Set(['html', 'body', 'html,body', 'body,html']);
  const SCROLL_PROPERTIES = new Set(['overflow', 'overflow-x', 'overflow-y', 'position', 'height']);
  const SCROLL_VALUE = /^[a-z]+(?:-[a-z]+)*$/;
  const isScrollFix = (fix) => Array.isArray(fix) && SCROLL_SELECTORS.has(fix[0]) &&
    Array.isArray(fix[1]) && fix[1].length > 0 &&
    fix[1].every((d) => Array.isArray(d) && d.length === 2 && SCROLL_PROPERTIES.has(d[0]) &&
      typeof d[1] === 'string' && SCROLL_VALUE.test(d[1]));
  const scrollMap = (map) => Object.fromEntries(Object.entries(map ?? {})
    .map(([key, list]) => [key, Array.isArray(list) ? list.filter(isScrollFix) : []]));

  // Lookup keys for a host: the host, each parent domain, and "name.*" forms
  // (the list writes "google.*" to mean google.com, google.co.uk, ...).
  function keysFor(host) {
    if (typeof host !== 'string') return [];
    const labels = host.toLowerCase().split('.');
    const keys = [];
    for (let i = 0; i < labels.length; i++) {
      keys.push(labels.slice(i).join('.'));
      if (i < labels.length - 1) keys.push(`${labels[i]}.*`);
    }
    return keys;
  }

  function toCss(selectors) {
    const parts = [];
    for (let i = 0; i < selectors.length; i += CHUNK) {
      parts.push(`${selectors.slice(i, i + CHUNK).join(',\n')} { display: none !important; }`);
    }
    return parts.join('\n');
  }

  // Fixes already checked by isScrollFix (at load), so each part is a known word.
  const toScrollCss = (fixes) => fixes
    .map(([selector, declarations]) => `${selector} { ${declarations.map(([name, value]) => `${name}: ${value} !important;`).join(' ')} }`)
    .join('\n');

  function create() {
    let rules = null;
    let genericCss = null;

    async function load(url) {
      if (!rules) {
        const raw = await (await fetch(url)).json();
        rules = {
          ...raw,
          generic: safe(raw.generic),
          sites: safeMap(raw.sites),
          exceptions: safeMap(raw.exceptions),
          noGeneric: Array.isArray(raw.noGeneric) ? raw.noGeneric : [],
          scroll: scrollMap(raw.scroll),
        };
      }
      return rules;
    }

    const collect = (map, host) => keysFor(host).flatMap((key) => map[key] ?? []);

    // Selectors the list has for this particular site.
    function siteSelectors(host) {
      const skip = new Set(collect(rules.exceptions, host));
      return [...new Set(collect(rules.sites, host))].filter((s) => !skip.has(s));
    }

    // CSS for a frame on `host`. `generic` adds the rules that apply on every site.
    function cssFor(host, { site = true, generic = false } = {}) {
      const parts = [];
      if (site) parts.push(toCss(siteSelectors(host)), toScrollCss(collect(rules.scroll, host)));
      if (generic && !keysFor(host).some((key) => rules.noGeneric.includes(key))) {
        const skip = new Set(collect(rules.exceptions, host));
        parts.push(skip.size ? toCss(rules.generic.filter((s) => !skip.has(s))) : (genericCss ??= toCss(rules.generic)));
      }
      return parts.filter(Boolean).join('\n');
    }

    return { load, cssFor, siteSelectors };
  }

  global.HidingRules = { create };
  global.CookieRules = create();
})(globalThis);
