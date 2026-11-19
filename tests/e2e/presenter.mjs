// Vaihe 6: esitysnäkymä (koodi ja QR kulmassa, fonttikoko 1080p:llä, iso QR, teema) ja pikanäppäimet.
// Issue #60: kysymykset ohjataan hallinnan listasta; näppäimistä jäivät F, T ja Q (iso QR), ja
// puhelinohjain poistettiin.
// Ajo: scripts/e2e.sh presenter.mjs  (tai node tests/e2e/presenter.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, pollItem, lit } from './lib.mjs';

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

await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys');
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await stage.waitFor(`document.body.innerText.includes(${lit(code)})`, 'QR-näkymä ilman aktiivista');

const key = async (t, k, code2) => {
  for (const type of ['keyDown', 'keyUp']) {
    await t.cdp('Input.dispatchKeyEvent', { type, key: k, code: code2 || k, text: k.length === 1 ? k : undefined, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, PageDown: 34, PageUp: 33, ' ': 32 }[k] || k.toUpperCase().charCodeAt(0) });
  }
};
// Kysymys taululle, tulokset ja paljastus kysymyksen riviltä.
await admin.click('Näytä taululla', 'Is this a risk? Phishing.');
await stage.waitFor(`document.querySelector('.poll-stage-prompt')?.textContent === 'Is this a risk? Phishing.'`, 'kysymys projektorilla');
await admin.waitFor(`${pollItem('Is this a risk? Phishing.')}.dataset.status === 'open'`, 'auki');
await admin.click('Näytä tulokset', 'Is this a risk? Phishing.');
await admin.waitFor(admin.hasText('Piilota tulokset'), 'tulokset näkyvissä');
await admin.click('Paljasta oikea vastaus', 'Is this a risk? Phishing.');
await stage.waitFor(`!!document.querySelector('.res-row.correct')`, 'paljastus projektorilla');
step('Rivin napit: Näytä taululla (auki), Näytä tulokset ja Paljasta oikea vastaus näkyvät projektorilla');

// Koodi ja QR kulmassa, vastausmäärä, fonttikoko 1080p:llä
const corner = await stage.js(`({ code: document.querySelector('.poll-stage-code')?.textContent, qr: !!document.querySelector('.poll-stage-foot img'), count: document.querySelector('.poll-stage-count')?.textContent, size: parseFloat(getComputedStyle(document.querySelector('.poll-stage-prompt')).fontSize) })`);
if (corner.code !== code || !corner.qr || corner.count !== '0 answers' || corner.size < 40) throw new Error('Esitysnäkymä: ' + JSON.stringify(corner));
step(`Kulmassa koodi ${code} ja QR, vastausmäärä näkyy; kysymyksen fontti ${corner.size}px (1920×1080)`);

// Projektorin kieli seuraa luennon osallistujien kieltä (hallinta pysyy suomeksi).
const setLang = (v) => admin.js(`(() => { const s = document.getElementById('event-lang'); s.value = ${lit(v)}; s.dispatchEvent(new Event('change')); return true; })()`);
await setLang('fi');
await stage.waitFor(`document.querySelector('.poll-stage-count')?.textContent === '0 vastausta'`, 'projektori suomeksi', 5000);
await setLang('');
await stage.waitFor(`document.querySelector('.poll-stage-count')?.textContent === '0 vastausta'`, 'selaimen mukaan → suomi', 5000);
await setLang('en');
await stage.waitFor(`document.querySelector('.poll-stage-count')?.textContent === '0 answers'`, 'projektori englanniksi', 5000);
if (!(await admin.js(admin.hasText('Piilota tulokset')))) throw new Error('Hallinta ei pysynyt suomeksi');
step('Projektorin kieli luennon mukaan: English → "0 answers", Suomi ja selaimen mukaan → "0 vastausta"; hallinta suomeksi');

// Iso QR ja teema
await key(stage, 'q', 'KeyQ');
await stage.waitFor(`!!document.querySelector('.stage-bigqr img')`, 'iso QR');
await key(stage, 'q', 'KeyQ');
await stage.waitFor(`!document.querySelector('.stage-bigqr')`, 'iso QR pois');
await key(stage, 't', 'KeyT');
if (!(await stage.js(`document.body.classList.contains('light')`))) throw new Error('Teema ei vaihtunut');
step('Q: iso QR päälle ja pois; T: vaalea teema');

// Poistetut ohjausnäppäimet eivät tee mitään (esitysikkunassa eivätkä hallinnassa); Q toimii myös hallinnassa.
const state = () => admin.js(`[...document.querySelectorAll('li.poll-item')].map((li) => li.dataset.status + (li.classList.contains('staged') ? '+' : '')).join(',') + '|' + document.body.innerText.includes('Piilota tulokset')`);
const before = await state();
for (const [k, c] of [['ArrowRight', 'ArrowRight'], ['PageDown', 'PageDown'], ['ArrowLeft', 'ArrowLeft'], [' ', 'Space'], ['r', 'KeyR'], ['a', 'KeyA']]) {
  await key(stage, k, c);
  await key(admin, k, c);
}
await new Promise((r) => setTimeout(r, 2500));
if ((await state()) !== before) throw new Error('Poistettu näppäin muutti tilaa: ' + before + ' → ' + (await state()));
await key(admin, 'q', 'KeyQ');
await stage.waitFor(`!!document.querySelector('.stage-bigqr')`, 'Q hallinnassa', 8000);
await admin.click('QR pieneksi');
await stage.waitFor(`!document.querySelector('.stage-bigqr')`, 'QR pieneksi', 8000);
step('Nuolet, PageDown, välilyönti, R ja A eivät enää ohjaa; Q (hallinnassa) ja QR pieneksi -nappi toimivat');

// Toisen laitteen avausnäkymässä on Puhelinohjain (issue #63; ohjain itse testataan remote.mjs:ssä).
const phone = await tab(port);
await phone.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await phone.cdp('Page.navigate', { url: app + '/admin' });
await phone.waitFor(phone.hasText('Avaa kysymykset'), 'avausnäkymä');
if (!(await phone.js(phone.hasText('Puhelinohjain')))) throw new Error('Puhelinohjaimen nappi puuttuu avausnäkymästä');
step('Avausnäkymässä Puhelinohjain-nappi (ohjaus ilman salausavainta)');

const errs = [...admin.logs, ...stage.logs, ...phone.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
