// MMoIT-vaatimukset v2 (2.11.): R9 ei paljastusnappia ilman oikeaa vastausta, R10 multi-paljastus (4 oikeaa ja
// 7 selitystä), R11 pitkät vaihtoehdot rivittyvät projektorilla ja puhelimessa, R12 aktiivisen kysymyksen
// vastausten nollaus varmistuksen jälkeen, sekä luennon otsikon muokkaus (koodi pysyy).
// Ajo: scripts/e2e.sh mmoit-must.mjs  (tai node tests/e2e/mmoit-must.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, attach, step, setupAdmin, createEvent, openParticipant, openPoll, mode } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'Moder Management of IT', 'en');

// Otsikon muokkaus: kirjoitusvirhe korjataan, koodi pysyy.
const code = await admin.js(`document.querySelector('.big-code').textContent`);
await admin.click('Muokkaa otsikkoa');
await admin.waitFor(admin.has('#event-title-edit'), 'otsikkolomake');
await admin.fill('#event-title-edit', 'Modern Management of IT');
await admin.click('Tallenna otsikko');
await admin.waitFor(`document.querySelector('.toolbar h1')?.textContent === 'Modern Management of IT'`, 'uusi otsikko');
if ((await admin.js(`document.querySelector('.big-code').textContent`)) !== code) throw new Error('Koodi muuttui');
const part = await openParticipant(port, admin);
await part.waitFor(`document.querySelector('h1')?.textContent === 'Modern Management of IT'`, 'otsikko osallistujalla');
step(`Otsikko korjattu (Moder → Modern); koodi ${code} sama, osallistuja näkee uuden otsikon`);

const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa'), 'tuonti');

// R10: M3 multi, 4 oikeaa ja 7 selitystä projektorilla ja osallistujalla.
await openPoll(admin, 'Which of these EU regulations');
await part.waitFor(`document.querySelectorAll('form.poll input[type=checkbox]').length === 7`, 'M3 osallistujalle');
await part.js(`(() => { const c = document.querySelectorAll('form.poll input[type=checkbox]'); c[0].click(); c[3].click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`!!document.querySelector('form.poll .notice.ok')`, 'vastaus');
await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await admin.click('Näytä tulokset');
await admin.click('Paljasta oikea vastaus');
await stage.waitFor(`document.querySelectorAll('.res-row.correct').length === 4`, 'neljä oikeaa projektorilla', 8000);
const stageExpl = await stage.js(`[...document.querySelectorAll('.res-explanation')].filter((e) => e.textContent.trim()).length`);
await part.waitFor(`document.querySelectorAll('.poll-explanation').length === 7`, 'seitsemän selitystä osallistujalla', 8000);
if (stageExpl !== 7) throw new Error('Selityksiä projektorilla ' + stageExpl);
step('R10: M3-paljastus näyttää 4 oikeaa vaihtoehtoa ja 7 selitystä projektorilla ja osallistujalla');

// R12: aktiivisen kysymyksen vastaukset nollataan ohjauspalkista varmistuksen jälkeen.
await admin.waitFor(`document.querySelector('.live-now')?.innerText.includes('1 vastaus')`, 'yksi vastaus', 8000);
await admin.cdp('Page.enable');
const before = admin.dialogs().length;
await admin.js(`setTimeout(() => [...document.querySelectorAll('.live-control button')].find((b) => b.textContent === 'Tyhjennä vastaukset').click(), 0), true`);
const t0 = Date.now();
while (admin.dialogs().length === before && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 100));
const asked = admin.dialogs()[before] || '';
if (!asked.includes('Which of these EU regulations')) throw new Error('Varmistus: ' + asked);
await admin.waitFor(`document.querySelector('.live-now')?.innerText.includes('0 vastausta')`, 'nollattu', 8000);
step('R12: Tyhjennä vastaukset ohjauspalkissa kysyy varmistuksen ja nollaa aktiivisen kysymyksen (1 → 0)');

// R9: M4/3 ilman oikeaa vastausta: ei paljastusnappia.
await openPoll(admin, 'Stage 3: The media asks');
if (await admin.js(`[...document.querySelectorAll('.live-control button')].some((b) => /oikea vastaus/.test(b.textContent))`)) throw new Error('Paljastusnappi näkyi M4/3:ssa');
step('R9: M4/3 (ei oikeaa vastausta) – paljastusnappia ei näytetä');

// R11: pitkä vaihtoehto (yli 100 merkkiä, M4/2) rivittyy projektorilla ja puhelimessa, ei katkea.
await openPoll(admin, 'Stage 2: The vulnerability');
const longest = 'National CSIRT';
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await stage.waitFor(`[...document.querySelectorAll('.res-label')].some((e) => e.textContent.includes(${JSON.stringify(longest)}))`, 'M4/2 projektorilla', 8000);
const onStage = await stage.js(`(() => { const e = [...document.querySelectorAll('.res-label')].find((x) => x.textContent.includes(${JSON.stringify(longest)})); const r = e.getBoundingClientRect(); return { full: e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis', inside: r.right <= window.innerWidth && r.bottom <= window.innerHeight, len: e.textContent.length }; })()`);
await part.cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
await part.waitFor(`[...document.querySelectorAll('.poll-choice')].some((e) => e.textContent.includes(${JSON.stringify(longest)}))`, 'M4/2 puhelimessa', 8000);
const onPhone = await part.js(`(() => { const e = [...document.querySelectorAll('.poll-choice')].find((x) => x.textContent.includes(${JSON.stringify(longest)})); const r = e.getBoundingClientRect(); return { full: e.scrollWidth <= e.clientWidth + 1, inside: r.left >= 0 && r.right <= window.innerWidth, overflow: document.documentElement.scrollWidth - window.innerWidth, lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight || 20)) }; })()`);
if (!onStage.full || !onStage.inside || !onPhone.full || !onPhone.inside || onPhone.overflow > 0) throw new Error('R11: ' + JSON.stringify({ onStage, onPhone }));
step(`R11: ${onStage.len} merkin vaihtoehto näkyy kokonaan projektorilla (1920×1080) ja puhelimessa (360 px), ei vaakavieritystä`);
process.exit(0);
