// Issue #72: osallistujan kielivalinta muistetaan luentokohtaisesti. Yhdellä luennolla valittu FI ei saa
// ohittaa toisen luennon luennoitsijan asettamaa kieltä (English). Selaimen kieli on testissä suomi.
// Osallistujan evästeettömyyttä valvoo tests/Security (Set-Cookie); tässä selaimessa on myös hallinnan istunto.
// Ajo: scripts/e2e.sh participant-lang.mjs  (tai node tests/e2e/participant-lang.mjs <cdp-port> <app-url>)
import { tab, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Kieli A', 'en');
const urlA = await admin.js(`document.querySelector('.share .url a').href`);
await admin.click('Kaikki luennot');
await admin.waitFor(admin.has('#ev-title'), 'luentolista');
await createEvent(admin, 'E2E Kieli B', 'en');
const urlB = await admin.js(`document.querySelector('.share .url a').href`);

const part = await openParticipant(port, admin);   // luento B, selaimen kieli suomi
const settled = async (what) => {
  // lang.js voi ladata sivun uudelleen; odotetaan, että osoite ja sivun kieli pysyvät.
  await part.waitFor(`document.readyState === 'complete' && !!document.querySelector('.lang-switch')`, what);
  await new Promise((r) => setTimeout(r, 800));
  await part.waitFor(`document.readyState === 'complete'`, what);
  return part.js(`({ lang: document.documentElement.lang, search: location.search })`);
};
let s = await settled('luento B');
if (s.lang !== 'en' || s.search !== '') throw new Error('Luento B ilman valintaa: ' + JSON.stringify(s));
step('Englanninkielinen luento avautuu englanniksi suomenkielisessä selaimessa');

// Valitaan FI luennolla A.
await part.cdp('Page.navigate', { url: urlA });
s = await settled('luento A');
if (s.lang !== 'en') throw new Error('Luento A: ' + JSON.stringify(s));
await part.js(`document.querySelector('.lang-switch a[hreflang=fi]').click()`);
await part.waitFor(`document.documentElement.lang === 'fi' && location.search === '?lang=fi'`, 'FI valittu luennolla A');

// Luento B avautuu edelleen englanniksi (ennen korjausta: uudelleenohjaus ?lang=fi).
await part.cdp('Page.navigate', { url: urlB });
s = await settled('luento B valinnan jälkeen');
if (s.lang !== 'en' || s.search !== '') throw new Error('Luennon A valinta ohitti luennon B kielen: ' + JSON.stringify(s));
step('FI-valinta luennolla A ei vaikuta luentoon B: B avautuu englanniksi ilman ?lang-ohjausta');

// Luennon A valinta säilyy luennolla A.
await part.cdp('Page.navigate', { url: urlA });
s = await settled('luento A uudelleen');
if (s.lang !== 'fi' || s.search !== '?lang=fi') throw new Error('Luennon A valinta ei säilynyt: ' + JSON.stringify(s));
step('Luennolla A valittu suomi säilyy, kun luento A avataan uudelleen');

// Vanha yhteinen tallennus (ennen korjausta tallennettu) ei ohita luennon kieltä.
await part.js(`localStorage.setItem('hessutalks.lang', 'fi'); true`);
await part.cdp('Page.navigate', { url: urlB });
s = await settled('luento B vanhalla tallennuksella');
if (s.lang !== 'en' || s.search !== '') throw new Error('Vanha yhteinen tallennus ohitti luennon kielen: ' + JSON.stringify(s));
step('Vanha yhteinen tallennus (hessutalks.lang = fi) ei ohita luennon kieltä');

const errs = [...admin.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
