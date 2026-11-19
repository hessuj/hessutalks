// Osallistujien viestit taululla (issue #60): jokaisella viestillä on oma Näytä taululla -nappinsa, ja taululla
// voi olla useita viestejä yhtä aikaa. Pitkät viestit eivät saa mennä nimimerkin päälle eivätkä ruudun
// ulkopuolelle (Hessun havainto 2.11.: teksti meni otsikon päälle myös koko näytöllä).
// Ajo: scripts/e2e.sh stage-messages.mjs  (tai node tests/e2e/stage-messages.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant, lit } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Stage messages with a fairly long lecture title for the projector', 'en');

const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
await part.fill('#nickname', 'Long_Questions');
const send = async (text) => {
  await part.js(`(() => { const t = document.getElementById('text'); t.value = ${lit(text)}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetys');
};
const long = (i) => `Question ${i}: ` + 'How should a healthcare organisation verify AI-generated code before it reaches patients, and who is accountable? '.repeat(i % 3 === 0 ? 4 : 2);
for (let i = 1; i <= 8; i++) await send(long(i));
await admin.js(`document.getElementById('tab-btn-question').click()`);
await admin.waitFor(`document.querySelectorAll('#tab-question li.q').length === 8`, '8 viestiä hallinnassa', 15000);
step('Osallistuja lähetti 8 pitkää kysymystä');

const show = (prefix) => admin.js(`(() => {
  const li = [...document.querySelectorAll('#tab-question li.q')].find((x) => x.querySelector('.q-text').textContent.startsWith(${lit(prefix)}));
  [...li.querySelectorAll('button')].find((b) => b.textContent === 'Näytä taululla').click(); return true; })()`);
await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys');
for (const i of [1, 2, 3, 6]) await show(`Question ${i}:`);
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 4`, '4 viestiä taululla', 8000);

const measure = () => stage.js(`[...document.querySelectorAll('.tile-question')].map((tile) => {
  const box = tile.getBoundingClientRect();
  const nick = tile.querySelector('.stage-url').getBoundingClientRect();
  const q = tile.querySelector('.stage-q').getBoundingClientRect();
  return { ok: nick.top >= box.top - 0.5 && q.top >= nick.bottom - 0.5 && q.bottom <= box.bottom + 1 && box.bottom <= window.innerHeight + 1,
    font: getComputedStyle(tile.querySelector('.stage-q')).fontSize };
})`);
for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768]]) {
  await stage.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 400));
  const m = await measure();
  if (m.length !== 4 || m.some((t) => !t.ok)) throw new Error(`${w}×${h}: ` + JSON.stringify(m));
  step(`${w}×${h}: 4 pitkää viestiä taululla, kukin kokonaan ruudussaan nimimerkin alla (fontit ${m.map((t) => t.font).join(', ')})`);
}

// Enintään 6 viestiä kerrallaan: seitsemäs korvaa vanhimman.
for (const i of [4, 5, 7]) await show(`Question ${i}:`);
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 6`, '6 viestiä taululla', 8000);
const onBoard = await admin.js(`[...document.querySelectorAll('#tab-question li.q.staged .q-text')].map((e) => e.textContent.split(':')[0]).sort()`);
if (onBoard.join() !== 'Question 2,Question 3,Question 4,Question 5,Question 6,Question 7') throw new Error('Taululla: ' + onBoard);
step('Taululla enintään 6 viestiä: seitsemäs korvasi vanhimman (Question 1)');

// Yksittäinen 2000 merkin kysymys: fontti pienenee, kunnes teksti mahtuu.
await admin.click('Tyhjennä taulu');
await stage.waitFor(`document.querySelectorAll('.tile-question').length === 0`, 'taulu tyhjä', 8000);
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const huge = ('Very long question about MedConnect alerting, NIS2 reporting and who decides at 3 a.m. ').repeat(30).slice(0, 2000);
await send(huge);
await admin.waitFor(`document.querySelectorAll('#tab-question li.q').length === 9`, '9. viesti', 15000);
await show('Very long question');
await stage.waitFor(`document.querySelector('.stage-q')?.textContent.length === 2000`, 'pitkä kysymys projektorilla');
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  await stage.cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 400));
  const [q] = await measure();
  if (!q.ok) throw new Error(`Yksittäinen ${w}×${h}: ` + JSON.stringify(q));
  step(`${w}×${h}: 2000 merkin kysymys mahtuu näytölle (fontti ${q.font}), nimimerkki näkyvissä`);
}
const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
