"""Convert EasyList's Cookie List into the files the extension bundles.

    extension/cookie-rules.json         CSS selectors of cookie banners, for hiding them
    extension/rules/cookie-scripts.json  rules that stop banner scripts from loading
                                         (Safari's declarativeNetRequest format; Hide-only mode)

Get the list from https://secure.fanboy.co.nz/fanboy-cookiemonster.txt, then run:
    python3 -I tools/build_cookie_rules.py path/to/fanboy-cookiemonster.txt

Rules that use ad-blocker-only syntax (":has-text()", scriptlets, regular
expressions, ...) are skipped; plain CSS selectors and simple URL rules are kept.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_HIDE = ROOT / "extension" / "cookie-rules.json"
OUT_NET = ROOT / "extension" / "rules" / "cookie-scripts.json"

COSMETIC = re.compile(r"^(?P<domains>[^#]*?)(?P<sep>##|#@#|#\?#|#@\?#|#\$#|#@\$#|#%#|#@%#)(?P<body>.+)$")

# Pseudo-classes that only ad blockers understand; browsers would reject the whole rule.
NOT_CSS = re.compile(
    r":(-abp-[a-z-]+|has-text|contains|xpath|style|remove|upward|matches-css(-before|-after)?|"
    r"matches-path|matches-attr|matches-prop|min-text-length|watch-attr|others|if|if-not|"
    r"nth-ancestor|remove-attr|remove-class|matches-media)\("
)

RESOURCE_TYPES = {
    "script": "script", "stylesheet": "stylesheet", "image": "image", "xmlhttprequest": "xmlhttprequest",
    "subdocument": "sub_frame", "font": "font", "media": "media", "object": "object", "ping": "ping",
    "websocket": "websocket", "other": "other",
}
URL_FILTER_OK = re.compile(r"^[\x21-\x7e]+$")
# Braces could end the CSS rule and add CSS of its own; comment markers could swallow other rules.
# Neither belongs in a plain selector.
UNSAFE_CSS = re.compile(r"[{}]|/\*|\*/")


def to_css_selector(sep, body):
    """The CSS selector for a hiding rule, or None if it isn't plain CSS."""
    if sep in ("#$#", "#@$#", "#%#", "#@%#") or body.startswith(("+js(", "^")):
        return None  # scriptlets and HTML filters
    if sep in ("#?#", "#@?#"):
        body = body.replace(":-abp-has(", ":has(")  # the one extended pseudo-class with a CSS twin
    if NOT_CSS.search(body) or UNSAFE_CSS.search(body):
        return None
    return body.strip() or None


def split_domains(text):
    domains = [d.strip().lower() for d in text.split(",") if d.strip()]
    return [d for d in domains if not d.startswith("~")], [d[1:] for d in domains if d.startswith("~")]


def network_rule(line):
    """A declarativeNetRequest rule (without id) for a URL rule, or None to skip it."""
    allow = line.startswith("@@")
    if allow:
        line = line[2:]
    pattern, _, opts = line.rpartition("$") if "$" in line else (line, "", "")
    if pattern.startswith("/") and pattern.endswith("/") and len(pattern) > 1:
        return None  # regular expression
    if not pattern or not URL_FILTER_OK.match(pattern) or pattern.startswith("||*"):
        return None
    condition = {"urlFilter": pattern}
    types, not_types = [], []
    for opt in filter(None, (o.strip() for o in opts.split(","))):
        name, _, value = opt.partition("=")
        negated = name.startswith("~")
        name = name.lstrip("~")
        if name in RESOURCE_TYPES:
            (not_types if negated else types).append(RESOURCE_TYPES[name])
        elif name in ("third-party", "3p"):
            condition["domainType"] = "firstParty" if negated else "thirdParty"
        elif name in ("first-party", "1p"):
            condition["domainType"] = "thirdParty" if negated else "firstParty"
        elif name == "domain":
            pos, neg = split_domains(value.replace("|", ","))
            pos = [d for d in pos if "*" not in d]
            neg = [d for d in neg if "*" not in d]
            if not pos and "~" not in value and value:
                return None  # only wildcard domains, which this format can't express
            if pos:
                condition["initiatorDomains"] = pos
            if neg:
                condition["excludedInitiatorDomains"] = neg
        elif name == "match-case":
            condition["isUrlFilterCaseSensitive"] = True
        elif name == "important":
            pass
        else:
            return None  # an option this format can't express (document, csp, redirect, ...)
    if types:
        condition["resourceTypes"] = sorted(set(types))
    elif not_types:
        condition["excludedResourceTypes"] = sorted(set(not_types) | {"main_frame"})
    return {"priority": 2 if allow else 1, "action": {"type": "allow" if allow else "block"}, "condition": condition}


def main(list_path):
    text = Path(list_path).read_text(encoding="utf-8")
    updated = re.search(r"^! Last modified: (.+)$", text, re.M)

    generic, global_exceptions = [], set()
    sites, exceptions = defaultdict(list), defaultdict(list)
    no_generic = set()
    net_rules = []
    skipped = defaultdict(int)

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("!", "[")):
            continue
        match = COSMETIC.match(line)
        if match:
            selector = to_css_selector(match["sep"], match["body"])
            if not selector:
                skipped["hiding rules with ad-blocker-only syntax"] += 1
                continue
            positive, negative = split_domains(match["domains"])
            if "@" in match["sep"]:  # exception: don't hide this selector on these sites
                if positive:
                    for d in positive:
                        exceptions[d].append(selector)
                else:
                    global_exceptions.add(selector)
                continue
            if positive:
                for d in positive:
                    sites[d].append(selector)
            else:
                generic.append(selector)
            for d in negative:
                exceptions[d].append(selector)
            continue

        # Network rules. "@@||site^$generichide" turns off generic hiding on a site.
        if line.startswith("@@") and re.search(r"\$(.*,)?(generichide|elemhide)\b", line):
            host = re.match(r"@@\|\|([a-z0-9.-]+)\^", line)
            if host:
                no_generic.add(host[1])
            continue
        rule = network_rule(line)
        if rule:
            net_rules.append(rule)
        else:
            skipped["script-blocking rules this format can't express"] += 1

    generic = [s for s in dict.fromkeys(generic) if s not in global_exceptions]
    hide = {
        "source": "EasyList Cookie List (https://easylist.to), converted by tools/build_cookie_rules.py",
        "license": "CC BY-SA 3.0, by the EasyList authors (see THIRD_PARTY_NOTICES.md)",
        "updated": updated[1].strip() if updated else None,
        "generic": generic,
        "sites": {d: list(dict.fromkeys(s)) for d, s in sorted(sites.items())},
        "exceptions": {d: list(dict.fromkeys(s)) for d, s in sorted(exceptions.items())},
        "noGeneric": sorted(no_generic),
    }
    net_rules = [{"id": i, **rule} for i, rule in enumerate(net_rules, start=1)]

    OUT_HIDE.write_text(json.dumps(hide, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    OUT_NET.parent.mkdir(parents=True, exist_ok=True)
    OUT_NET.write_text(json.dumps(net_rules, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"list updated:        {hide['updated']}")
    print(f"generic selectors:   {len(generic)}")
    print(f"site selectors:      {sum(len(v) for v in sites.values())} on {len(sites)} sites")
    print(f"exceptions:          {sum(len(v) for v in exceptions.values())} on {len(exceptions)} sites")
    print(f"no generic hiding:   {len(no_generic)} sites")
    print(f"script rules:        {len(net_rules)}")
    for reason, count in skipped.items():
        print(f"skipped:             {count} {reason}")
    for path in (OUT_HIDE, OUT_NET):
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
