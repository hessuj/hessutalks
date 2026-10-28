// Vaihe 4: avoin teksti (H6 XSS, H7 moderointi), kirosanasuodatin, useita vastauksia ja pysyvä moderointi.
// Ajo: scripts/e2e.sh open-text.mjs  (tai node tests/e2e/open-text.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Open text', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'WRAP'); await admin.fill('#set-title', 'Friday wrap-up');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('Friday wrap-up'), 'sarja');
await admin.click('Uusi kysymys', 'Friday wrap-up');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-type', 'open');
await admin.waitFor(admin.has('#poll-multiple'), 'useita vastauksia -valinta');
await admin.js(`document.querySelector('#poll-multiple').checked = true`);
await admin.fill('#poll-prompt', 'What surprised you today?');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('What surprised you today?'), 'avoin kysymys');
step('Avoin kysymys (useita vastauksia) luotu');

const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await admin.click('Avaa', 'What surprised you today?');
await part.waitFor(`!!document.querySelector('form.poll textarea')`, 'tekstikenttä');
if (!(await part.js(part.hasText('Please do not include personal data.')))) throw new Error('Henkilötietohuomautus puuttuu');
step('Osallistujalla tekstikenttä ja huomautus "Please do not include personal data."');

const send = async (text) => {
  await part.js(`(() => { const a = document.querySelector('form.poll textarea'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input')); document.querySelector('form.poll').requestSubmit(); return true; })()`);
  await part.waitFor(`document.querySelector('form.poll .notice.ok')?.innerText.includes('Sent: ')`, 'kuittaus');
  await part.js(`document.querySelector('form.poll .notice.ok').className = 'notice'`);
};
await send('Supply chain attacks');
await send(XSS);
await send('This is fucking hard');
if ((await part.js(`document.querySelector('form.poll textarea').value`)) !== '') throw new Error('Kenttä ei tyhjentynyt');
if (!(await part.js(part.hasText('Thanks! You can send another answer. Sent: 3.')))) throw new Error('Useiden vastausten kuittaus puuttuu');
step('Kolme vastausta samalta osallistujalta; kenttä tyhjenee ja "Sent: 3."');

// Hallinta: XSS-yritys näkyy tekstinä, kirosana odottaa tarkistusta.
await admin.waitFor(`[...document.querySelectorAll('.res-open-text')].some((e) => e.textContent === ${JSON.stringify(XSS)})`, 'XSS-teksti hallinnassa', 8000);
if (await admin.js(`!!document.querySelector('.res-open img, .res-open script')`)) throw new Error('XSS: elementti syntyi hallintaan');
if (await admin.js(`[...document.querySelectorAll('.res-open-text')].some((e) => e.textContent.includes('fucking'))`)) throw new Error('Kirosana näkyi suoraan');
await admin.waitFor(admin.hasText('⚠ This is fucking hard'), 'suodattimen tarkistettava');
step('H6 (hallinta): <script> ja <img onerror> näkyvät tekstinä; kirosanasuodatin piilotti vastauksen tarkistettavaksi');

// Projektori (tulokset ovat oletuksena piilossa: luennoitsija näyttää ne)
await admin.click('Näytä tulokset');
await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.waitFor(`[...document.querySelectorAll('.res-open-text')].some((e) => e.textContent === ${JSON.stringify(XSS)})`, 'XSS-teksti projektorilla');
if (await stage.js(`!!document.querySelector('#presenter img:not([alt="QR-koodi"]), #presenter script')`)) throw new Error('XSS: elementti syntyi projektorille');
step('H6 (projektori): sama teksti näkyy projektorilla tekstinä');

// H7: piilotus katoaa projektorilta heti
const t0 = Date.now();
await admin.js(`[...document.querySelectorAll('.res-open li')].find((li) => li.innerText.includes('Supply chain')).querySelector('button').click()`);
await stage.waitFor(`![...document.querySelectorAll('.res-open-text')].some((e) => e.textContent === 'Supply chain attacks')`, 'piilotettu katoaa', 3000);
step(`H7: piilotettu vastaus katosi projektorilta ${Date.now() - t0} ms:ssa`);

// Kirosanan hyväksyntä tuo sen näkyviin
await admin.js(`[...document.querySelectorAll('.poll-hidden button')].find((b) => b.textContent.startsWith('⚠ This is fucking')).click()`);
await stage.waitFor(`[...document.querySelectorAll('.res-open-text')].some((e) => e.textContent === 'This is fucking hard')`, 'hyväksytty näkyy');
step('Suodattimen osuman hyväksyntä tuo vastauksen näkyviin');

// Pysyvyys: hallinnan uudelleenlataus (avaus passkeylla) säilyttää piilotuksen ja hyväksynnän
await admin.cdp('Page.reload');
await admin.waitFor(admin.hasText('Avaa passkeylla'), 'avausnäkymä');
await admin.click('Avaa passkeylla');
// Käyttöönoton jälkeen avaus passkeylla otetaan käyttöön ensimmäisellä tunnuslauseavauksella.
await admin.waitFor(admin.hasText('tukee avausta'), 'kertaluonteinen tunnuslause');
await admin.fill('#pp', 'e2e-oikein-pitka-tunnuslause');
await admin.submit('#pp');
await admin.waitFor(admin.has('#ev-title'), 'luennot', 60000);
await admin.js(`[...document.querySelectorAll('.event-list button')].find((b) => b.textContent === 'Avaa').click()`);
await admin.waitFor(`document.querySelectorAll('.res-open-text').length === 2`, 'tulokset uudelleen ladattuina', 8000);
const visible = await admin.js(`[...document.querySelectorAll('.res-open-text')].map((e) => e.textContent).sort()`);
if (JSON.stringify(visible) !== JSON.stringify([XSS, 'This is fucking hard'].sort())) throw new Error('Moderointi ei säilynyt: ' + visible);
if (!(await admin.js(admin.hasText('Supply chain attacks ↺')))) throw new Error('Piilotettu puuttuu palautuslistasta');
step('Moderointi säilyi uudelleenlatauksen yli (salattuna palvelimella)');

const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
