# Changelog

## Unreleased

- A settings panel whose switches Cookie Munch can't turn off is no longer saved with the site's defaults.
  The banner is hidden instead, and the popup says it was hidden.
- Settings panels that use toggle buttons (`aria-pressed`) are now switched off and saved.
- Tests: each mock page is judged once, after the extension stops watching it, so a late wrong click fails.
  Two new pages cover settings panels.
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
