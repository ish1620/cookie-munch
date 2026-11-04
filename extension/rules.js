/*
 * Cookie Munch: hiding rules from EasyList's Cookie List (cookie-rules.json).
 * Builds the CSS that hides cookie banners on one site.
 * Used by background.js, and by the test pages.
 */
(function (global) {
  'use strict';

  const CHUNK = 40; // selectors per CSS rule, so one bad selector only disables its own group
  let rules = null;
  let genericCss = null;

  // A selector has to stay a selector: no braces (which could end the rule and add CSS of its own)
  // and no comment markers. The converter already drops these; this is the second line of defence.
  const UNSAFE = /[{}]|\/\*|\*\//;
  const safe = (list) => (Array.isArray(list) ? list.filter((s) => typeof s === 'string' && !UNSAFE.test(s)) : []);
  const safeMap = (map) => Object.fromEntries(Object.entries(map ?? {}).map(([key, list]) => [key, safe(list)]));

  async function load(url) {
    if (!rules) {
      const raw = await (await fetch(url)).json();
      rules = {
        ...raw,
        generic: safe(raw.generic),
        sites: safeMap(raw.sites),
        exceptions: safeMap(raw.exceptions),
        noGeneric: Array.isArray(raw.noGeneric) ? raw.noGeneric : [],
      };
    }
    return rules;
  }

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

  const collect = (map, host) => keysFor(host).flatMap((key) => map[key] ?? []);

  function toCss(selectors) {
    const parts = [];
    for (let i = 0; i < selectors.length; i += CHUNK) {
      parts.push(`${selectors.slice(i, i + CHUNK).join(',\n')} { display: none !important; }`);
    }
    return parts.join('\n');
  }

  // Selectors the list has for this particular site.
  function siteSelectors(host) {
    const skip = new Set(collect(rules.exceptions, host));
    return [...new Set(collect(rules.sites, host))].filter((s) => !skip.has(s));
  }

  // CSS for a frame on `host`. `generic` adds the rules that apply on every site.
  function cssFor(host, { site = true, generic = false } = {}) {
    const parts = [];
    if (site) parts.push(toCss(siteSelectors(host)));
    if (generic && !keysFor(host).some((key) => rules.noGeneric.includes(key))) {
      const skip = new Set(collect(rules.exceptions, host));
      parts.push(skip.size ? toCss(rules.generic.filter((s) => !skip.has(s))) : (genericCss ??= toCss(rules.generic)));
    }
    return parts.filter(Boolean).join('\n');
  }

  global.CookieRules = { load, cssFor, siteSelectors };
})(globalThis);
