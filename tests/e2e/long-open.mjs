// Pitkä avoin vastaus: kysymyskohtainen enimmäispituus (pohdintatehtävät, noin 500 sanaa = 3500 merkkiä).
// Osallistuja näkee laskurin (esim. 2400/3500), liian pitkä vastaus estetään selaimessa, hallinta näyttää
// koko tekstin ja projektori pitkistä vastauksista vain alun.
// Ajo: scripts/e2e.sh long-open.mjs  (tai node tests/e2e/long-open.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant, openPoll, mode } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const PROMPT = 'Biggest risk at the national, organisational and individual level?';

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Long answers', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'L4'); await admin.fill('#set-title', 'L4 From Code to Clinic');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('L4 From Code to Clinic'), 'sarja');
await admin.click('Uusi kysymys', 'L4 From Code to Clinic');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-type', 'open');
await admin.waitFor(admin.has('#poll-open-max'), 'enimmäispituus');
if ((await admin.js(`document.querySelector('#poll-open-max').value`)) !== '280') throw new Error('Oletus ei ole 280');
await admin.fill('#poll-open-max', '3500');
await admin.fill('#poll-prompt', PROMPT);
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('Avoin teksti · enintään 3500 merkkiä'), 'kysymys ja raja kortissa');
step('Avoin kysymys enimmäispituudella 3500 merkkiä; kortissa "enintään 3500 merkkiä"');

const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await openPoll(admin, PROMPT);
await part.waitFor(`!!document.querySelector('form.poll textarea')`, 'tekstikenttä');
const counter = () => part.js(`document.querySelector('form.poll .counter').textContent`);
if ((await counter()) !== '0/3500') throw new Error('Laskuri: ' + (await counter()));

const type = (text) => part.js(`(() => { const a = document.querySelector('form.poll textarea'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); return true; })()`);
const full = ('National: NIS2 reporting. Organisational: patching. Individual: phishing – ä ö. ').repeat(50).slice(0, 3500);
await type(full + 'x');
if ((await counter()) !== '3501/3500') throw new Error('Laskuri yli rajan: ' + (await counter()));
await part.js(`document.querySelector('form.poll').requestSubmit()`);
await part.waitFor(part.hasText('The answer is too long: up to 3500 characters.'), 'liian pitkä estetään');
step('Laskuri 0/3500 → 3501/3500; liian pitkä vastaus estetään: "up to 3500 characters"');

await type(full);
if ((await counter()) !== '3500/3500') throw new Error('Laskuri: ' + (await counter()));
await part.js(`document.querySelector('form.poll').requestSubmit()`);
await part.waitFor(`!!document.querySelector('form.poll .notice.ok')`, 'kuittaus');
step('3500 merkin vastaus (noin 500 sanaa) lähetetty');

await admin.waitFor(`[...document.querySelectorAll('.res-open-text')].some((e) => e.textContent === ${JSON.stringify(full.trim())})`, 'koko teksti hallinnassa', 8000);
step('Hallinta näyttää koko 3500 merkin tekstin');

await admin.click('Näytä tulokset');
await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.waitFor(`!!document.querySelector('.res-open-text')`, 'vastaus projektorilla');
const shown = await stage.js(`document.querySelector('.res-open-text').textContent`);
if (!shown.endsWith('…') || [...shown].length > 281 || !full.startsWith(shown.slice(0, -1))) throw new Error('Projektori: ' + shown.length + ' merkkiä');
step(`Projektori näyttää pitkästä vastauksesta alun (${[...shown].length} merkkiä, päättyy "…")`);
process.exit(0);
