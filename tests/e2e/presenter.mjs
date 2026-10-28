// Vaihe 6: esitysnäkymä (koodi ja QR kulmassa, fonttikoko 1080p:llä, iso QR, teema), pikanäppäimet
// esitysikkunassa ja hallinnassa sekä puhelinohjain.
// Ajo: scripts/e2e.sh presenter.mjs  (tai node tests/e2e/presenter.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Presenter', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'M5'); await admin.fill('#set-title', 'M5 Governance');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('M5 Governance'), 'sarja');
for (const prompt of ['Is this a risk? Phishing.', 'Is this a risk? DDoS.']) {
  await admin.click('Uusi kysymys', 'M5 Governance');
  await admin.waitFor(admin.has('#poll-prompt'), 'lomake');
  await admin.fill('#poll-prompt', prompt);
  await admin.fill('#poll-options', 'Yes\nNo\nNot yet');
  await admin.fill('#poll-correct', '3');
  await admin.submit('#poll-prompt');
  await admin.waitFor(admin.hasText(prompt), 'kysymys');
}
const code = await admin.js(`document.querySelector('.big-code').textContent`);

await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await stage.waitFor(`document.body.innerText.includes(${JSON.stringify(code)})`, 'QR-näkymä ilman aktiivista');

const key = async (t, k, code2) => {
  for (const type of ['keyDown', 'keyUp']) {
    await t.cdp('Input.dispatchKeyEvent', { type, key: k, code: code2 || k, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, PageDown: 34, PageUp: 33, ' ': 32 }[k] || k.toUpperCase().charCodeAt(0) });
  }
};
const activePrompt = () => admin.js(`document.querySelector('.live-control strong').textContent`);

// Esitysikkunan näppäimet ohjaavat hallintaa (postMessage avaajalle).
await key(stage, 'ArrowRight', 'ArrowRight');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('Is this a risk? Phishing.')`, '→ esitysikkunassa');
await stage.waitFor(`document.querySelector('.poll-stage-prompt')?.textContent === 'Is this a risk? Phishing.'`, 'kysymys projektorilla');
await key(stage, ' ', 'Space');
await admin.waitFor(`document.querySelector('.live-control .badge')?.textContent === 'Auki'`, 'välilyönti avaa');
await key(stage, 'r', 'KeyR');
await admin.waitFor(admin.hasText('Piilota tulokset'), 'R näyttää tulokset');
await key(stage, 'a', 'KeyA');
await stage.waitFor(`!!document.querySelector('.res-row.correct')`, 'A paljastaa');
step('Esitysikkunan näppäimet: → seuraava, välilyönti avaa, R tulokset, A paljastus');

// Koodi ja QR kulmassa, vastausmäärä, fonttikoko 1080p:llä
const corner = await stage.js(`({ code: document.querySelector('.poll-stage-code')?.textContent, qr: !!document.querySelector('.poll-stage-foot img'), count: document.querySelector('.poll-stage-count')?.textContent, size: parseFloat(getComputedStyle(document.querySelector('.poll-stage-prompt')).fontSize) })`);
if (corner.code !== code || !corner.qr || !/^0 vastausta/.test(corner.count) || corner.size < 40) throw new Error('Esitysnäkymä: ' + JSON.stringify(corner));
step(`Kulmassa koodi ${code} ja QR, vastausmäärä näkyy; kysymyksen fontti ${corner.size}px (1920×1080)`);

// Iso QR ja teema
await key(stage, 'q', 'KeyQ');
await stage.waitFor(`!!document.querySelector('.stage-bigqr img')`, 'iso QR');
await key(stage, 'q', 'KeyQ');
await stage.waitFor(`!document.querySelector('.stage-bigqr')`, 'iso QR pois');
await key(stage, 't', 'KeyT');
if (!(await stage.js(`document.body.classList.contains('light')`))) throw new Error('Teema ei vaihtunut');
step('Q: iso QR päälle ja pois; T: vaalea teema');

// Esitysohjain (PageDown) ja hallinnan omat näppäimet
await key(stage, 'PageDown', 'PageDown');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('Is this a risk? DDoS.')`, 'PageDown');
await admin.js(`document.querySelector('.live-control button').focus()`);
await key(admin, 'ArrowLeft', 'ArrowLeft');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('Is this a risk? Phishing.')`, '← hallinnassa');
await key(admin, ' ', 'Space');
await admin.waitFor(`document.querySelector('.live-control .badge')?.textContent === 'Suljettu'`, 'välilyönti sulkee (fokus ohjauspalkin napissa)');
if ((await activePrompt()) !== 'Is this a risk? Phishing.') throw new Error('Välilyönti painoi fokuksessa olevaa nappia');
step('Esitysohjaimen PageDown; hallinnassa ← ja välilyönti (myös kun ohjauspalkin nappi on fokuksessa)');

// Puhelinohjain toisessa ikkunassa (sama istunto, avainta ei avata)
const phone = await tab(port);
await phone.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await phone.cdp('Page.navigate', { url: app + '/admin' });
await phone.waitFor(phone.hasText('Puhelinohjain'), 'avausnäkymän ohjainnappi');
await phone.click('Puhelinohjain');
await phone.waitFor(phone.hasText('Ohjaa'), 'luentovalinta');
await phone.click('Ohjaa');
await phone.waitFor(phone.hasText('Is this a risk? Phishing.'), 'ohjain näyttää aktiivisen');
await phone.click('Seuraava →');
await stage.waitFor(`document.querySelector('.poll-stage-prompt')?.textContent === 'Is this a risk? DDoS.'`, 'puhelimen Seuraava projektorilla', 8000);
await phone.waitFor(phone.hasText('QR isona'), 'QR-nappi');
await phone.click('QR isona');
await stage.waitFor(`!!document.querySelector('.stage-bigqr')`, 'puhelimen iso QR projektorilla', 8000);
step('Puhelinohjain (ilman avainta): Seuraava ja iso QR näkyvät projektorilla läppärin kautta');

const errs = [...admin.logs, ...stage.logs, ...phone.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
