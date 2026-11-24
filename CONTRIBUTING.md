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
| `tests/` | Mock banner pages, real-site tests (`tests/live/`), a label checker and a popup preview |
| `art/` | The mascot artwork that every icon is made from |

### What `content.js` does on a page

It watches the page for 30 seconds after it's shown. In **Decline** mode it tries, in order:

1. **Known platforms** (`KNOWN`): exact selectors for the reject buttons of about 30 consent platforms.
   A match that is a pay button (see below) is never clicked.
2. **Button labels** (`REJECT`): any button whose text matches a "reject" pattern, but only inside
   something that looks like a cookie banner: a pop-up, dialog or element named "cookie"/"consent" whose
   text talks about cookies, or an element the cookie list has a rule for on that site.
3. **Settings flow** (`SETTINGS`, `SAVE`, `LEGIT`, `OBJECT`): if a banner has only Accept and Settings, open
   the settings, switch every optional category off, and save. Switches are checkboxes, `role="switch"`,
   `role="checkbox"` and toggle buttons (`aria-pressed`). A switch that holds other switches, also in its
   shadow DOM, is one switch, turned off by one click: on its "Off" part (the one with the class `off`)
   when it is drawn as an "Off" and an "On" part, on the switch inside it when its own markup holds just
   one (a styled switch around the real checkbox), and on itself otherwise. After a click it waits a
   moment before reading the next switch, since one switch can turn others off. If the panel has a
   "Legitimate interest" tab or button, it opens that view before saving, clicks "Object all" if there is
   one, waits a moment for that to be drawn, and switches off what is still on there: those purposes are
   on until objected to. It does that once per page. If the settings have no switch it can turn off and
   no such view, it saves nothing and leaves the banner to step 4; the same if that view leaves no Save
   button. Toggle buttons that move around the panel (`NAV`: "PARTNERS", "BACK") are no switches.
4. **Hide the rest**: 4 seconds in, add the cookie list's CSS and hide any banner from steps 1-3 that's
   still showing. If it had frozen page scrolling, unfreeze it. This waits (up to 6 s more) while the page
   is still loading or a decline is under way, so late banners get declined rather than hidden.

After a reject or Save click, `finish` checks 1.5 seconds later that the clicked button is no longer
visible before reporting a decline. For a reject click inside an iframe, the outer page often removes or
hides (`display: none`) the `<iframe>` itself without changing what is inside it, which the frame can't
see by looking at its own button. So there, until that check is due, two more signs count as the banner
going away: the frame unloading (`pagehide`), and the button being out of view at the check after it was
in view (an `IntersectionObserver`). A button that was never in view (a frame below the fold), one that
left view and came back, and a frame hidden in the same instant as the click, before the browser has
said the button was in view, say nothing: those end as before, unreported. Both signs are confirmed
only for same-origin frames in WebKit's test runner, with a stand-in for the background script; in
Safari itself they are not yet verified: `tests/demo-frame.html` is the page to try with the installed
extension.

**Pay-or-consent walls:** a pay button is not clicked. It is a button whose own text shows a word
such as "suscribirse" or "pay", or a price (a number beside €, $ or £), in the words seen on real walls
so far; hidden text and the `aria-label` don't count. It is never a reject, a Save, a settings button
or a switch, and it doesn't mark a banner. Every click `content.js` makes also passes one last look at
the button, `press()`, which reads what it shows at that moment and leaves a pay button alone. The rest of the banner is handled as on any banner: a plain reject is clicked, the settings are
opened and saved where they allow a free refusal, and a banner that can't be refused is hidden in step
4. Not covered: a pay label in words not listed, and a plain button that sits inside a larger pay
control.

In **Hide-only** mode it adds the hiding CSS right away, hides banners the label search spots and consent
iframes (Sourcepoint, TrustArc, …), and the background script turns on the script-blocking rules.

Label matching is off on Gmail, Google Calendar, Outlook and Teams (`GENERIC_SKIP_HOSTS`), because
"Decline" there can mean a meeting invite.

## Adding a consent platform or a label

**A platform:** find the reject button with Safari's Web Inspector (right-click it → Inspect) and add a line
to `KNOWN` in `content.js`: the platform's name and a CSS selector that matches only its reject button.

**A label:** add the wording to `REJECT` (or, for the settings flow, to `SETTINGS`, `SAVE`, `LEGIT` for
what opens a panel's "Legitimate interest" view, `OBJECT` for its "Object all", or `NAV` for a toggle
button that moves around the panel; those three are English only so far). A pay button's words are in
`PAY_WORDS`, and only words seen on a real wall belong there. Patterns match the whole button text after it's lower-cased and everything that isn't a
letter or digit has become a space.
Then add the label to the matching list in `tests/labels.mjs` (`reject`, `settings`, …, or `pay`). If a
similar wording must not count, add that to the `null` list (or to `pay`'s `false`). Run:

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
  and prints PASS or FAIL for each, in about 5 minutes. It reads each page once, 2 seconds after the
  extension stops watching it (30 seconds after the page loads), so a late wrong click still fails.
- **Mock banners, one by one:** open <http://127.0.0.1:8765/tests/>. On each page, keep the tab in front,
  wait 32 seconds (the extension watches a page for 30), then run `__result()` in the browser console;
  it must say `pass: true`. There are 34 pages that should be declined, 4 that should open the settings
  and then hide the banner, 10 that should be hidden without a click, 4 where nothing may be touched,
  and 5 where a decline must not be reported.
- **Labels:** `node tests/labels.mjs`. Exits with 1 if a label is classified wrong.
- **Popup:** <http://127.0.0.1:8765/tests/popup-preview.html> shows the real popup in every state.
  Add `?lang=ja` or `?lang=es` for the translations and `&repo=1` to show the Report link.
- **Syntax and consistency:** `node --check` on each file in `extension/`, `tests/harness.js`, the `.js`
  files in `tests/live/` and the `.mjs` files in `tests/`, `tests/live/` and `tools/`, then
  `node tests/check_extension.mjs` (manifest files, translations, version numbers).
- **Real sites (local only):** `npm ci`, then `npx playwright install webkit` once, then `npm run test:live`.
  It opens each site in `tests/live/sites.json` once, in Playwright's WebKit (Spanish, English and French
  banners, and a Japanese site whose banner comes up in English for visitors from the EU), runs
  `content.js` in every frame as Safari would (with a small stand-in for Safari's APIs,
  `tests/live/browser-stub.js`), and judges the consent record the site itself wrote (OneTrust's and
  Cookiebot's cookies, or the IAB TCF answer). PASS: every optional category refused. FAIL: a consent, or a
  banner that was seen but not refused (hiding it is not enough). Legitimate interest in the TCF answer is
  judged only for a site marked `"legitimateInterest": "judged"` in `sites.json`, one whose settings Cookie
  Munch opens: there every purpose's legitimate interest must be off too. For the other sites it is printed
  and not judged, because a site's own Reject button can leave it on. SKIP: a challenge or block page, which is
  never worked around, a page that didn't load or timed out, or a site that showed no banner this time. Navigation
  waits up to 30 s, and every step after the page loads up to 60 s (the title and challenge check, reading
  cookies and records, the banner check, closing the page; a busy page answers late, a frozen one never): a
  frozen site ends as SKIP with the step named, and the run goes on to the next site. A verdict already reached stands when only the closing times out. Any FAIL, or no PASS at all, exits with 1.
  Sites answer by where the visitor is, so results from outside the EU differ; it doesn't run in GitHub Actions.
  The list holds only sites Cookie Munch should decline. To check the runner itself against local pages (frozen
  pages, challenge pages and near misses, without visiting real sites), run `node tests/live/test_live.mjs`; it is
  local only as well.
- **Random switch panels (local only, for work on the switch code):** `node tests/random/run.mjs` builds
  seeded random settings panels from real switch shapes and lists the ones left with a switch on; its header
  has the options.
- **The installed extension:** open <http://127.0.0.1:8765/tests/demo.html> in Safari. That page doesn't load
  any of the extension's code; when the extension works, the page and its tab title say "✓ Rejected". Use
  `127.0.0.1`, not `localhost`. This check stays manual for now: `node tools/probe_safaridriver.mjs` asks
  Safari's own automation to open the page with the extension (it needs `safaridriver --enable` once), but
  with Safari 27.2 no session started ("The session timed out while connecting to a Safari instance"). Run
  the probe again after a Safari update.

On every push, GitHub Actions runs the label checker, the syntax and JSON checks, and
`tests/check_extension.mjs` (manifest files, translations, version numbers, safe hiding rules). When the
extension or the tests change, a macOS job also runs every mock page in WebKit. Both can also be started
by hand from the Actions tab.

## Debugging in Safari

- **Page side:** Develop menu → Show Web Inspector. The console shows lines like
  `[Cookie Munch] rejected: clicked "Reject all" (OneTrust)`.
- **Background script:** Develop menu → Web Extension Background Content → Cookie Munch.

## Building the apps

See the README for the one-time Xcode setup (`signing.local`). Then:

- `tools/build_app.sh` builds the Mac app and installs it in `/Applications`.
- `tools/install_iphone.sh` builds the iPhone app and installs it on a connected or nearby phone.

If a build fails with `Embedded binary is not signed with the same certificate as the parent app`, delete
`xcode/build.noindex` and run the script again.

## Updating the cookie list

The list changes every few days. A scheduled workflow (`.github/workflows/cookie-list.yml`) refreshes it
weekly, opens a pull request, and starts the checks and the mock pages on it. To do it by hand:

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
