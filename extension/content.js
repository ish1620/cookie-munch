/*
 * Cookie Munch: content script.
 *
 * Runs on every page, and inside iframes (some consent banners live in one).
 * It never clicks "Accept". It has two modes, picked in the popup:
 *
 * Decline (default): click the banner's "Reject" button. In order, it tries:
 *   1. Known consent platforms (OneTrust, Cookiebot, ...) by their exact selectors.
 *   2. Any button whose label means "reject" in one of several languages, as long
 *      as it sits inside something that looks like a cookie banner.
 *   3. If the banner only offers "Accept" and "Settings": open the settings,
 *      switch every optional category off, and save. If the settings have no
 *      switch it can turn off, it saves nothing and leaves the banner to step 4.
 *   A few seconds in, whatever couldn't be declined is hidden (step 4).
 *
 * Hide only (like Brave): never answer the banner, just hide it, using
 * EasyList's Cookie List (see rules.js) plus the banners steps 1-3 can spot.
 */
(() => {
  'use strict';

  if (window.__cookieMunchLoaded) return;
  window.__cookieMunchLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;
  const IS_TOP = window === window.top;

  const WATCH_MS = 30000;          // keep looking this long after the page is first shown
  const SCAN_DEBOUNCE_MS = 250;    // wait this long after DOM changes before scanning
  const HEARTBEAT_MS = 1000;       // also scan on a timer (changes inside shadow DOM don't reach the observer)
  const SETTINGS_AFTER_MS = 1500;  // a banner with no reject button must sit this long before we open its settings
  const VERIFY_AFTER_MS = 1500;    // after a click, check the button went away
  const MAX_CLICKS = 4;            // give up after this many tries on one page
  const MAX_BANNER_TEXT = 8000;    // a "banner" with more text than this is probably the whole page
  const HIDE_AFTER_MS = 4000;      // Decline mode: hide what's left this long after the page is shown,
  const HIDE_AFTER_LOAD_MS = 1500; // and at least this long after it finished loading (consent scripts come late)
  const MAX_HIDE_TEXT = 3000;      // never hide an element with more text than this

  // In these web apps "Decline" can mean a meeting invite, so only the exact
  // platform selectors run there, never the label matching.
  const GENERIC_SKIP_HOSTS = [
    'mail.google.com', 'calendar.google.com',
    'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
    'teams.microsoft.com', 'teams.live.com',
  ];

  const log = (...args) => console.info('[Cookie Munch]', ...args);

  // ---------------------------------------------------------------------------
  // 1. Known consent platforms: their own "reject" buttons.
  // ---------------------------------------------------------------------------
  const KNOWN = [
    ['OneTrust', '#onetrust-reject-all-handler, .ot-pc-refuse-all-handler'],
    ['Cookiebot', '#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll'],
    ['Didomi', '#didomi-notice-disagree-button, .didomi-continue-without-agreeing, #didomi-radio-option-disagree-to-all'],
    ['Usercentrics', '[data-testid="uc-deny-all-button"]'],
    ['TrustArc', '#truste-consent-required'],
    ['Sourcepoint', '.sp_choice_type_REJECT_ALL'],
    ['Google Funding Choices', '.fc-cta-do-not-consent'],
    ['Osano', '.osano-cm-denyAll'],
    ['Complianz', '.cmplz-btn.cmplz-deny'],
    ['CookieYes', '.cky-btn-reject'],
    ['Cookie Notice', '#cn-refuse-cookie'],
    ['CookieLawInfo', '#cookie_action_close_header_reject, .cli_action_button[data-cli_action="reject"]'],
    ['iubenda', '.iubenda-cs-reject-btn'],
    ['Termly', '[data-tid="banner-decline"]'],
    ['Klaro', '.cm-btn.cn-decline, .cm-btn-decline'],
    ['Borlabs', 'a[data-cookie-refuse], a._brlbs-refuse-btn, ._brlbs-refuse-btn a'],
    ['Axeptio', '#axeptio_btn_dismiss'],
    ['consentmanager', '.cmpboxbtnno, #cmpbntnotxt'],
    ['Amazon', '#sp-cc-rejectall-link'],
    ['HubSpot', '#hs-eu-decline-button'],
    ['Shopify', '#shopify-pc__banner__btn-decline'],
    ['Cookie-Script', '#cookiescript_reject'],
    ['tarteaucitron', '#tarteaucitronAllDenied2'],
    ['CookieFirst', '[data-cookiefirst-action="reject"]'],
    ['Civic', '#ccc-reject-settings, #ccc-notify-reject'],
    ['Piwik PRO', '#ppms_cm_reject-all'],
    ['Moove GDPR', '.moove-gdpr-infobar-reject-btn'],
    ['Evidon', '#_evidon-decline-button'],
    ['Cookie Consent', '.cc-window .cc-deny'],
  ].map(([name, selector]) => ({ name, selector }));

  // ---------------------------------------------------------------------------
  // 2. Button labels. Matched against the normalized label: lower case, with
  //    punctuation turned into single spaces ("Reject & Close" -> "reject close").
  //    Every pattern must match the whole label.
  // ---------------------------------------------------------------------------
  const REJECT = [
    // English
    /^(reject|decline|deny|refuse|disallow|block|object to)( all| everything)?( (optional|non essential|nonessential|additional|unnecessary|marketing|tracking|analytics|other|third party|all))?( cookies?| tracking| trackers| purposes)?( (and )?(close|continue|save|exit))?$/,
    /^(i )?(do not|don t|dont) (accept|agree|consent|allow)( (to )?all)?( cookies)?$/,
    /^(i )?disagree( (to|with) all)?( (and )?close)?$/,
    /^(only )?(use|allow|accept|continue with|keep|save|select|agree to|consent to) (only )?(the )?(strictly )?(essential|necessary|required|functional|basic|technical|mandatory)( cookies?)?( only)?$/,
    /^(only )?(strictly )?(essential|necessary|required|functional|basic|technical)( cookies?)? only$/,
    /^only (the )?(strictly )?(essential|necessary|required|functional)( cookies?)?$/,
    /^(continue|proceed|browse) without (accepting|agreeing|consent|consenting|cookies)$/,
    /^no (thanks|thank you)$/,
    /^opt out( (of )?(all|cookies|tracking|all cookies))?$/,
    // German
    /^(alle )?(cookies )?(ablehnen|verweigern|zurückweisen)( und (schließen|fortfahren|weiter))?$/,
    /^nur (technisch )?(notwendige|erforderliche|essenzielle|essentielle|funktionale|nötige)( cookies)?( (akzeptieren|zulassen|erlauben|verwenden|annehmen|speichern))?$/,
    /^(nicht einverstanden|ich lehne ab|weiter ohne (einwilligung|zustimmung|cookies)|ohne (einwilligung|zustimmung) (fortfahren|weiter))$/,
    // French
    /^(tout |je )?(refuser|refuse)( tout| tous| les cookies| et fermer| et continuer)?$/,
    /^(tout rejeter|rejeter( tout)?|continuer sans accepter|non merci)$/,
    /^(accepter |autoriser )?(uniquement|seulement) (les )?(cookies )?(strictement )?(nécessaires|essentiels|obligatoires)$/,
    // Spanish
    /^(rechazar|denegar|rehusar)( todo| todas| todos| las cookies| todas las cookies| cookies)?$/,
    /^(no acepto|no aceptar|continuar sin aceptar)$/,
    /^(aceptar |permitir |usar )?(solo|sólo|solamente|únicamente) (las )?(cookies )?(necesarias|esenciales|técnicas|imprescindibles)$/,
    // Italian
    /^(rifiuta|rifiuto|nega|declina)( tutto| tutti| tutte| i cookie)?$/,
    /^(continua senza accettare|(accetta )?solo (i )?(cookie )?(necessari|tecnici|essenziali))$/,
    // Dutch
    /^(alles |alle )?(weigeren|afwijzen)( alles| alle cookies| cookies)?$/,
    /^(alleen|enkel) (noodzakelijke|functionele|essentiële|vereiste)( cookies)?( (accepteren|toestaan|gebruiken))?$/,
    /^(niet akkoord|ik weiger)$/,
    // Portuguese
    /^(rejeitar|recusar)( tudo| todos| todos os cookies| cookies)?$/,
    /^(aceitar |permitir )?(apenas|somente|só) (os )?(cookies )?(necessários|essenciais)$/,
    // Nordic, Polish, Czech, Hungarian, Romanian, Russian, Greek
    /^(avvisa|neka|avböj|afvis|avvis|afslå|hylkää|odrzuć|odmów|odmítnout|zamítnout|elutasít|elutasítás|respinge|отклонить|απόρριψη)( alla| alle| kaikki| wszystkie| wszystko| vše| mindet| toate| все| όλων)?$/,
    /^(endast|kun|bare|vain|tylko) (nödvändiga|nødvendige|välttämättömät|niezbędne)( cookies| kakor| evästeet)?$/,
    // Japanese
    /^(すべて|全て|全部)?(を)?(拒否|拒絶)(する|します)?$/,
    /^(cookie|クッキー)(を|の使用を)?(すべて|全て)?拒否(する|します)?$/,
    /^同意(しない|しません)$/,
    /^(許可|承諾)しない$/,
    /^(必須|必要|必要な|必須の|最低限の|必要最低限の)(cookie|クッキー)?(のみ|だけ)(を)?(許可|受け入れ|受け入れる|同意|使用|承諾|有効)?(する|にする)?$/,
    // Chinese, Korean
    /^(全部|全部的)?(拒绝|拒絕)(全部|所有)?$/,
    /^(仅|只|僅)(接受|允许|允許)?(必要|必需)(的)?(cookie)?$/,
    /^不同意$/,
    /^(모두 )?거부(하기)?$/,
    /^필수( 쿠키)?만( 허용)?$/,
    /^동의하지 않음$/,
  ];

  const SAVE = [
    /^(save|confirm|submit|apply|done)( (and )?(exit|close|continue))?$/,
    /^(save|confirm|submit|apply) (my |your )?(choices?|preferences|settings|selection|consent)( (and )?(exit|close))?$/,
    /^(accept|allow|agree to) (the )?(selected|selection|current selection|chosen)( cookies)?$/,
    /^(speichern|bestätigen|übernehmen|auswahl (speichern|bestätigen|erlauben|akzeptieren|zulassen|übernehmen)|einstellungen speichern|ausgewählte akzeptieren)$/,
    /^(enregistrer|valider|confirmer)( mes choix| la sélection| mes préférences| et fermer)?$/,
    /^(guardar|confirmar|aceptar selección|aceptar seleccionadas|permitir selección)( (mis )?(preferencias|selección|configuración|ajustes|cambios))?$/,
    /^(salva|conferma|accetta selezionati|consenti selezione)( (le )?(preferenze|impostazioni|scelte))?$/,
    /^(opslaan|bevestigen|keuze opslaan|voorkeuren opslaan|selectie toestaan)$/,
    /^(設定を保存|保存|選択を保存|確定|設定を確定|この設定で(同意|許可))(する)?$/,
    /^選択(した)?(項目|もの)?(を)?(許可|保存|同意)(する)?$/,
  ];

  const SETTINGS = [
    /^(manage|customi[sz]e|change|adjust|edit|review|configure|view|show|open|see)( my| your| the)?( cookie| cookies| privacy| consent)?( settings| preferences| options| choices| cookies| consent| purposes| partners| vendors)$/,
    /^(manage|customi[sz]e|change|adjust|edit|review|configure)$/,
    /^no( thanks)? (take me to|show me|go to|let me see) (the )?(cookie |privacy )?(settings|options|choices|preferences)$/,
    /^(cookies?|privacy|consent)( settings| preferences| options| choices)$/,
    /^(settings|preferences|options|more options|let me choose|show details|details|show purposes)$/,
    /^(einstellungen|anpassen|mehr optionen|optionen|individuelle einstellungen|cookie einstellungen|einstellungen verwalten|präferenzen|konfigurieren)$/,
    /^(paramétrer|personnaliser|paramètres|gérer( mes choix| les cookies| les préférences)?|plus d options|préférences)$/,
    /^(configurar|personalizar|preferencias|configuración|más opciones|gestionar( cookies| preferencias)?|ajustes)$/,
    /^(gestisci( preferenze| opzioni)?|personalizza|impostazioni|preferenze|più opzioni|opzioni)$/,
    /^(instellingen|aanpassen|beheren|voorkeuren|meer opties|cookie instellingen)$/,
    /^(cookie|クッキー)?(の)?(設定|詳細設定|カスタマイズ|管理|設定を変更|設定を管理|設定する)$/,
  ];

  // Only used to notice that a banner is showing. Never clicked.
  const ACCEPT = [
    /^(accept|agree|allow|ok|okay|got it|i agree|i accept|yes|understood|i understand|consent|continue)( all| everything)?( cookies)?( (and )?(close|continue))?$/,
    /^(yes|ok|okay) i (agree|accept|understand)( to all)?$/,
    /^(alle )?(cookies )?(akzeptieren|zustimmen|annehmen|zulassen|erlauben)( und (schließen|weiter|fortfahren))?$/,
    /^(einverstanden|ich stimme zu|alles akzeptieren|verstanden)$/,
    /^(tout )?(accepter|j accepte)( tout| et fermer| et continuer| les cookies)?$/,
    /^(aceptar|acepto)( todo| todas| todas las cookies| y cerrar| y continuar| cookies)?$/,
    /^(accetta|accetto)( tutti| tutto| e chiudi)?$/,
    /^(alles |alle cookies )?(accepteren|toestaan)$|^(akkoord|ik ga akkoord)$/,
    /^(aceitar|concordo)( tudo| todos)?$/,
    /^(すべて|全て)?(を)?(同意|許可|承諾|受け入れ|受け入れる)(する|します)?$/,
    /^同意して(閉じる|続ける)$/,
    /^(全部)?(接受|同意)(全部|所有)?$/,
    /^(모두 )?(동의|허용|수락)$/,
  ];

  const combine = (list) => new RegExp(list.map((re) => `(?:${re.source})`).join('|'), 'u');
  const LABELS = { reject: combine(REJECT), save: combine(SAVE), settings: combine(SETTINGS), accept: combine(ACCEPT) };
  const KINDS = ['reject', 'save', 'settings', 'accept']; // checked in this order

  // Text that tells us an element is a cookie banner. Needs a cookie/consent
  // word plus some privacy-ish context, so a "Cookie party" invite doesn't count.
  const COOKIE_WORDS = /cookie|クッキー|쿠키|kakor|evästeet|ciasteczk|consent|einwilligung|consentement|consentimiento|consenso|toestemming|samtycke|samtykke|zgod|gdpr|rgpd|dsgvo|traceurs|トラッキング|tracking technolog|store and.or access information/i;
  const CONTEXT_WORDS = /privacy|privacidad|confidentialit|datenschutz|partner|vendor|third.part|personali|advertis|analytic|marketing|track|experience|we use|website|site|data|daten|données|datos|dati|gegevens|information|device|navigat|service|プライバシー|個人|情報|利用|使用|広告|分析|サイト|개인|광고|정보|隐私|个人|信息|广告/i;
  const CONSENT_ATTR = /cookie|consent|gdpr|ccpa|cmp|privacy|truste|onetrust|didomi|usercentrics|cybot|osano|iubenda|termly|klaro|borlabs|axeptio/i;

  const CLICKABLE = 'button, [role="button"], input[type="button"], input[type="submit"], a, [onclick], [tabindex], [class*="btn" i], [class*="button" i]';
  const TOGGLES = 'input[type="checkbox"], [role="switch"], [role="checkbox"]';
  const TOGGLE_BUTTONS = 'button[aria-pressed], [role="button"][aria-pressed]'; // pressed = on

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const normalize = (text) =>
    text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const kindCache = new Map();
  function kindOfLabel(label) {
    if (!label || label.length > 60) return null;
    if (!kindCache.has(label)) kindCache.set(label, KINDS.find((k) => LABELS[k].test(label)) ?? null);
    return kindCache.get(label);
  }

  function kindOf(el) {
    const raw = el instanceof HTMLInputElement ? el.value || '' : el.textContent || '';
    if (raw.length > 150) return null; // too long to be a button
    const fromText = kindOfLabel(normalize(raw));
    if (fromText) return fromText;
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    return aria ? kindOfLabel(normalize(aria)) : null;
  }

  // Parent element, stepping out of shadow roots.
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  // The document plus every open shadow root in it.
  function allRoots(start = document) {
    const roots = [start];
    for (let i = 0; i < roots.length && roots.length < 300; i++) {
      for (const el of roots[i].querySelectorAll('*')) {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    }
    return roots;
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
  }

  // True if clicking would load another page. A link styled as a button (role="button") still
  // navigates, so only its href counts: empty, "#…", "javascript:" or this same page are safe.
  function leavesPage(el) {
    const link = el.closest('a[href]');
    if (!link) return false;
    const href = link.getAttribute('href').trim();
    if (href === '' || href.startsWith('#') || /^javascript:/i.test(href)) return false;
    try {
      return new URL(href, location.href).href.split('#')[0] !== location.href.split('#')[0];
    } catch {
      return true;
    }
  }

  function isOverlay(node) {
    const role = node.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog' || node.getAttribute('aria-modal') === 'true' ||
        node.tagName === 'DIALOG') return true;
    const position = getComputedStyle(node).position;
    return position === 'fixed' || position === 'sticky';
  }

  function hasConsentAttr(node) {
    const attrs = `${node.tagName} ${node.id} ${node.getAttribute('class') || ''} ${node.getAttribute('aria-label') || ''} ${node.getAttribute('aria-labelledby') || ''}`;
    return CONSENT_ATTR.test(attrs);
  }

  function hasConsentText(visibleText, extraText = '') {
    if (visibleText.length > MAX_BANNER_TEXT) return false;
    const text = `${visibleText} ${extraText}`;
    return COOKIE_WORDS.test(text) && CONTEXT_WORDS.test(text);
  }

  let textCache = new Map(); // reset on every scan
  function looksLikeBanner(node) {
    if (!textCache.has(node)) {
      const visible = node.innerText || node.textContent || '';
      const shadow = node.shadowRoot ? node.shadowRoot.textContent || '' : '';
      textCache.set(node, hasConsentText(visible, shadow));
    }
    return textCache.get(node);
  }

  // Inside a frame that is itself the consent dialog (Sourcepoint, TrustArc),
  // or on a dedicated consent page (consent.google.com, consent.youtube.com).
  function wholePageIsConsent() {
    if (/^consent\./.test(location.hostname)) return true;
    if (IS_TOP || !document.body) return false;
    if (!textCache.has('page')) {
      const text = document.body.innerText || '';
      textCache.set('page', text.length > 0 && hasConsentText(text));
    }
    return textCache.get('page');
  }

  // Selectors EasyList's Cookie List has for this site (filled in by start()).
  let siteRule = '';
  const matchesSiteRule = (node) => siteRule !== '' && node.matches(siteRule);

  // The element that makes `el` part of a cookie banner, or null.
  function bannerOf(el) {
    for (let node = parentOf(el), depth = 0; node && depth < 30; node = parentOf(node), depth++) {
      if (node === document.body || node === document.documentElement) break;
      if (matchesSiteRule(node)) return node;
      if ((isOverlay(node) || hasConsentAttr(node)) && looksLikeBanner(node)) return node;
    }
    return wholePageIsConsent() ? document.body : null;
  }

  // The banner's category switches: checkboxes, switches, and toggle buttons. A toggle button
  // labelled like one of the banner's own buttons (Accept, Save, Settings, Reject) is not a switch.
  function switchesIn(banner) {
    return allRoots(banner)
      .flatMap((root) => [...root.querySelectorAll(`${TOGGLES}, ${TOGGLE_BUTTONS}`)])
      .filter((box) => !box.matches(TOGGLE_BUTTONS) || !kindOf(box));
  }

  function isOn(box) {
    if (box instanceof HTMLInputElement) return box.checked;
    return box.getAttribute(box.matches(TOGGLES) ? 'aria-checked' : 'aria-pressed') === 'true';
  }

  const isLocked = (box) =>
    box.disabled || box.getAttribute('aria-disabled') === 'true' || box.hasAttribute('readonly');

  const hasToggles = (banner) => switchesIn(banner).length > 0;
  const canSwitchOff = (banner) => switchesIn(banner).some((box) => !isLocked(box));

  // When a button and an element inside it both match, keep the inner one.
  const innermost = (list) => list.filter((a) => !list.some((b) => b !== a && a.el.contains(b.el)));

  function pickBest(list) {
    const score = ({ el, label }) =>
      (/\b(all|alle|tout|todo|tutto)\b|すべて|全て/.test(label) ? 2 : 0) +
      (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ? 1 : 0);
    return list.reduce((best, item) => (score(item) > score(best) ? item : best));
  }

  // ---------------------------------------------------------------------------
  // Finding buttons
  // ---------------------------------------------------------------------------
  const tried = new WeakSet();

  function findKnown(roots) {
    for (const { name, selector } of KNOWN) {
      for (const root of roots) {
        for (const el of root.querySelectorAll(selector)) {
          if (!tried.has(el) && isVisible(el)) return { el, name };
        }
      }
    }
    return null;
  }

  function findLabelled(roots) {
    const found = { reject: [], save: [], settings: [], accept: [] };
    const seen = new Set();
    for (const root of roots) {
      for (const el of root.querySelectorAll(CLICKABLE)) {
        if (seen.has(el) || tried.has(el)) continue;
        seen.add(el);
        const kind = kindOf(el);
        if (!kind || !isVisible(el) || leavesPage(el)) continue;
        const banner = bannerOf(el);
        const text = el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (banner) found[kind].push({ el, banner, label: normalize(text) });
      }
    }
    for (const kind of KINDS) found[kind] = innermost(found[kind]);
    return found;
  }

  // ---------------------------------------------------------------------------
  // Acting
  // ---------------------------------------------------------------------------
  // looking -> (settings: we opened the banner's settings) -> verifying (we clicked; did it work?) -> done
  let stage = 'looking';
  let clicks = 0;
  let bannerSeenAt = 0;
  let settingsOpenedAt = 0;
  let waitUntil = 0;
  let reported = null;        // what the background script was told: null, 'hidden', or a decline
  let loadedAt = document.readyState === 'complete' ? 0 : null;
  addEventListener('load', () => { loadedAt = Date.now(); }, { once: true });

  // Message the background script; undefined if it can't be reached.
  async function send(message) {
    try {
      return await api?.runtime?.sendMessage(message);
    } catch {
      return undefined; // the extension was reloaded, or this page can't talk to it
    }
  }

  // Tell the background script (for the ✓ and the popup). A decline may follow an earlier "hidden".
  function report(platform, how) {
    if (reported && (reported !== 'hidden' || how === 'hidden')) return;
    reported = how;
    send({ type: 'declined', platform, how });
  }

  function click(el) {
    tried.add(el);
    clicks++;
    el.click();
  }

  // Click a reject/save button, then check a moment later that it went away. Only then
  // does it count as declined.
  function finish(el, platform, how, previous = stage) {
    log(`${how}: clicked "${(el.textContent || el.value || el.getAttribute('aria-label') || '').trim()}"`, platform ? `(${platform})` : '');
    click(el);
    stage = 'verifying';
    setTimeout(() => {
      if (isVisible(el) && clicks < MAX_CLICKS) {
        log('banner still showing, trying another button');
        stage = previous;
        schedule(0);
      } else {
        if (!isVisible(el)) report(platform, how);
        stage = 'done';
        stop();
        hideLeftovers(); // tidy up anything the banner left behind
      }
    }, VERIFY_AFTER_MS);
  }

  function switchOffAndSave(save) {
    let switched = 0;
    for (const box of switchesIn(save.banner)) {
      if (isOn(box) && !isLocked(box)) {
        box.click();
        switched++;
      }
    }
    log(`switched off ${switched} optional categories`);
    const previous = stage;
    stage = 'verifying';
    setTimeout(() => finish(save.el, null, 'saved with optional cookies off', previous), 300);
  }

  // ---------------------------------------------------------------------------
  // Hiding (Decline mode's last step, and all of Hide-only mode)
  // ---------------------------------------------------------------------------
  const hiddenBanners = new WeakSet();
  const askedToHide = { site: false, generic: false };
  let hideTimer = null;

  // Ask the background script to add the list's hiding CSS to this frame. Generic
  // rules (the ones for every site) go to the main page and to consent iframes only.
  async function requestHide() {
    const generic = IS_TOP || wholePageIsConsent();
    const want = { site: !askedToHide.site, generic: generic && !askedToHide.generic };
    if (!want.site && !want.generic) return;
    askedToHide.site = true;
    askedToHide.generic ||= want.generic;
    const reply = await send({ type: 'hide', host: location.hostname, ...want });
    if (reply?.css) {
      // The background script couldn't add it itself; add it as a <style> element.
      const style = document.createElement('style');
      style.textContent = reply.css;
      (document.head || document.documentElement).append(style);
    }
  }

  function safeToHide(banner) {
    return banner !== document.body && banner !== document.documentElement &&
      (banner.innerText || '').length <= MAX_HIDE_TEXT &&
      !banner.querySelector('main, article, nav, input[type="password"], input[type="search"]');
  }

  // Hide banners that the label search found (ones the list may not know about).
  function hideBanners(found) {
    let count = 0;
    for (const { banner } of KINDS.flatMap((kind) => found[kind])) {
      if (hiddenBanners.has(banner) || !safeToHide(banner)) continue;
      hiddenBanners.add(banner);
      banner.style.setProperty('display', 'none', 'important');
      count++;
    }
    if (count) {
      log(`hid ${count} cookie banner${count > 1 ? 's' : ''}`);
      report(null, 'hidden');
      unlockScroll();
    }
  }

  // Hide-only mode: consent dialogs that live in an iframe (Sourcepoint, TrustArc, ...).
  // From the main page the only option is to hide the frame's pop-up container.
  // Only frames from known consent hosts, and only inside a pop-up, so ordinary
  // embeds (like youtube-nocookie.com videos) are never touched.
  const CONSENT_FRAME = /sp_message|sourcepoint|privacy-mgmt\.com|consensu\.org|trustarc|truste\.com|\/\/consent\.|\/\/cmp\./i;
  function hideConsentFrames() {
    if (!IS_TOP) return;
    for (const frame of document.querySelectorAll('iframe')) {
      const name = `${frame.id} ${frame.name} ${frame.title} ${frame.getAttribute('src') || ''}`;
      if (!CONSENT_FRAME.test(name) || !isVisible(frame)) continue;
      let popup = isOverlay(frame) ? frame : null;
      for (let node = frame.parentElement, depth = 0; !popup && node && node !== document.body && depth < 5; node = node.parentElement, depth++) {
        if (isOverlay(node)) popup = node;
      }
      if (!popup || hiddenBanners.has(popup)) continue;
      hiddenBanners.add(popup);
      popup.style.setProperty('display', 'none', 'important');
      log('hid a consent dialog in an iframe');
      report(null, 'hidden');
      unlockScroll();
    }
  }

  // Many banners freeze page scrolling while they're open. When one is hidden
  // instead of answered, it never unfreezes it, so undo that.
  // They mark <html> or <body> (a class like "sp-message-open", or an inline style naming the
  // tool), then pin the page with overflow: hidden and/or position: fixed. Only undo it when
  // such a mark is there.
  const SCROLL_LOCK = /cookie|consent|gdpr|cmp|didomi|onetrust|truste|cybot|usercentrics|sp-message|qc-cmp|osano|cmplz/i;
  function unlockScroll() {
    const html = document.documentElement;
    const body = document.body;
    const marked = [html, body].some((el) => el && SCROLL_LOCK.test(`${el.getAttribute('class') || ''} ${el.getAttribute('style') || ''}`));
    if (!marked) return;
    let unlocked = false;
    for (const el of [html, body]) {
      if (!el) continue;
      const style = getComputedStyle(el);
      if (style.overflow.includes('hidden') || style.overflowY === 'hidden') {
        el.style.setProperty('overflow', 'visible', 'important');
        unlocked = true;
      }
      if (style.position === 'fixed') {
        el.style.setProperty('position', 'static', 'important');
        unlocked = true;
      }
    }
    if (unlocked) {
      html.style.setProperty('height', 'auto', 'important');
      log('unfroze page scrolling');
    }
  }

  // Decline mode: after the decline attempts, hide whatever is still showing. Wait (up to 6 s
  // more) while a decline is under way or may still come: a banner appeared moments ago and
  // its settings flow hasn't started yet, or the page is still loading its scripts.
  function hideLeftovers(attempt = 0) {
    if (hideTimer === 'done') return;
    const now = Date.now();
    const declining = stage === 'settings' || stage === 'verifying'
      || (stage === 'looking' && bannerSeenAt > 0 && now - bannerSeenAt < SETTINGS_AFTER_MS + 1000);
    const loading = loadedAt === null || now - loadedAt < HIDE_AFTER_LOAD_MS;
    if ((declining || loading) && attempt < 6) {
      hideTimer = setTimeout(() => hideLeftovers(attempt + 1), 1000);
      return;
    }
    clearTimeout(hideTimer);
    hideTimer = 'done';
    requestHide();
    if (!genericOff) {
      textCache = new Map();
      hideBanners(findLabelled(allRoots()));
    }
    unlockScroll();
    setTimeout(unlockScroll, 1500);
  }

  function scan() {
    if (stopped || stage === 'done' || stage === 'verifying') return;
    const now = Date.now();
    if (now < waitUntil) return schedule(waitUntil - now);
    if (clicks >= MAX_CLICKS) return stop();
    textCache = new Map();
    const roots = allRoots();

    if (mode === 'hide') {
      if (!genericOff) hideBanners(findLabelled(roots));
      hideConsentFrames();
      return;
    }

    const known = findKnown(roots);
    if (known) return finish(known.el, known.name, 'rejected');

    if (genericOff) return;
    const found = findLabelled(roots);
    if (found.reject.length) return finish(pickBest(found.reject).el, null, 'rejected');

    const bannerUp = found.accept.length || found.settings.length || found.save.length;
    if (!bannerUp) {
      bannerSeenAt = 0;
      return;
    }
    bannerSeenAt ||= now;

    if (stage === 'looking' && now - bannerSeenAt >= SETTINGS_AFTER_MS) {
      // Some banners show the category switches right away, next to a "Save" button.
      const save = found.save.find((item) => hasToggles(item.banner));
      if (save) return switchOffAndSave(save);
      const settings = found.settings[0];
      if (settings) {
        log('no reject button, opening the banner settings');
        click(settings.el);
        stage = 'settings';
        settingsOpenedAt = now;
        waitUntil = now + 1000;
        return schedule(1000);
      }
    }

    // Save only if the settings have a switch it can turn off; saving without one would keep the
    // site's defaults. Otherwise the banner stays in this stage and the hide step hides it.
    if (stage === 'settings' && now - settingsOpenedAt >= 1000) {
      const save = found.save.find((item) => canSwitchOff(item.banner));
      if (save) return switchOffAndSave(save);
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------
  let timer = null;
  let stopped = false;
  let observer = null;
  let heartbeat = null;
  let deadline = null;
  let genericOff = false;
  let mode = 'decline';

  function schedule(delay = SCAN_DEBOUNCE_MS) {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        scan();
      } catch (error) {
        log('scan failed', error);
      }
    }, delay);
  }

  function stop() {
    stopped = true;
    observer?.disconnect();
    clearInterval(heartbeat);
    clearTimeout(deadline);
    clearTimeout(timer);
  }

  function siteHost() {
    if (IS_TOP) return location.hostname;
    const ancestors = location.ancestorOrigins;
    if (ancestors?.length) {
      try { return new URL(ancestors[ancestors.length - 1]).hostname; } catch {}
    }
    try { return new URL(document.referrer).hostname; } catch {}
    return location.hostname;
  }

  const domReady = () => (document.readyState !== 'loading' ? Promise.resolve()
    : new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true })));

  // The list's selectors for this site, minus any this browser can't parse.
  async function loadSiteRule() {
    const selectors = (await send({ type: 'siteSelectors', host: location.hostname })) ?? [];
    return selectors.filter((selector) => {
      try {
        document.querySelector(selector);
        return true;
      } catch {
        return false;
      }
    }).join(', ');
  }

  async function start() {
    if (!(document.documentElement instanceof HTMLElement)) return; // XML, SVG, etc.
    const host = siteHost();
    let settings = {};
    try {
      settings = (await api?.storage?.local.get({ disabledSites: [], mode: 'decline' })) ?? {};
    } catch {}
    if ((settings.disabledSites ?? []).includes(host.replace(/^www\./, ''))) return;
    mode = settings.mode === 'hide' ? 'hide' : 'decline';
    genericOff = GENERIC_SKIP_HOSTS.includes(host);

    if (mode === 'hide') requestHide(); // as early as possible, before the banner is drawn
    await domReady();
    siteRule = await loadSiteRule();
    if (mode === 'hide') {
      requestHide(); // now that the page exists, consent iframes also get the generic rules
      const unfreeze = setInterval(unlockScroll, 1000);
      setTimeout(() => clearInterval(unfreeze), 10000);
    }

    observer = new MutationObserver(() => schedule());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'],
    });
    heartbeat = setInterval(() => schedule(0), HEARTBEAT_MS);

    // Background tabs: start the countdowns when the page is first shown.
    const onShown = () => {
      deadline ??= setTimeout(stop, WATCH_MS);
      if (mode === 'decline') hideTimer ??= setTimeout(hideLeftovers, HIDE_AFTER_MS);
    };
    if (document.hidden) document.addEventListener('visibilitychange', onShown, { once: true });
    else onShown();

    schedule(0);
  }

  start();
})();
