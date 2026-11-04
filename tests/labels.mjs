// Checks how content.js classifies common button labels. Run: node tests/labels.mjs
// 'null' means the label must not be clicked or used at all.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('  const REJECT = ['), src.indexOf('  // Text that tells us'));
const normSrc = src.slice(src.indexOf('  const normalize ='), src.indexOf('  const kindCache'));
const { LABELS, KINDS, normalize } = new Function(`${block}\n${normSrc}\nreturn { LABELS, KINDS, normalize };`)();
const kind = (t) => KINDS.find((k) => LABELS[k].test(normalize(t))) ?? null;
const cases = {
  reject: ['Reject All', 'Reject all cookies', 'Decline', 'Decline optional cookies', 'Deny', 'Refuse all', 'Reject & Close',
    'Necessary cookies only', 'Only necessary cookies', 'Use necessary cookies only', 'Accept only essential cookies',
    'Allow essential cookies only', 'Only allow essential cookies', 'Continue without accepting', 'Do not accept', "Don't allow",
    'I disagree', 'Reject non-essential cookies', 'Object to all', 'No, thanks', 'Strictly necessary only',
    'Alle ablehnen', 'Ablehnen', 'Nur notwendige Cookies', 'Nur erforderliche Cookies akzeptieren', 'Tout refuser', 'Continuer sans accepter',
    'Refuser', 'Rechazar todo', 'Rechazar', 'Rifiuta tutto', 'Alles weigeren', 'Alleen noodzakelijke cookies', 'Rejeitar', 'Avvisa alla', 'Odrzuć wszystkie',
    'すべて拒否', '拒否する', '同意しない', '必須Cookieのみ許可', '必要なCookieのみ', 'Cookieを拒否', '全部拒绝', '모두 거부'],
  accept: ['Accept all', 'Accept All Cookies', 'Allow all', 'OK', 'Got it', 'I agree', 'Agree', 'Alle akzeptieren', 'Tout accepter', 'Aceptar', 'Accetta', '同意する', 'すべて許可', 'Yes', 'Yes, I agree'],
  settings: ['Manage preferences', 'Cookie settings', 'Cookies Settings', 'Customize', 'Manage options', 'More options', 'Einstellungen', 'Paramétrer', 'Cookie設定', '設定', 'Let me choose', 'View cookie settings', 'No, take me to settings', 'Manage cookies', 'Customise', 'Show purposes'],
  save: ['Save my choices', 'Confirm my choices', 'Allow selection', 'Save', 'Save preferences', 'Auswahl speichern', 'Enregistrer', '設定を保存'],
  null: ['Learn more', 'Privacy policy', 'Reject suggestion', 'Decline invitation', 'Subscribe', 'Accept all and close the banner forever please', 'Do not sell or share my personal information', 'Necessary cookies', 'Read more', 'Reject all and subscribe', 'Subscribe and reject', 'Open', 'View'],
};
let bad = 0;
for (const [want, list] of Object.entries(cases)) for (const t of list) {
  const got = String(kind(t));
  if (got !== want) { bad++; console.log(`WRONG  "${t}" -> ${got} (want ${want})`); }
}
console.log(bad ? `${bad} wrong` : `all ${Object.values(cases).flat().length} labels classified correctly`);
