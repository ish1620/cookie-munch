"""Convert EasyList's lists into the files the extension bundles.

From the Cookie List (https://secure.fanboy.co.nz/fanboy-cookiemonster.txt):
    extension/cookie-rules.json         CSS selectors of cookie banners, for hiding them
    extension/rules/cookie-scripts.json  rules that stop banner scripts from loading
                                         (Safari's declarativeNetRequest format; Hide-only mode)
From the Newsletter and Notifications lists (https://secure.fanboy.co.nz/fanboy-newsletter.txt
and https://secure.fanboy.co.nz/fanboy-notifications.txt), for "Also hide other popups":
    extension/rules/other-popups.json   CSS selectors of sign-up boxes, app banners and
                                         notification pre-prompts, and the scroll fixes that go with them

Run with either or both:
    python3 -I tools/build_cookie_rules.py path/to/fanboy-cookiemonster.txt
    python3 -I tools/build_cookie_rules.py --other-popups path/to/fanboy-newsletter.txt path/to/fanboy-notifications.txt

Rules that use ad-blocker-only syntax (":has-text()", scriptlets, regular
expressions, ...) are skipped; plain CSS selectors and simple URL rules are kept.
From the other two lists only hiding rules and their exceptions are kept (no URL rules), and the
one style rule kept is a scroll fix of the strict form SCROLL_* below.
"""
import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_HIDE = ROOT / "extension" / "cookie-rules.json"
OUT_NET = ROOT / "extension" / "rules" / "cookie-scripts.json"
OUT_OTHER = ROOT / "extension" / "rules" / "other-popups.json"

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


def last_modified(text, list_path):
    """The list's "! Last modified:" date; a list without one isn't the list we expect."""
    updated = re.search(r"^! Last modified: (.+)$", text, re.M)
    if not updated:
        sys.exit(f"{list_path}: no \"! Last modified:\" line; is this the right list?")
    return updated[1].strip()


def convert_cookie_list(list_path):
    text = Path(list_path).read_text(encoding="utf-8")
    updated = last_modified(text, list_path)

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
        "updated": updated,
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


# ---------------------------------------------------------------------------
# The Newsletter and Notifications lists ("Also hide other popups")
# ---------------------------------------------------------------------------
# Each published list is its source files joined, each starting with a comment naming the file
# ("! fanboy_newsletter_general_hide.txt"). The counts are given by those files, and a list without
# its two hiding files has changed shape (or is another list) and must be looked at first.
# Rules are kept or dropped by their syntax, not by their file: the uBO files hold most of the
# scroll fixes and plain selectors that go with them, and their uBO-only syntax is dropped anyway.
SECTION = re.compile(r"^! (fanboy_[a-z_]+\.txt)$", re.IGNORECASE)
NEEDED_SECTIONS = {
    "newsletter": ["fanboy_newsletter_general_hide.txt", "fanboy_newsletter_specific_hide.txt"],
    "notifications": ["fanboy_notifications_general_hide.txt", "fanboy_notifications_specific_hide.txt"],
}

# Scroll fixes: the one style rule kept. Only on <html> and <body>, only these properties, only a
# plain keyword value ("auto", "initial", ...), and only for named sites. rules.js checks the same.
SCROLL_SELECTORS = {"html", "body", "html,body", "body,html"}
SCROLL_PROPERTIES = {"overflow", "overflow-x", "overflow-y", "position", "height"}
SCROLL_VALUE = re.compile(r"^[a-z]+(?:-[a-z]+)*$")
STYLE_RULE = re.compile(r"^(?P<selector>.+?):style\((?P<declarations>[^()]*)\)$")


def scroll_fix(body):
    """For a ":style()" rule, ([selector, [[property, value], ...]], None) when it is a scroll fix
    of the strict form, else (None, reason)."""
    match = STYLE_RULE.match(body)
    if not match:
        return None, "style rules of another form"
    selector = re.sub(r"\s+", "", match["selector"])
    if selector not in SCROLL_SELECTORS:
        return None, "style rules on elements other than html and body"
    declarations = []
    for part in filter(None, (p.strip() for p in match["declarations"].split(";"))):
        name, colon, value = part.partition(":")
        name = name.strip().lower()
        value = re.sub(r"\s*!important$", "", value.strip(), flags=re.IGNORECASE).strip().lower()
        if not colon or name not in SCROLL_PROPERTIES or not SCROLL_VALUE.match(value):
            return None, "style rules with other properties or values"
        declarations.append([name, value])
    if not declarations:
        return None, "style rules of another form"
    return [selector, declarations], None


def convert_other_lists(newsletter_path, notifications_path):
    generic, global_exceptions = [], set()
    sites, exceptions, scroll = defaultdict(list), defaultdict(list), defaultdict(list)
    no_generic = set()
    updated = {}
    report = {}

    for name, list_path in (("newsletter", newsletter_path), ("notifications", notifications_path)):
        text = Path(list_path).read_text(encoding="utf-8")
        updated[name] = last_modified(text, list_path)
        found = {m[1] for m in (SECTION.match(line.strip()) for line in text.splitlines()) if m}
        missing = [s for s in NEEDED_SECTIONS[name] if s not in found]
        if missing:
            sys.exit(f"{list_path}: no section comment \"! {missing[0]}\"; the list has changed shape, check it")

        kept, dropped = defaultdict(lambda: defaultdict(int)), defaultdict(int)
        section = "(before the first file)"
        for raw in text.splitlines():
            line = raw.strip()
            heading = SECTION.match(line)
            if heading:
                section = heading[1]
                continue
            if not line or line.startswith(("!", "[")):
                continue
            match = COSMETIC.match(line)
            if not match:
                if line.startswith("@@") and re.search(r"\$(.*,)?(generichide|elemhide)\b", line):
                    host = re.match(r"@@\|\|([a-z0-9.-]+)\^", line)
                    if host:
                        no_generic.add(host[1])
                        kept[section]["sites without generic hiding"] += 1
                        continue
                dropped["URL rules (not used)"] += 1
                continue
            positive, negative = split_domains(match["domains"])
            exception = "@" in match["sep"]
            if match["sep"] in ("##", "#@#") and ":style(" in match["body"]:
                fix, reason = scroll_fix(match["body"])
                if not fix or exception or not positive or negative:
                    dropped[reason or "scroll fixes that are generic, exceptions or with ~sites"] += 1
                    continue
                for d in positive:
                    scroll[d].append(fix)
                kept[section]["scroll fixes"] += 1
                continue
            selector = to_css_selector(match["sep"], match["body"])
            if not selector:
                dropped["hiding rules with ad-blocker-only syntax"] += 1
                continue
            if exception:
                if positive:
                    for d in positive:
                        exceptions[d].append(selector)
                else:
                    global_exceptions.add(selector)
                kept[section]["exceptions"] += 1
                continue
            if positive:
                for d in positive:
                    sites[d].append(selector)
                kept[section]["site rules"] += 1
            else:
                generic.append(selector)
                kept[section]["generic rules"] += 1
            for d in negative:
                exceptions[d].append(selector)
        report[name] = (kept, dropped)

    generic = [s for s in dict.fromkeys(generic) if s not in global_exceptions]

    def unique_fixes(fixes):
        seen = {}
        for selector, declarations in fixes:
            seen.setdefault(json.dumps([selector, declarations]), [selector, declarations])
        return list(seen.values())

    rules = {
        "source": "EasyList's Fanboy Newsletter and Fanboy Notifications lists (https://easylist.to), "
        "converted by tools/build_cookie_rules.py",
        "license": "CC BY-SA 3.0, by the EasyList authors (see THIRD_PARTY_NOTICES.md)",
        "updated": updated,
        "generic": generic,
        "sites": {d: list(dict.fromkeys(s)) for d, s in sorted(sites.items())},
        "exceptions": {d: list(dict.fromkeys(s)) for d, s in sorted(exceptions.items())},
        "noGeneric": sorted(no_generic),
        "scroll": {d: unique_fixes(f) for d, f in sorted(scroll.items())},
    }
    OUT_OTHER.parent.mkdir(parents=True, exist_ok=True)
    OUT_OTHER.write_text(json.dumps(rules, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for name, (kept, dropped) in report.items():
        print(f"{name} list updated: {updated[name]}")
        for section, kinds in kept.items():
            print(f"  kept from {section}: " + ", ".join(f"{count} {kind}" for kind, count in kinds.items()))
        for reason, count in dropped.items():
            print(f"  dropped: {count} {reason}")
    print(f"generic selectors:   {len(generic)}")
    print(f"site selectors:      {sum(len(v) for v in rules['sites'].values())} on {len(sites)} sites")
    print(f"exceptions:          {sum(len(v) for v in rules['exceptions'].values())} on {len(exceptions)} sites")
    print(f"no generic hiding:   {len(no_generic)} sites")
    print(f"scroll fixes:        {sum(len(v) for v in rules['scroll'].values())} on {len(scroll)} sites")
    print(f"wrote {OUT_OTHER.relative_to(ROOT)} ({OUT_OTHER.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(usage=__doc__)
    parser.add_argument("cookie_list", nargs="?")
    parser.add_argument("--other-popups", nargs=2, metavar=("NEWSLETTER", "NOTIFICATIONS"))
    args = parser.parse_args()
    if not args.cookie_list and not args.other_popups:
        sys.exit(__doc__)
    if args.cookie_list:
        convert_cookie_list(args.cookie_list)
    if args.other_popups:
        convert_other_lists(*args.other_popups)
