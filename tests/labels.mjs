// Checks how content.js classifies common button labels, and which ones its pay check (isPayText) takes
// for a pay-or-consent wall's pay button. Run: node tests/labels.mjs   (exits with 1 if any is wrong)
// 'null' means the label must not be clicked or used at all.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('  const REJECT = ['), src.indexOf('  // Text that tells us'));
const normSrc = src.slice(src.indexOf('  const normalize ='), src.indexOf('  const kindCache'));
const { LABELS, KINDS, normalize, isPayText } = new Function(`${block}\n${normSrc}\nreturn { LABELS, KINDS, normalize, isPayText };`)();
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
  legit: ['Legitimate interest', 'LEGITIMATE INTEREST', 'Legitimate interests', 'Legitimate interest purposes'],
  object: ['OBJECT ALL', 'Object to all legitimate interests', 'Object to legitimate interest'],
  nav: ['PARTNERS', 'BACK', 'Partners', 'Back'],
  null: ['Learn more', 'Privacy policy', 'Reject suggestion', 'Decline invitation', 'Subscribe', 'Accept all and close the banner forever please', 'Do not sell or share my personal information', 'Necessary cookies', 'Read more', 'Reject all and subscribe', 'Subscribe and reject', 'Open', 'View',
    'Legitimate', 'Legitimate interest purposes and vendors', 'Object', 'Objects', 'Objection', 'Remove objection',
    'Learn more about legitimate interest', 'Accept legitimate interest', 'Purposes', 'Features', 'Site vendors', 'User consent',
    'Back to top', 'Our partners'],
};
// The pay check reads the button's text as it is (a price keeps its sign). Pay labels as seen on real
// walls; the others are plain rejects and near misses that must not count.
const pay = {
  true: ['Rechazar y suscribirse', 'Suscribirme y rechazar', 'Rechaza y suscríbete por 9€/mes', 'Rechazar y pagar',
    'Rechazar por 36€ / año', "Refuser et s'abonner", 'REJECT ALL AND PAY'],
  false: ['Rechazar', 'Rechazar todo', 'Refuser', 'Disagree and close', 'Reject all', 'Reject all 3 partners',
    'Rechazar en esta página', 'Decline and go to page 2'],
};
let bad = 0;
for (const [want, list] of Object.entries(cases)) for (const t of list) {
  const got = String(kind(t));
  if (got !== want) { bad++; console.log(`WRONG  "${t}" -> ${got} (want ${want})`); }
}
for (const [want, list] of Object.entries(pay)) for (const t of list) {
  const got = String(isPayText(t));
  if (got !== want) { bad++; console.log(`WRONG  "${t}" -> pay ${got} (want pay ${want})`); }
}
const total = Object.values(cases).flat().length + Object.values(pay).flat().length;
console.log(bad ? `${bad} wrong` : `all ${total} labels classified correctly`);
process.exitCode = bad ? 1 : 0;
