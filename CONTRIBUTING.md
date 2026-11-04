# Contributing to Cookie Munch

Thanks for helping. The most useful contributions, in order:

1. **Missed banners.** Use the popup's **Report it** link, or open a
   [missed banner issue](https://github.com/ish1620/cookie-munch/issues/new?template=missed-banner.yml).
   The site's address and a screenshot are usually enough.
2. **A new consent platform or button label**, with a test page (see below).
3. Bug fixes, translations, and anything that makes the code simpler.

Found a security problem? Please report it privately, as described in [SECURITY.md](SECURITY.md).

Cookie Munch keeps three promises. Changes that break one of them can't be merged:
it never clicks Accept, it never sends data anywhere, and it never touches the page beyond the banner.

## How it's put together

| Path | What it is |
| --- | --- |
| `extension/manifest.json` | What the extension is and which files Safari runs |
| `extension/content.js` | Finds banners, declines or hides them (runs on every page and in iframes) |
| `extension/background.js` | Adds hiding CSS, switches script blocking, toolbar ✓, running total |
| `extension/rules.js` | Turns the cookie list into CSS for one site |
| `extension/cookie-rules.json` | The cookie list's hiding rules (about 34,000 selectors) |
| `extension/rules/cookie-scripts.json` | The cookie list's script-blocking rules (Hide-only mode) |
| `extension/popup.*`, `config.js` | The toolbar popup; `config.js` holds the repository URL |
| `extension/_locales/` | Popup and store text in English, Japanese and Spanish |
| `xcode/Cookie Munch/` | The Xcode project that wraps the extension in a Mac and iPhone app |
| `tools/` | Build, install, release and maintenance scripts (each explains itself at the top) |
| `tests/` | Mock banner pages, a label checker and a popup preview |
| `art/` | The mascot artwork that every icon is made from |

### What `content.js` does on a page

It watches the page for 30 seconds after it's shown. In **Decline** mode it tries, in order:

1. **Known platforms** (`KNOWN`): exact selectors for the reject buttons of about 30 consent platforms.
2. **Button labels** (`REJECT`): any button whose text matches a "reject" pattern, but only inside
   something that looks like a cookie banner: a pop-up, dialog or element named "cookie"/"consent" whose
   text talks about cookies, or an element the cookie list has a rule for on that site.
3. **Settings flow** (`SETTINGS`, `SAVE`): if a banner has only Accept and Settings, open the settings,
   switch every optional category off, and save.
4. **Hide the rest**: 4 seconds in, add the cookie list's CSS and hide any banner from steps 1-3 that's
   still showing. If it had frozen page scrolling, unfreeze it. This waits (up to 6 s more) while the page
   is still loading or a decline is under way, so late banners get declined rather than hidden.

In **Hide-only** mode it adds the hiding CSS right away, hides banners the label search spots and consent
iframes (Sourcepoint, TrustArc, …), and the background script turns on the script-blocking rules.

Label matching is off on Gmail, Google Calendar, Outlook and Teams (`GENERIC_SKIP_HOSTS`), because
"Decline" there can mean a meeting invite.

## Adding a consent platform or a label

**A platform:** find the reject button with Safari's Web Inspector (right-click it → Inspect) and add a line
to `KNOWN` in `content.js`: the platform's name and a CSS selector that matches only its reject button.

**A label:** add the wording to `REJECT` (or `SETTINGS` / `SAVE` for the settings flow). Patterns match the
whole button text after it's lower-cased and everything that isn't a letter or digit has become a space.
Then add the label to the matching list in `tests/labels.mjs` (`reject`, `settings`, …). If a similar
wording must not count, add that to the `null` list. Run:

```bash
node tests/labels.mjs
```

**A test page:** copy the closest page in `tests/pages/` (for example `onetrust.html` or `generic-en.html`),
change the banner to match the new case, and add it to `tests/index.html`. Each page loads `content.js`
with a stand-in for Safari's APIs (`tests/harness.js`) and reports through `__result()`.

## Testing

Serve the repository root:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

- **Mock banners, all at once:** `swift tools/run_pages.swift` runs every page in WebKit (Safari's engine)
  and prints PASS or FAIL for each, in under a minute.
- **Mock banners, one by one:** open <http://127.0.0.1:8765/tests/>. On each page, run `__result()` in the
  browser console after a few seconds; it must say `pass: true`. Most pages need 2.5 s. `settings-flow` needs 7 s,
  `late-settings` 9 s, and `toggles-first-layer`, `late`, `hide-info-only`, `list-generic-hide` and the
  `neg-*` pages 5 to 6 s. There are 13 pages that should be declined, 6 that should be hidden without a
  click, and 4 where nothing may be touched.
- **Labels:** `node tests/labels.mjs`.
- **Popup:** <http://127.0.0.1:8765/tests/popup-preview.html> shows the real popup in every state.
  Add `?lang=ja` or `?lang=es` for the translations and `&repo=1` to show the Report link.
- **Syntax and consistency:** `node --check` on each file in `extension/` and `tests/harness.js`, then
  `node tests/check_extension.mjs` (manifest files, translations, version numbers).
- **The installed extension:** open <http://127.0.0.1:8765/tests/demo.html> in Safari. That page doesn't load
  any of the extension's code; when the extension works, the page and its tab title say "✓ Rejected". Use
  `127.0.0.1`, not `localhost`.

On every push, GitHub Actions runs the label checker, the syntax and JSON checks, and
`tests/check_extension.mjs` (manifest files, translations, version numbers, safe hiding rules). When the
extension or the tests change, a macOS job also runs every mock page in WebKit.

## Debugging in Safari

- **Page side:** Develop menu → Show Web Inspector. The console shows lines like
  `[Cookie Munch] rejected: clicked "Reject all" (OneTrust)`.
- **Background script:** Develop menu → Web Extension Background Content → Cookie Munch.

## Building the apps

See the README for the one-time Xcode setup (`signing.local`). Then:

- `tools/build_app.sh` builds the Mac app and installs it in `/Applications`.
- `tools/install_iphone.sh` builds the iPhone app and installs it on a connected or nearby phone.

If a build fails with `Embedded binary is not signed with the same certificate as the parent app`, delete
`xcode/build` and run the script again.

## Updating the cookie list

The list changes every few days. A scheduled workflow (`.github/workflows/cookie-list.yml`) refreshes it
weekly and opens a pull request. To do it by hand:

```bash
curl -o /tmp/fanboy-cookiemonster.txt https://secure.fanboy.co.nz/fanboy-cookiemonster.txt
python3 -I tools/build_cookie_rules.py /tmp/fanboy-cookiemonster.txt
```

The converter keeps plain CSS selectors and simple URL rules, and skips the few that use ad-blocker-only
syntax.

## Icons

Every icon comes from `art/cookie-munch.png`:

```bash
python3 -I tools/icons_from_image.py art/cookie-munch.png                 # write all icons
python3 -I tools/icons_from_image.py art/cookie-munch.png --preview /tmp/icons   # preview only
```

## Releasing

1. `tools/bump_version.sh 1.4.0` sets the version in the manifest and the Xcode project.
2. Add the changes to `CHANGELOG.md`.
3. `tools/package_extension.sh` checks everything and writes `dist/cookie-munch-extension.zip` for people who
   load it as a temporary extension.

## Style

Short, plain comments and docs. Log only what the extension did (`log(...)` in `content.js`), not what it
looked at. Keep each change small enough to review.
