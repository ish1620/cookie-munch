const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const siteKey = (hostname) => hostname.replace(/^www\./, '');
const t = (key, ...subs) => api.i18n?.getMessage(key, subs) || key;

const SECONDS_PER_BANNER = 4;   // a rough guess at how long dismissing one by hand takes
const REPO_URL = globalThis.COOKIE_MUNCH_REPO_URL ?? '';

// What the content script reported for this tab → headline and detail.
const HANDLED = {
  rejected: ['headMunched', 'detailRejected'],
  'saved with optional cookies off': ['headMunched', 'detailSaved'],
  hidden: ['headHidden', 'detailHiddenDecline'],
};

function translatePage() {
  document.documentElement.lang = api.i18n?.getUILanguage?.() ?? 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

function say(headKey, detailKey, platform) {
  $('headline').textContent = t(headKey);
  $('detail').textContent = t(detailKey);
  $('platform').hidden = !platform;
  if (platform) $('platform').textContent = t('viaPlatform', platform);
}

function timeSaved(banners) {
  const seconds = banners * SECONDS_PER_BANNER;
  if (seconds < 60) return t('timeSeconds', String(seconds));
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('timeMinutes', String(minutes));
  return t('timeHours', String(Math.floor(minutes / 60)), String(minutes % 60));
}

function showStats(total) {
  const lang = api.i18n?.getUILanguage?.() ?? undefined;
  $('stat-total').textContent = new Intl.NumberFormat(lang).format(total);
  $('stat-time').textContent = timeSaved(total);
}

function setupModePicker(mode) {
  const radio = $(`mode-${mode}`) ?? $('mode-decline');
  radio.checked = true;
  const help = (value) => t(value === 'hide' ? 'helpHide' : 'helpDecline');
  $('mode-help').textContent = help(radio.value);
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener('change', async () => {
      $('mode-help').textContent = help(input.value);
      await api.storage.local.set({ mode: input.value });
      $('reload-hint').hidden = false;
    });
  }
}

function platformName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  return 'Mac';
}

// Opens a prefilled GitHub issue with the site's host name and the setup (mode, version,
// Mac/iPhone/iPad), nothing else. The person reviews it on GitHub; nothing is sent unless they submit it.
function setupReport(host, mode) {
  if (!REPO_URL || REPO_URL.includes('YOUR-NAME')) return;
  $('report-row').hidden = false;
  $('report').addEventListener('click', async () => {
    const version = api.runtime.getManifest().version;
    const params = new URLSearchParams({
      template: 'missed-banner.yml',
      title: `Missed banner: ${host}`,
      site: host,
      setup: `${mode === 'hide' ? 'Hide only' : 'Decline'} mode · Cookie Munch ${version} · Safari on ${platformName()}`,
    });
    await api.tabs.create({ url: `${REPO_URL}/issues/new?${params}` });
    window.close();
  });
}

async function main() {
  translatePage();
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const { total = 0, disabledSites = [], mode = 'decline' } =
    await api.storage.local.get({ total: 0, disabledSites: [], mode: 'decline' });
  showStats(total);
  setupModePicker(mode);

  let url = null;
  try {
    url = new URL(tab.url);
  } catch {
    // Safari hides the URL until the extension is allowed on the site.
  }

  if (!url) {
    $('site-row').hidden = true;
    say('headNeedsAccess', 'detailNeedsAccess');
    return;
  }
  if (!/^https?:$/.test(url.protocol)) {
    $('site-row').hidden = true;
    say('headNotWeb', 'detailNotWeb');
    return;
  }

  const key = siteKey(url.hostname);
  const toggle = $('site-toggle');
  $('host').textContent = key;
  toggle.checked = !disabledSites.includes(key);
  setupReport(key, mode);

  toggle.addEventListener('change', async () => {
    const { disabledSites: current = [] } = await api.storage.local.get({ disabledSites: [] });
    const next = toggle.checked ? current.filter((site) => site !== key) : [...new Set([...current, key])];
    await api.storage.local.set({ disabledSites: next });
    $('reload-hint').hidden = false;
  });

  if (!toggle.checked) {
    say('headOff', 'detailOff');
    return;
  }

  let status = null;
  try {
    status = await api.runtime.sendMessage({ type: 'getTabStatus', tabId: tab.id });
  } catch {
    // Background script not ready; treat as "nothing yet".
  }
  if (status) {
    const [head, detail] = Object.hasOwn(HANDLED, status.how) ? HANDLED[status.how] : HANDLED.rejected;
    say(head, mode === 'hide' && status.how === 'hidden' ? 'detailHiddenHide' : detail, status.platform);
    document.body.classList.add('munched');
  } else if (mode === 'hide') {
    // Banners hidden by the list's CSS never get reported, so don't claim there was none.
    say('headHideMode', 'detailHideMode');
  } else {
    say('headQuiet', 'detailQuiet');
  }
}

main().catch((error) => {
  say('headError', 'headError');
  $('detail').textContent = error.message;
});
