// Hallinnan lista pysyy paikallaan, kun kysymyksen tilaa muutetaan sen riviltä (Hessun havainto:
// Näytä taululla hyppäsi ylös, ja klikattu rivi hukkui).
// Ajo: scripts/e2e.sh scroll-keep.mjs  (tai node tests/e2e/scroll-keep.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, pollItem, lit } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Scroll', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa'), 'tuonti');
await admin.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const prompts = await admin.js(`[...document.querySelectorAll('li.poll-item .run-prompt')].map((e) => e.textContent)`);
const target = prompts[prompts.length - 3];
const top = () => admin.js(`Math.round(${pollItem(target)}.getBoundingClientRect().top)`);
await admin.js(`(() => { const r = ${pollItem(target)}.getBoundingClientRect(); window.scrollBy(0, r.top - 300); return true; })()`);
await new Promise((r) => setTimeout(r, 300));
const before = await top();
if (!(await admin.js('window.scrollY > 500'))) throw new Error('Vieritys ei onnistunut: ' + before);

const check = async (label, action, until) => {
  const y0 = await top();
  await admin.js(`(() => { const b = [...${pollItem(target)}.querySelectorAll('button')].find((x) => x.textContent === ${lit(label)}); b.click(); return true; })()`);
  await admin.waitFor(until, label, 8000);
  await new Promise((r) => setTimeout(r, 300));
  const y1 = await top();
  if (Math.abs(y1 - y0) > 1) throw new Error(`${label}: rivi siirtyi ${y0} -> ${y1} px`);
  step(`${action}: rivi pysyi paikallaan (${y0} px ikkunan yläreunasta)`);
};
await check('Näytä taululla', 'Näytä taululla', `${pollItem(target)}.classList.contains('staged')`);
await check('Sulje', 'Sulje', `${pollItem(target)}.dataset.status === 'closed'`);
await check('Näytä tulokset', 'Näytä tulokset', `${pollItem(target)}.querySelector('[aria-pressed=true]') !== null`);
await check('Poista taululta', 'Poista taululta', `!${pollItem(target)}.classList.contains('staged')`);
const y0 = await top();
await admin.js(`${pollItem(target)}.querySelector('.poll-toggle').click()`);
await admin.waitFor(`${pollItem(target)}.classList.contains('expanded')`, 'avautui');
if (Math.abs((await top()) - y0) > 1) throw new Error('Rivin avaus siirsi riviä');
step('Rivin avaus: rivi pysyi paikallaan');
const errs = admin.logs;
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
