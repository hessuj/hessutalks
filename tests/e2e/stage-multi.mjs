// Hessun koeajo luennolla: kysymykset, palautteet ja tulokset eivät tulleet näytölle (jokainen näkymä avautui omaan
// ikkunaansa), ja kerrallaan vain yksi kysymys oli auki. Nyt yksi esitysikkuna näyttää ruudukkona kaiken taululle
// valitun: kaksi kyselyä auki yhtä aikaa (pylväät ja sanapilvi) ja palaute (issue #60: rivikohtaiset napit). Mitataan, ettei mikään mene päällekkäin
// eikä näytön ulkopuolelle, ja että yhteys palautuu, kun esitysikkuna tai hallinta ladataan uudelleen.
// Ajo: scripts/e2e.sh stage-multi.mjs  (tai node tests/e2e/stage-multi.mjs <cdp-port> <app-url>)
import { writeFileSync } from 'node:fs';
import { tab, attach, step, setupAdmin, createEvent, openParticipant, pollItem, expand } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
// Kuvakaappaukset silmämääräiseen tarkistukseen: E2E_SHOTS=/polku/kansioon scripts/e2e.sh stage-multi.mjs
const shot = async (t, name) => {
  if (!process.env.E2E_SHOTS) return;
  const r = await t.cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${process.env.E2E_SHOTS}/${name}.png`, Buffer.from(r.data, 'base64'));
};

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Stage multi', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'M1'); await admin.fill('#set-title', 'M1 Warm-up');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('M1 Warm-up'), 'sarja');
const question = async (type, prompt, fill) => {
  await admin.click('Uusi kysymys', 'M1 Warm-up');
  await admin.waitFor(admin.has('#poll-prompt'), 'lomake');
  await admin.fill('#poll-type', type);
  await admin.fill('#poll-prompt', prompt);
  await fill();
  await admin.submit('#poll-prompt');
  await admin.waitFor(admin.hasText(prompt), 'kysymys ' + prompt);
};
await question('single', 'Which risk worries you most?', async () => { await admin.fill('#poll-options', 'Phishing\nRansomware\nInsiders'); });
await question('words', 'One word for security?', async () => {});
await question('likert', 'Unused third question', async () => {});
await question('open', 'Ask anything for tomorrow', async () => { await admin.js(`document.querySelector('#poll-multiple').checked = true`); });

// Kaksi kysymystä taululle: Näytä taululla avaa esitysikkunan ja avaa kysymyksen vastauksille.
// Iso QR päällä (esim. edellisestä päivästä): taululle tuotu kysymys tulee silti näkyviin.
await admin.click('QR isona');
await admin.waitFor(`!!document.querySelector('.stage-bar .notice.warn')`, 'varoitus isosta QR:stä');
await admin.click('Näytä taululla', 'Which risk worries you most?');
const stage = await attach(port, '/admin/esitys');
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await admin.click('Näytä taululla', 'One word for security?');
await admin.waitFor(`document.querySelectorAll('li.poll-item.staged[data-status="open"]').length === 2`, 'kaksi auki taululla');
await admin.waitFor(admin.hasText('● yhdistetty'), 'esitysnäyttö yhdistetty');
await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 2`, 'kaksi kysymystä näytöllä');
await stage.waitFor(`!document.querySelector('.stage-bigqr')`, 'iso QR väistyi');
if (await admin.js(`!!document.querySelector('.stage-bar .notice.warn')`)) throw new Error('Varoitus isosta QR:stä jäi näkyviin');
step('Kaksi kysymystä taululla ja auki yhtä aikaa; esitysikkuna avautui Näytä taululla -napista, ja päällä ollut iso QR väistyi');

// Osallistuja näkee molemmat ja vastaa kumpaankin.
const part = await openParticipant(port, admin);
await part.waitFor(`document.querySelectorAll('form.poll').length === 2`, 'kaksi korttia osallistujalla');
await part.js(`(() => { const f = document.querySelectorAll('form.poll')[0];
  [...f.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === 'Ransomware').querySelector('input').click(); f.requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelectorAll('form.poll')[0].querySelector('.notice.ok')`, 'ensimmäinen kuitattu');
await part.js(`(() => { const f = document.querySelectorAll('form.poll')[1]; f.querySelector('input[type=text]').value = 'Trust'; f.requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelectorAll('form.poll')[1].querySelector('.notice.ok')`, 'toinen kuitattu');
await stage.waitFor(`[...document.querySelectorAll('.poll-stage-count')].filter((e) => e.textContent.startsWith('1 answer')).length === 2`, 'vastausmäärät näytöllä', 8000);
step('Osallistuja vastasi kumpaankin; näytöllä molemmissa "1 answer"');

// Tulokset näkyviin kummastakin omalta riviltään.
await admin.click('Näytä tulokset', 'One word for security?');
await admin.click('Näytä tulokset', 'Which risk worries you most?');
await stage.waitFor(`[...document.querySelectorAll('.res-word')].some((w) => w.textContent === 'trust')`, 'sanapilvi näytöllä', 8000);
await stage.waitFor(`[...document.querySelectorAll('.res-row')].some((r) => r.innerText.includes('Ransomware') && r.innerText.includes('100 % (1)'))`, 'pylväät näytöllä', 8000);
step('Tulokset näytöllä: pylväät (Ransomware 100 %) ja sanapilvi (trust) yhtä aikaa');

// Palautteet samaan ikkunaan kolmanneksi ruuduksi.
await part.fill('#nickname', 'Tester_9');
await part.js(`(() => { document.querySelector('input[name=kind][value=feedback]').click(); const t = document.getElementById('text'); t.value = 'Great pace, more demos please'; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
await part.waitFor(`!document.getElementById('send').disabled && /sent|lähetetty/i.test(document.getElementById('status').textContent)`, 'palaute lähetetty', 8000);
await admin.js(`document.getElementById('tab-btn-feedback').click(), true`);
await admin.waitFor(`document.getElementById('tab-feedback').innerText.includes('Great pace')`, 'palaute hallinnassa', 8000);
await admin.js(`[...document.querySelectorAll('#tab-feedback li.q button')].find((b) => b.textContent === 'Näytä taululla').click(), true`);
await stage.waitFor(`[...document.querySelectorAll('.tile-question')].some((t) => t.innerText.includes('Great pace, more demos please'))`, 'palaute näytöllä', 8000);
if ((await stage.js(`document.querySelectorAll('.tile').length`)) !== 3) throw new Error('Ruutuja ei ole kolme');
if (!(await admin.js(admin.hasText('Taululla: 2 kysymystä, 1 viesti')))) throw new Error('Hallinnan yhteenveto puuttuu');

const layout = () => stage.js(`(() => {
  const tiles = [...document.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
  const foot = document.querySelector('.poll-stage-foot').getBoundingClientRect();
  const all = tiles.concat([foot]);
  const out = all.filter((r) => r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5).length;
  let overlap = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap++;
  }
  // Ruudun sisältö ei valu ruudun ulkopuolelle (ruutu leikkaa, mutta kysymyksen pitää näkyä kokonaan).
  const prompts = [...document.querySelectorAll('.tile')].filter((t) => {
    const p = t.querySelector('.poll-stage-prompt, .stage-url');
    return p && p.getBoundingClientRect().bottom > t.getBoundingClientRect().bottom + 0.5;
  }).length;
  const font = Math.min(...[...document.querySelectorAll('.poll-stage-prompt')].map((p) => parseFloat(getComputedStyle(p).fontSize)));
  return { out, overlap, prompts, font, bodyScroll: document.documentElement.scrollHeight > innerHeight + 1 };
})()`);
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  await stage.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 500));
  const m = await layout();
  await shot(stage, `stage-${w}x${h}`);
  if (m.out || m.overlap || m.prompts || m.bodyScroll || m.font < 16) throw new Error(`${w}×${h}: ` + JSON.stringify(m));
  step(`${w}×${h}: 3 ruutua ja alapalkki näytöllä ilman päällekkäisyyksiä; kysymysten fontti vähintään ${m.font}px`);
}

await admin.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await shot(admin, 'admin-live');
await shot(part, 'participant');

// Esitysikkuna ladataan uudelleen (esim. F5 projektorilla): sisältö palaa itsestään.
await stage.cdp('Page.reload');
await stage.waitFor(`document.querySelectorAll('.tile').length === 3`, 'sisältö palasi esitysikkunan latauksen jälkeen', 8000);
step('Esitysikkunan uudelleenlataus: kaikki kolme ruutua palasivat');

// Hallinta ladataan uudelleen: näyttö tyhjenee (avain lukittu), ja sisältö palaa avauksen jälkeen samaan ikkunaan.
await admin.cdp('Page.reload');
await stage.waitFor(`document.body.innerText.includes('The admin view was closed.')`, 'näyttö tyhjeni', 8000);
await admin.waitFor(admin.has('#pp'), 'avausnäkymä');
await admin.fill('#pp', 'e2e-oikein-pitka-tunnuslause');
await admin.submit('#pp');
await admin.waitFor(admin.hasText('E2E Stage multi'), 'luentolista', 60000);
await admin.click('Avaa');
await stage.waitFor(`document.querySelectorAll('.tile').length === 3 && document.querySelector('.tile-question')?.innerText.includes('Great pace')`, 'sisältö palasi hallinnan latauksen jälkeen', 15000);
await admin.waitFor(admin.hasText('● yhdistetty'), 'yhdistetty uudelleen', 5000);
step('Hallinnan uudelleenlataus: näyttö tyhjeni avaimen lukituksen ajaksi ja palasi samaan ikkunaan (2 kysymystä + palautteet)');

// Poista taululta: kysymys poistuu osallistujalta, vastaukset säilyvät hallinnassa.
await admin.click('Poista taululta', 'Which risk worries you most?');
await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 1`, 'yksi kysymys näytöllä');
await part.waitFor(`document.querySelectorAll('form.poll').length === 1`, 'osallistujalla yksi');
const kept = await admin.js(`${pollItem('Which risk worries you most?')}.querySelector('.run-count').textContent`);
if (kept !== '1') throw new Error('Vastaus katosi: ' + kept);
step('Poista taululta: kysymys poistui näytöltä ja osallistujalta, vastaus säilyi (1)');

// Tyhjennä taulu: kysymykset ja viestit pois, näytöllä QR-koodi ja liittymisohje.
await admin.click('Tyhjennä taulu');
await stage.waitFor(`!document.querySelector('.tile') && !!document.querySelector('.stage-code')`, 'QR-näkymä');
step('Tyhjennä taulu: QR-koodi ja liittymiskoodi');

// Avoimia vastauksia enemmän kuin mahtuu (koeajo luennolla: 10 vastausta, osa jäi näkymättä): ruutu vierittyy.
await admin.click('Näytä taululla', 'Ask anything for tomorrow');
await part.waitFor(`document.querySelector('form.poll textarea')`, 'avoin kysymys osallistujalla');
const long = (i) => `Answer ${i}: how should we balance patching speed against testing when a critical CVE is published on a Friday afternoon?`;
for (let i = 1; i <= 10; i++) {
  await part.js(`(() => { const f = document.querySelector('form.poll'); f.querySelector('textarea').value = ${JSON.stringify(long(i))}; f.requestSubmit(); return true; })()`);
  await part.waitFor(`document.querySelector('form.poll .notice.ok')?.textContent.includes('${i}')`, 'vastaus ' + i, 8000);
}
await admin.click('Näytä tulokset', 'Ask anything for tomorrow');
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await stage.waitFor(`document.querySelectorAll('.tile .res-open li').length === 10`, 'kaikki 10 vastausta ruudussa', 8000);
const box = () => stage.js(`(() => { const r = document.querySelector('.tile .poll-stage-results'); return { sh: r.scrollHeight, ch: r.clientHeight, top: r.scrollTop, oy: getComputedStyle(r).overflowY, bar: r.offsetWidth - r.clientWidth }; })()`);
const before = await box();
if (!(before.sh > before.ch + 10) || before.oy !== 'auto' || before.bar < 8) throw new Error('Ei vieritettävä: ' + JSON.stringify(before));
await stage.js(`(() => { const r = document.querySelector('.tile .poll-stage-results'); r.scrollTop = r.scrollHeight; return true; })()`);
const lastVisible = await stage.js(`(() => { const r = document.querySelector('.tile .poll-stage-results').getBoundingClientRect(); const li = [...document.querySelectorAll('.tile .res-open li')].find((x) => x.textContent.startsWith('Answer 1:')).getBoundingClientRect(); return li.bottom <= r.bottom + 1 && li.top >= r.top - 1; })()`);
await shot(stage, 'open-scrolled');
if (!lastVisible) throw new Error('Vanhin vastaus ei tullut näkyviin vierittämällä');
const scrolled = (await box()).top;
// Lista päivittyy (luennoitsija piilottaa uusimman vastauksen), eikä vieritys hyppää alkuun.
await expand(admin, 'Ask anything for tomorrow');
await admin.js(`[...${pollItem('Ask anything for tomorrow')}.querySelectorAll('.poll-detail .res-open li')].find((li) => li.textContent.startsWith('Answer 10:')).querySelector('button').click(), true`);
await stage.waitFor(`document.querySelectorAll('.tile .res-open li').length === 9`, 'piilotus näytöllä', 8000);
const after = await box();
if (after.top < scrolled - 2 - (before.sh - after.sh)) throw new Error('Vieritys hyppäsi: ' + JSON.stringify({ scrolled, after }));
step(`Avoimet vastaukset (10 pitkää, 1280×720): ruutu vierittyy (${before.sh} px / ${before.ch} px), vierityspalkki ${before.bar} px näkyvissä, vanhin vastaus esiin vierittämällä, asento säilyy päivityksessä`);

// Bugi luennolta: kysymyksen avaaminen sulki muut, joten kaksi avointa onnistui vain välillä. Näytä taululla ja
// Sulje koskevat vain omaa kysymystään.
const staged = () => admin.js(`[...document.querySelectorAll('li.poll-item.staged .run-prompt')].map((e) => e.textContent).sort().join(' | ')`);
const status = (prompt) => admin.js(`${pollItem(prompt)}.dataset.status`);
await admin.click('Näytä taululla', 'Which risk worries you most?');
await admin.waitFor(`document.querySelectorAll('li.poll-item.staged[data-status="open"]').length === 2`, 'kaksi auki', 8000);
if ((await staged()) !== 'Ask anything for tomorrow | Which risk worries you most?') throw new Error('Taululla: ' + (await staged()));
await admin.click('Sulje', 'Which risk worries you most?');
await admin.waitFor(`${pollItem('Which risk worries you most?')}.dataset.status === 'closed'`, 'suljettu');
if ((await status('Ask anything for tomorrow')) !== 'open' || (await staged()) !== 'Ask anything for tomorrow | Which risk worries you most?') throw new Error('Sulje vaikutti muuhun: ' + (await staged()));
await stage.waitFor(`document.querySelectorAll('.tile-poll').length === 2`, 'kaksi ruutua projektorilla', 8000);
step('Näytä taululla lisää kysymyksen muiden rinnalle (kaksi auki), ja Sulje koskee vain omaa kysymystään');

// Markdown-raportti koko luennosta: tulokset ja viestit, ei nimimerkkejä. Blob napataan latauksen sijaan.
await admin.js(`(() => { window.__md = null; const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__md = b; return orig.call(URL, new Blob(['x'])); }; return true; })()`);
await admin.click('Vie Markdown');
await admin.waitFor(`!!window.__md`, 'raportti', 15000);
const md = await admin.js(`window.__md.text()`, true);
for (const part of ['# E2E Stage multi', '## M1 · M1 Warm-up', '### 1. Which risk worries you most?', '| Ransomware | 1 | 100 % |', '| trust | 1 |',
  '### 4. Ask anything for tomorrow', '- Answer 1: how should we balance', '### Feedback', '- Great pace, more demos please']) {
  if (!md.includes(part)) throw new Error('Raportista puuttuu: ' + part + '\n' + md.slice(0, 1500));
}
if (md.includes('Tester_9')) throw new Error('Raportissa nimimerkki');
if (md.includes('Answer 10:')) throw new Error('Piilotettu vastaus raportissa');
step(`Vie Markdown: koko luennon raportti (${md.split('\n').length} riviä): sarjat, taulukot, avoimet vastaukset ja palautteet; ei nimimerkkejä eikä piilotettuja`);

const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
