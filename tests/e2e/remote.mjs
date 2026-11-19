// Puhelinohjain (issue #63): kysymykset näytölle ja pois, avaus ja sulkeminen, tulokset, paljastus, Tyhjennä taulu
// ja iso QR puhelimesta. Läppärin hallinta päivittää esitysnäytön, ja ohjain näyttää yhteyden ja esitysnäytön tilan.
// Luotettavuus: katkos ja palautuminen, jäädytetty sivu (näyttö sammui), lista ei hypi päivityksissä.
// Ajo: scripts/e2e.sh remote.mjs  (tai node tests/e2e/remote.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, attach, step, setupAdmin, createEvent, openParticipant, pollItem, lit } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));
const ONE_WORD = 'Cybersecurity in one word?';
const QUIZ = 'Which of these EU regulations apply';
const PHISH = 'I have personally been targeted by phish';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Remote', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa'), 'tuonti');

// Läppärin Puhelinohjain-nappi näyttää QR-koodin ja osoitteen, jossa on vain luennon numero.
await admin.click('Puhelinohjain');
await admin.waitFor(admin.has('.remote-qr img'), 'ohjaimen QR');
const remoteUrl = await admin.js(`document.querySelector('.remote-link').textContent`);
if (!/\/admin\/?#ohjain=\d+$/.test(remoteUrl)) throw new Error('Ohjaimen osoite: ' + remoteUrl);
step('Läppärin Puhelinohjain-nappi: QR-koodi ja osoite ' + remoteUrl.replace(/^https?:\/\/[^/]+/, ''));

// "Puhelin": oma ikkuna samassa selaimessa (sama istunto, kuin passkeylla kirjautunut puhelin), ei salausavainta.
const phone = await tab(port);
await phone.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
await phone.cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
await phone.cdp('Network.enable');
await phone.cdp('Page.navigate', { url: app + '/admin' });
await phone.waitFor(phone.hasText('Avaa kysymykset'), 'avausnäkymä');
await phone.click('Puhelinohjain');
await phone.waitFor(phone.hasText('E2E Remote'), 'luentovalinta');
await phone.click('Ohjaa');
await phone.waitFor(`document.querySelectorAll('.remote-card').length === 22`, 'ohjaimen kysymykset');
if ((await phone.js('location.hash')) !== new URL(remoteUrl).hash) throw new Error('Osoite ei vastaa QR-koodia');
step('Puhelin: kirjautunut ilman salausavainta, Puhelinohjain → luento → 22 kysymystä sarjoittain');

const layout = await phone.js(`(() => {
  const small = [...document.querySelectorAll('.remote button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 48).map((b) => b.textContent);
  return { width: document.documentElement.scrollWidth, small };
})()`);
if (layout.width > 360 || layout.small.some((t) => t !== 'Hallintaan')) throw new Error('Puhelimen asettelu: ' + JSON.stringify(layout));
if (await phone.js(`/\bnull\b|undefined/.test(document.querySelector('.remote').innerText)`)) throw new Error('Ohjaimessa näkyy null/undefined');
step('360 px: ei sivuttaisvieritystä, ohjausnapit vähintään 48 px korkeita');

const conn = () => phone.js(`document.querySelector('.remote-conn').textContent`);
await phone.waitFor(`document.querySelector('.remote-conn').textContent.includes('esitysnäyttö ei ole yhteydessä')`, 'esitysnäyttö puuttuu');
await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys');
await phone.waitFor(`document.querySelector('.remote-conn').textContent.includes('esitysnäyttö yhteydessä')`, 'esitysnäyttö yhteydessä', 15000);
const c = await conn();
if (!/näyttö pysyy päällä|näyttö voi sammua|selain ei voi pitää näyttöä päällä/.test(c)) throw new Error('Näytön lukituksen tila puuttuu: ' + c);
step('Tila: "' + c + '"');

// Viesti taululle läppäriltä (puhelimen tyhjennys poistaa senkin myöhemmin).
const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
await part.fill('#nickname', 'Remote_Tester');
await part.js(`(() => { const t = document.getElementById('text'); t.value = 'Is MFA enough?'; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetys');
await admin.js(`document.getElementById('tab-btn-question').click()`);
await admin.waitFor(`document.querySelectorAll('#tab-question li.q').length === 1`, 'viesti hallinnassa', 10000);
await admin.js(`[...document.querySelector('#tab-question li.q').querySelectorAll('button')].find((b) => b.textContent === 'Näytä taululla').click()`);
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 1`, 'viesti taululla');
await admin.js(`document.getElementById('tab-btn-polls').click()`);

// Kaksi kysymystä näytölle puhelimesta: avautuvat vastauksille, näkyvät projektorilla ja osallistujalla.
const card = (prompt) => `[...document.querySelectorAll('.remote-card')].find((c) => c.querySelector('.remote-prompt').textContent.includes(${lit(prompt)}))`;
const tap = (prompt, label) => phone.js(`(() => { const c = ${card(prompt)}; const b = [...c.querySelectorAll('button')].find((x) => x.textContent === ${lit(label)});
  if (!b) throw new Error('nappi puuttuu: ' + ${lit(label)} + ' / ' + c.innerText); b.click(); return true; })()`);
const t0 = Date.now();
await tap(ONE_WORD, 'Näytölle');
await phone.waitFor(`${card(ONE_WORD)}.matches('.staged[data-status="open"]')`, 'ensimmäinen auki puhelimessa');
await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 1`, 'ensimmäinen projektorilla', 8000);
step(`Näytölle: kysymys auki ja projektorilla ${Date.now() - t0} ms:ssa`);

// Lista ei hypi: puhelimen näkyvä kortti pysyy paikallaan, vaikka sen yläpuolella oleva kortti kasvaa.
await phone.js(`(() => { const c = ${card(QUIZ)}; window.scrollBy(0, c.getBoundingClientRect().top - 420); return true; })()`);
await sleep(300);
const top = () => phone.js(`Math.round(${card(QUIZ)}.getBoundingClientRect().top)`);
const y0 = await top();
await admin.click('Näytä taululla', PHISH);   // läppäri: kortti puhelimen näkymän yläpuolella saa lisää nappeja
await phone.waitFor(`${card(PHISH)}.matches('.staged')`, 'läppärin muutos puhelimessa', 6000);
const y1 = await top();
if (Math.abs(y1 - y0) > 2) throw new Error(`Puhelimen lista hyppäsi: ${y0} -> ${y1}`);
await tap(QUIZ, 'Näytölle');
await phone.waitFor(`${card(QUIZ)}.matches('.staged[data-status="open"]')`, 'toinen auki');
if (Math.abs((await top()) - y0) > 2) throw new Error('Napautettu kortti siirtyi');
step('Läppärin ja puhelimen muutokset: puhelimen näkyvä kortti pysyi paikallaan (±2 px)');

await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 3`, 'kolme kysymystä projektorilla', 8000);
await part.waitFor(`document.querySelectorAll('form.poll').length === 3`, 'kolme kysymystä osallistujalla', 8000);
await admin.waitFor(`document.querySelectorAll('li.poll-item.staged[data-status="open"]').length === 3`, 'läppärin lista', 6000);
step('Useita kysymyksiä: kolme auki projektorilla, osallistujalla ja läppärin listassa');

// Taululla-välilehti: tilanne yhdellä silmäyksellä. Sulje, tulokset, paljastus, poisto.
await phone.js(`document.getElementById('remote-tab-stage').click()`);
await phone.waitFor(`document.querySelectorAll('.remote-card').length === 3 && document.getElementById('remote-tab-stage').textContent === 'Taululla (3)'`, 'Taululla-välilehti');
await tap(QUIZ, 'Sulje vastaukset');
await phone.waitFor(`${card(QUIZ)}.dataset.status === 'closed'`, 'suljettu');
await tap(QUIZ, 'Näytä tulokset');
await phone.waitFor(`${card(QUIZ)}.innerText.includes('Piilota tulokset')`, 'tulokset näkyvissä');
await tap(QUIZ, 'Paljasta oikea vastaus');
await phone.waitFor(`${card(QUIZ)}.innerText.includes('Piilota oikea vastaus')`, 'paljastettu');
await stage.waitFor(`!!document.querySelector('.res-row.correct')`, 'oikea vastaus projektorilla', 8000);
step('Taululla-välilehti: Sulje vastaukset, Näytä tulokset ja Paljasta oikea vastaus näkyvät projektorilla');

await tap(ONE_WORD, 'Poista näytöltä');
await phone.waitFor(`document.querySelectorAll('.remote-card').length === 2`, 'poistettu taululta');
await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 2`, 'projektorilla kaksi', 8000);
step('Poista näytöltä: kysymys pois projektorilta (suljettu, vastaukset säilyvät)');

// Katkos: puhelin ilman verkkoa näyttää sen, komento ei mene perille, ja yhteys palautuu itsestään.
await phone.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await phone.waitFor(`document.querySelector('.remote-conn').dataset.state === 'bad'`, 'katkos näkyy', 12000);
await tap(PHISH, 'Sulje vastaukset');
await phone.waitFor(phone.hasText('Komento ei mennyt perille'), 'komentovirhe', 20000);
await phone.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await phone.waitFor(`document.querySelector('.remote-conn').dataset.state === 'ok'`, 'yhteys palasi', 8000);
await tap(PHISH, 'Sulje vastaukset');
await phone.waitFor(`${card(PHISH)}.dataset.status === 'closed'`, 'komento perille');
step('Katkos: ohjain näyttää yhteyden puuttuvan ja komennon epäonnistuneen; verkon palattua komento menee perille');

// Näyttö sammuu (sivu jäädytetään): palatessa tila päivittyy heti.
await phone.cdp('Page.setWebLifecycleState', { state: 'frozen' });
await admin.waitFor(`${pollItem(PHISH)}.dataset.status === 'closed'`, 'läppäri näki sulkemisen', 6000);
await admin.click('Avaa vastauksille', PHISH);
await admin.waitFor(`${pollItem(PHISH)}.dataset.status === 'open'`, 'läppäri avasi');
await sleep(2500);
const t1 = Date.now();
await phone.cdp('Page.setWebLifecycleState', { state: 'active' });
await phone.waitFor(`${card(PHISH)}.dataset.status === 'open'`, 'päivittyi palatessa', 5000);
step(`Jäädytetty sivu (näyttö sammui): palatessa tila päivittyi ${Date.now() - t1} ms:ssa`);

// Iso QR ja Tyhjennä taulu puhelimesta: myös läppärin taululle nostama viesti poistuu.
await phone.click('QR isona');
await stage.waitFor(`!!document.querySelector('.stage-bigqr')`, 'iso QR', 8000);
await phone.waitFor(`[...document.querySelectorAll('.remote-bar button')].some((b) => b.textContent === 'QR pieneksi')`, 'QR pieneksi -nappi');
await phone.click('QR pieneksi');
await stage.waitFor(`!document.querySelector('.stage-bigqr')`, 'QR pieneksi', 8000);
await phone.click('Tyhjennä taulu');
if (!phone.dialogs().some((d) => d.startsWith('Tyhjennetäänkö taulu?'))) throw new Error('Tyhjennys ilman vahvistusta');
await phone.waitFor(`document.querySelectorAll('.remote-card').length === 0 && document.getElementById('remote-tab-stage').textContent === 'Taululla (0)'`, 'puhelimen taulu tyhjä');
await stage.waitFor(`document.querySelectorAll('.tile').length === 0`, 'projektori tyhjä (myös viesti)', 8000);
await admin.waitFor(`document.querySelectorAll('li.poll-item.staged').length === 0`, 'läppärin lista tyhjä', 6000);
step('QR isona ja pieneksi; Tyhjennä taulu (vahvistus) poisti kysymykset ja läppärin nostaman viestin projektorilta');

// Uudelleenlataus pitää ohjaimen auki (osoitteen #-osa), myös kun istunto on voimassa.
await phone.cdp('Page.reload');
await phone.waitFor(`document.querySelectorAll('.remote-card').length > 0 || document.getElementById('remote-tab-stage')`, 'ohjain latauksen jälkeen');
step('Uudelleenlataus: ohjain aukeaa suoraan samaan luentoon');

const errs = [...admin.logs, ...phone.logs, ...stage.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
