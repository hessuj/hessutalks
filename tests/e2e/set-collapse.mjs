// Kysymyssarjan pienennys (issue #75): sarjan otsikosta kysymykset piiloon ja takaisin. Pienennetyn sarjan
// otsikossa näkyy, montako sen kysymystä on taululla ja auki. Numerointi pysyy, vieritys ei hyppää, ja
// pienennys säilyy live-päivityksen ja uudelleenlatauksen yli (sessionStorage, ei palvelimelle).
// Ajo: scripts/e2e.sh set-collapse.mjs  (tai node tests/e2e/set-collapse.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, pollItem, lit } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await admin.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Sarjan pienennys', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa ja 22 kysymystä'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa ja 22 kysymystä.'), 'tuonti');

const card = (i) => `document.querySelectorAll('section.set-card')[${i}]`;
const info = (i) => admin.js(`(() => { const c = ${card(i)}; const b = c.querySelector('.set-toggle');
  return { title: c.querySelector('.set-head h3').textContent, expanded: b.getAttribute('aria-expanded'),
    controls: b.getAttribute('aria-controls'), target: !!document.getElementById(b.getAttribute('aria-controls')),
    rows: [...c.querySelectorAll('li.poll-item')].filter((r) => r.offsetParent !== null).length,
    badges: [...c.querySelectorAll('.set-head .badge')].map((x) => x.textContent),
    nums: [...c.querySelectorAll('.run-num')].map((x) => x.textContent) }; })()`);
const toggle = (i) => admin.js(`${card(i)}.querySelector('.set-toggle').click(); true`);

const first = await info(0);
const second = await info(1);
if (first.expanded !== 'true' || !first.target || first.rows < 1 || first.badges.length) throw new Error('Alkutila: ' + JSON.stringify(first));
step(`Sarjat ovat aluksi auki; otsikko "${first.title}" on painike (aria-expanded, aria-controls)`);

// Ensimmäisen sarjan ensimmäinen kysymys taululle (auki), sitten sarja pienennetään.
const firstPrompt = await admin.js(`${card(0)}.querySelector('.run-prompt').textContent`);
await admin.click('Näytä taululla', firstPrompt);
await admin.waitFor(`${pollItem(firstPrompt)}.dataset.status === 'open' && ${pollItem(firstPrompt)}.classList.contains('staged')`, 'taululla ja auki');
await toggle(0);
await admin.waitFor(`${card(0)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'false'`, 'pienennetty');
let f = await info(0);
if (f.rows !== 0 || f.title !== first.title || f.badges.join() !== '1 taululla,1 auki') throw new Error('Pienennetty sarja: ' + JSON.stringify(f));
if ((await info(1)).nums.join() !== second.nums.join()) throw new Error('Numerointi muuttui: ' + JSON.stringify(await info(1)));
step(`Pienennetty sarja: kysymykset piilossa, otsikossa "1 taululla" ja "1 auki"; seuraavan sarjan numerot ennallaan (${second.nums[0]}…)`);

// Live-päivitys (toisen kysymyksen tila muuttuu) ei avaa pienennettyä sarjaa.
const secondPrompt = await admin.js(`${card(1)}.querySelector('.run-prompt').textContent`);
await admin.click('Näytä taululla', secondPrompt);
await admin.waitFor(`${pollItem(secondPrompt)}.classList.contains('staged')`, 'toinen taululle');
await new Promise((r) => setTimeout(r, 2500));
f = await info(0);
if (f.expanded !== 'false' || f.rows !== 0) throw new Error('Pienennys hävisi päivityksessä: ' + JSON.stringify(f));
step('Pienennys säilyy, kun lista päivittyy');

// Vieritys ei hyppää: keskellä sivua olevan sarjan otsikko pysyy paikallaan pienennettäessä ja avattaessa.
const mid = 4;
await admin.js(`(() => { const h = ${card(mid)}.querySelector('.set-head'); window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 200); return true; })()`);
const top = () => admin.js(`Math.round(${card(mid)}.querySelector('.set-head').getBoundingClientRect().top)`);
const before = await top();
await toggle(mid);
await admin.waitFor(`${card(mid)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'false'`, 'keskimmäinen pienennetty');
const afterFold = await top();
await toggle(mid);
await admin.waitFor(`${card(mid)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'true'`, 'keskimmäinen auki');
const afterOpen = await top();
if (Math.abs(afterFold - before) > 2 || Math.abs(afterOpen - before) > 2) throw new Error(`Vieritys hyppäsi: ${before} → ${afterFold} → ${afterOpen}`);
step(`Vieritys pysyy: otsikko ${before}px → ${afterFold}px → ${afterOpen}px`);

// Näppäimistö: Enter otsikkopainikkeessa pienentää.
await admin.js(`${card(2)}.querySelector('.set-toggle').focus(); true`);
for (const type of ['keyDown', 'keyUp']) await admin.cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: type === 'keyDown' ? '\r' : undefined });
await admin.waitFor(`${card(2)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'false'`, 'Enter pienentää');
step('Enter otsikossa pienentää sarjan');

// Uusi kysymys pienennetyssä sarjassa avaa sarjan.
await admin.js(`[...${card(2)}.querySelectorAll('.set-head button')].find((b) => b.textContent === 'Uusi kysymys').click(); true`);
await admin.waitFor(`${card(2)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'true' && !!document.getElementById('poll-prompt')`, 'uusi kysymys avaa sarjan');
await admin.js(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Peruuta')?.click(); true`);
step('Uusi kysymys pienennetyssä sarjassa avaa sarjan');

// Pienennä kaikki / Avaa kaikki.
await admin.click('Pienennä kaikki');
await admin.waitFor(`[...document.querySelectorAll('.set-toggle')].every((b) => b.getAttribute('aria-expanded') === 'false') && [...document.querySelectorAll('li.poll-item')].every((r) => r.offsetParent === null)`, 'kaikki pienennetty');
await admin.click('Avaa kaikki');
await admin.waitFor(`[...document.querySelectorAll('.set-toggle')].every((b) => b.getAttribute('aria-expanded') === 'true')`, 'kaikki auki');
step('Pienennä kaikki ja Avaa kaikki');

// Uudelleenlatauksen yli (sessionStorage): pienennetään ensimmäinen, ladataan uudelleen ja avataan luento.
await toggle(0);
await admin.waitFor(`${card(0)}.querySelector('.set-toggle').getAttribute('aria-expanded') === 'false'`, 'pienennetty ennen latausta');
const stored = await admin.js(`Object.keys(sessionStorage).filter((k) => k.startsWith('hessutalks.sets.')).map((k) => sessionStorage.getItem(k))`);
await admin.cdp('Page.reload');
await admin.waitFor(admin.hasText('Avaa passkeylla'), 'avausnäkymä');
await admin.click('Avaa passkeylla');
await admin.waitFor(admin.hasText('tukee avausta'), 'kertaluonteinen tunnuslause');
await admin.fill('#pp', 'e2e-oikein-pitka-tunnuslause');
await admin.submit('#pp');
await admin.waitFor(admin.has('#ev-title'), 'luennot', 60000);
await admin.js(`[...document.querySelectorAll('.event-list button')].find((b) => b.textContent === 'Avaa').click()`);
await admin.waitFor(admin.has('li.poll-item'), 'kysymyslista');
f = await info(0);
if (f.expanded !== 'false' || f.rows !== 0 || f.badges.join() !== '1 taululla,1 auki') throw new Error('Uudelleenlatauksen jälkeen: ' + JSON.stringify(f) + ' ' + lit(stored));
step('Pienennys säilyy uudelleenlatauksen yli (tallennettu: ' + stored.join() + ', vain sarjojen tunnisteet)');

const errs = admin.logs;
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
