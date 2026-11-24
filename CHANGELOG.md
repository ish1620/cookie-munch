# Changelog

## Unreleased

- Settings panels now read Sourcepoint's class-only switches, BigID's switches (whose `aria-checked` stays
  `false`), and on/off radio pairs (native radio inputs or ARIA radiogroups). A panel that still holds an
  unlocked control Cookie Munch cannot read (`aria-pressed` or `aria-checked` outside recognised switches,
  or radios outside an on/off pair, checked again right before Save) is no longer saved: it is hidden and
  reported as hidden instead. Locked controls (including through a disabled `fieldset`) never block a save
  and are never clicked.
- When a decline loads a new page on the same site with the banner on it again, Cookie Munch no longer
  declines again there: for 10 seconds after a decline, a page of the same site only hides its banner, and
  so do its frames. Confirmed on test pages in WebKit; not yet verified in Safari itself.
- A decline made inside an iframe is now reported when the page around it removes the frame or
  hides it after the reject click. Confirmed on test pages in WebKit; not yet verified in Safari
  itself.
- Pay-or-consent walls: a button that costs money or a subscription ("Rechazar por 36€ / año",
  "Refuser et s'abonner") is not clicked, where its label uses the pay words seen on such walls so
  far. Where the banner still offers a free refusal (a plain reject button, or settings with
  switches and a Save), Cookie Munch takes it; where it can't be refused, the banner is hidden as
  any banner that can't be declined (a box whose only recognised button is the pay button is left
  to the cookie list's rules), and in Decline mode the popup now says the site offered only pay or
  accept (in English, Japanese and Spanish; Hide-only mode keeps its existing wording).
- Buttons that move around a settings panel ("PARTNERS", "BACK") are no longer taken for switches.
- A settings panel whose switches Cookie Munch can't turn off is no longer saved with the site's defaults.
  The banner is hidden instead, and the popup says it was hidden.
- Settings panels that use toggle buttons (`aria-pressed`) are now switched off and saved.
- When it saves a banner's settings, Cookie Munch now also opens the panel's "Legitimate interest" view,
  objects to everything there, and then saves. This works on English panels from InMobi ("Object all") and
  Sourcepoint (plain switches, and switches made of an "Off" and an "On" half).
- A switch that holds another switch, such as a styled switch around the real checkbox or a custom element
  with a checkbox in its shadow DOM (Element UI, Quasar, Ionic), is now clicked once. Clicked as two
  switches, Ionic's ended up on again.
- After "Object all" in a "Legitimate interest" view, and after each switch it clicks, Cookie Munch waits
  a moment before it reads the next switch, so one that another control turned off is not clicked back on.
- Tests: each mock page is judged once, after the extension stops watching it, so a late wrong click fails.
  New pages cover settings panels, and a mock page can load a second page and be judged there.
- Tests: the label checker exits with 1 when a label is classified wrong.
- The weekly cookie-list pull request starts its own checks.
- Tests: `npm run test:live` checks real EU sites from your own Mac and judges each by the consent record
  the site wrote, not by its banner going away.

## 1.3.0 — 2026-11-04

First public version.

- The popup shows the mascot, says what happened on the page in plain words, and counts banners handled
  and the time that saved (at about 4 seconds a banner).
- "Missed a banner here? Report it" opens a prefilled GitHub issue with the site's name and setup.
- Popup and store text in English, Japanese and Spanish.
- The Mac and iPhone app shows step-by-step setup.
- Banners that show up late, or on pages that are slow to load, now get declined instead of hidden:
  hiding what's left waits until the page has loaded and any decline in progress has finished.
- The ✓ and the popup only say a banner was declined once it actually went away.
- The Xcode project, targets and schemes are named Cookie Munch.
- The bundled cookie-list rules are shared under CC BY-SA 3.0 (see THIRD_PARTY_NOTICES.md).
- Safety: a link styled as a button is never clicked if it would leave the page; hiding rules that aren't
  plain selectors are dropped, both when the list is converted and when it's loaded; the background script
  only acts on messages shaped like its own; the Mac app no longer has network access at all.

Earlier versions were private development builds.
