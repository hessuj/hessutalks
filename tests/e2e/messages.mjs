// Vapaat kysymykset ja palautteet: nimimerkki, salatut viestit hallinnan listaan ja nimimerkin viestiraja.
// Regressio (Hessun testi 28.10.): hidas palvelin + ajastin + esitysikkunan tahdistus hakivat samat
// viestit päällekkäin. Lista näytti osan viesteistä kahdesti, ja jos hitaampi haku palasi viimeisenä,
// sen vanha tilaluettelo pudotti juuri saapuneen viestin pysyvästi pois.
// Ajo: scripts/e2e.sh messages.mjs  (tai node tests/e2e/messages.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Messages', 'en');

// Hidas ja epätasainen palvelin hallinnalle (kuten jaettu palvelin kuormassa): joka toinen viestihaun
// vastaus viivästyy 3 s, joka toinen 0,1 s. Päällekkäiset haut palaavat siis väärässä järjestyksessä:
// vanhempi vastaus (tilaluettelo ennen uutta viestiä) käsitellään viimeisenä.
await admin.js(`(() => {
  const f = window.fetch;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  let n = 0;
  window.fetch = (u, o) => {
    if (!String(u).includes('/questions')) return f(u, o);
    const ms = n++ % 2 === 0 ? 3000 : 100;
    return f(u, o).then((res) => delay(ms).then(() => res));
  };
  return true;
})()`);
await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys');   // esitysikkunan tahdistusviestit hallinnalle
step('Hallinta ja esitysikkuna auki, viestihaun vastaukset palaavat väärässä järjestyksessä (3 s / 0,1 s)');

const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
const send = async (text) => {
  await part.js(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetyksen tila');
  return part.js(`document.getElementById('status').textContent`);
};
await part.fill('#nickname', 'Tester_1');
// Nopeasti peräkkäin (kuten Hessun sotkutekstit): jokainen viesti on uusi, kun hallinnan haut ovat kesken.
const texts = ['sdkfjsaljsaldjfk', 'Mitä on zero trust?', 'asdasdfwerwer', 'Kolmas viesti', 'qwerqwer', 'Neljäs viesti', 'zxcvzxcv', 'Viides viesti'];
for (const text of texts) {
  const status = await send(text);
  if (/error|fail|too many/i.test(status)) throw new Error(`Viesti "${text}" ei mennyt läpi: ${status}`);
  await sleep(150 + Math.random() * 900);
}
step(`Osallistuja (Tester_1) lähetti ${texts.length} viestiä, myös "sdkfjsaljsaldjfk"`);

const counts = () => admin.js(`(() => {
  const items = [...document.querySelectorAll('ul.questions > li')].map((li) => li.innerText);
  return ${JSON.stringify(texts)}.map((t) => items.filter((s) => s.split('\\n').some((line) => line.trim() === t)).length);
})()`);
await admin.js(`document.getElementById('tab-btn-question').click()`);
await sleep(8000);   // useita päällekkäisiä päivityksiä
const c = await counts();
if (c.some((n) => n !== 1)) throw new Error('Viestit listassa (pitää olla kerran kukin): ' + JSON.stringify(Object.fromEntries(texts.map((t, i) => [t, c[i]]))));
step('Hallinta näyttää jokaisen viestin tasan kerran, vaikka päivitykset menevät päällekkäin');

// Issue #60: viestikohtainen Näytä taululla / Poista taululta; taululla voi olla useita viestejä yhtä aikaa.
const msgButton = (text, label) => admin.js(`(() => {
  const li = [...document.querySelectorAll('#tab-question li.q')].find((x) => x.querySelector('.q-text')?.textContent === ${JSON.stringify(text)});
  const b = li && [...li.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(label)});
  if (!b) throw new Error('nappi puuttuu: ' + ${JSON.stringify(label)} + ' / ' + ${JSON.stringify(text)});
  b.click(); return true; })()`);
const tiles = () => stage.js(`[...document.querySelectorAll('.tile-question .stage-q')].map((e) => e.textContent)`);
await msgButton('Mitä on zero trust?', 'Näytä taululla');
await msgButton('Kolmas viesti', 'Näytä taululla');
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 2`, 'kaksi viestiä taululla', 8000);
const both = await tiles();
if (!both.includes('Mitä on zero trust?') || !both.includes('Kolmas viesti')) throw new Error('Taululla: ' + JSON.stringify(both));
await msgButton('Mitä on zero trust?', 'Poista taululta');
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 1`, 'yksi viesti taululla', 8000);
if ((await tiles())[0] !== 'Kolmas viesti') throw new Error('Väärä viesti jäi taululle');
step('Kaksi viestiä taululla yhtä aikaa; Poista taululta poistaa vain valitun');

// Vastatuksi merkintä on erillinen toiminto (taululle näyttäminen ei merkitse) ja peruttavissa.
const status = (text) => admin.js(`[...document.querySelectorAll('#tab-question li.q')].find((x) => x.querySelector('.q-text')?.textContent === ${JSON.stringify(text)}).dataset.status`);
if ((await status('Kolmas viesti')) !== 'new') throw new Error('Taululle näyttäminen merkitsi vastatuksi');
await msgButton('Kolmas viesti', 'Merkitse vastatuksi');
await admin.waitFor(`[...document.querySelectorAll('#tab-question li.q')].some((x) => x.dataset.status === 'answered' && x.innerText.includes('Vastattu'))`, 'vastattu');
await msgButton('Kolmas viesti', 'Palauta uudeksi');
await admin.waitFor(`[...document.querySelectorAll('#tab-question li.q[data-status="answered"]')].length === 0`, 'palautettu uudeksi');
step('Merkitse vastatuksi ja Palauta uudeksi viestin rivillä');

// Nimimerkin raja: 20 viestiä / 10 min. Seuraava hylätään ja osallistuja näkee syyn.
for (let i = texts.length; i < 20; i++) await send('Viesti ' + i);
const over = await send('Viesti 21');
if (!/Too many messages/.test(over)) throw new Error('21. viesti: ' + over);
step(`Nimimerkin 21. viesti 10 minuutin sisällä hylätään: "${over}"`);
process.exit(0);
