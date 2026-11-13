// Projektorin kysymyslista (Kysymykset projektorille): monta pitkää kysymystä ei saa mennä otsikon päälle eikä
// näytön ulkopuolelle (Hessun havainto 2.11.: kysymykset menivät päällekkäin otsikon kanssa myös koko näytöllä).
// Mitataan 1920×1080- ja 1280×720-näkymissä: jokainen näkyvä rivi on kokonaan näytöllä ja otsikon alapuolella.
// Ajo: scripts/e2e.sh stage-list.mjs  (tai node tests/e2e/stage-list.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Stage list with a fairly long lecture title for the projector', 'en');

const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
await part.fill('#nickname', 'Long_Questions');
const long = (i) => `Question ${i}: ` + 'How should a healthcare organisation verify AI-generated code before it reaches patients, and who is accountable? '.repeat(i % 3 === 0 ? 4 : 2);
for (let i = 1; i <= 12; i++) {
  await part.js(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(long(i))}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetys ' + i);
}
await admin.js(`document.getElementById('tab-btn-messages').click()`);
await admin.waitFor(`document.querySelectorAll('ul.questions > li').length === 12`, '12 viestiä hallinnassa', 15000);
step('Osallistuja lähetti 12 pitkää kysymystä');

await admin.click('Kysymykset projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.waitFor(`document.querySelectorAll('.stage-list li').length > 0`, 'lista projektorilla');

const measure = () => stage.js(`(() => {
  const title = document.querySelector('.tile-list .stage-url').getBoundingClientRect();
  const box = document.querySelector('.tile-list').getBoundingClientRect();
  const shown = [...document.querySelectorAll('.stage-list li')].filter((li) => !li.hidden);
  const bad = shown.map((li, i) => ({ i, r: li.getBoundingClientRect() }))
    .filter(({ r }) => r.top < title.bottom - 0.5 || r.bottom > box.bottom + 0.5 || r.top < box.top)
    .map(({ i, r }) => i + ': ' + Math.round(r.top) + '–' + Math.round(r.bottom));
  return { shown: shown.length, total: document.querySelectorAll('.stage-list li').length, titleTop: Math.round(title.top), boxTop: Math.round(box.top), bad };
})()`);

for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768]]) {
  await stage.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 400));
  const m = await measure();
  if (m.bad.length || m.titleTop < m.boxTop || m.shown < 1) throw new Error(`${w}×${h}: ` + JSON.stringify(m));
  step(`${w}×${h}: ${m.shown}/${m.total} kysymystä näkyvissä kokonaan, otsikko ei peity eikä mitään leikkaudu`);
}

// Yksittäinen 2000 merkin kysymys (Näytä projektorilla): fontti pienenee, kunnes teksti mahtuu.
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const huge = ('Very long question about MedConnect alerting, NIS2 reporting and who decides at 3 a.m. ').repeat(30).slice(0, 2000);
await part.js(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(huge)}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
await admin.waitFor(`document.querySelectorAll('ul.questions > li').length === 13`, '13. viesti', 15000);
// Lista pois näytöltä (sama nappi), viesti isona samaan esitysikkunaan.
await admin.click('Kysymykset projektorille');
await admin.js(`[...document.querySelectorAll('ul.questions > li')].find((li) => li.innerText.includes('Very long question')).querySelector('button').click()`);
const single = stage;
await single.waitFor(`document.querySelector('.stage-q')?.textContent.length === 2000`, 'pitkä kysymys projektorilla');
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  await single.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 400));
  const q = await single.js(`(() => { const box = document.querySelector('.tile-question'); const r = document.querySelector('.stage-q').getBoundingClientRect(); const t = document.querySelector('.tile-question .stage-url').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), titleTop: Math.round(t.top), boxTop: Math.round(box.getBoundingClientRect().top), boxBottom: Math.round(box.getBoundingClientRect().bottom), font: getComputedStyle(document.querySelector('.stage-q')).fontSize }; })()`);
  if (q.titleTop < q.boxTop || q.top < q.boxTop || q.bottom > q.boxBottom + 1) throw new Error(`Yksittäinen ${w}×${h}: ` + JSON.stringify(q));
  step(`${w}×${h}: 2000 merkin kysymys mahtuu näytölle (fontti ${q.font}), nimimerkki näkyvissä`);
}
process.exit(0);
