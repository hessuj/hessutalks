// Hallinnan välilehdet: Kyselyt ja Kysymykset ja palaute. Kurssissa voi olla useita luentoja ja kymmeniä
// kysymyksiä, jolloin viestit hautautuivat sarjojen alle (Hessun USTP-kurssi 29.10.: 4 luentoa, 26 kysymystä).
// Ohjauspalkki näkyy kummallakin välilehdellä, ja viestivälilehti kertoo uusien viestien määrän.
// Ajo: scripts/e2e.sh tabs.mjs  (tai node tests/e2e/tabs.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Tabs', 'en');

const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa ja 22 kysymystä'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa ja 22 kysymystä.'), 'tuonti');

const state = () => admin.js(`(() => {
  const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; };
  const btn = (k) => document.getElementById('tab-btn-' + k);
  return {
    polls: shown('#tab-polls'), messages: shown('#tab-messages'), control: shown('.live-control'),
    selected: ['polls', 'messages'].filter((k) => btn(k).getAttribute('aria-selected') === 'true'),
    label: btn('messages').textContent,
  };
})()`);
let s = await state();
if (!s.polls || s.messages || !s.control || s.selected.join() !== 'polls') throw new Error('Alkutila: ' + JSON.stringify(s));
if (s.label !== 'Kysymykset ja palaute') throw new Error('Ei viestejä, ei merkkiä: ' + s.label);
step('Oletuksena Kyselyt-välilehti: 9 sarjaa näkyvissä, viestit piilossa, ohjauspalkki näkyvissä');

// Osallistuja lähettää kaksi viestiä, kun luennoitsija on kyselyiden välilehdellä.
const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
await part.fill('#nickname', 'Tab_Tester');
for (const text of ['Is MFA enough?', 'Great session']) {
  await part.js(`(() => { const t = document.getElementById('text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetys');
}
await admin.waitFor(`document.getElementById('tab-btn-messages').textContent === 'Kysymykset ja palaute2 uutta'`, 'uusien viestien määrä välilehdessä', 10000);
if ((await state()).messages) throw new Error('Viestit tulivat näkyviin ilman välilehden vaihtoa');
step('Kaksi uutta viestiä: välilehdessä "2 uutta", kyselyt pysyvät näkyvissä');

await admin.js(`document.getElementById('tab-btn-messages').click()`);
s = await state();
if (s.polls || !s.messages || !s.control || s.selected.join() !== 'messages') throw new Error('Viestivälilehti: ' + JSON.stringify(s));
await admin.waitFor(admin.hasText('Is MFA enough?'), 'viesti näkyvissä');
step('Viestivälilehti: viestit näkyvissä, sarjat piilossa, ohjauspalkki edelleen näkyvissä');

// Ohjauspalkki toimii viestivälilehdeltä: aktiivinen kysymys vaihtuu osallistujalle.
await admin.click('Seuraava →');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('OPEN')`, 'aktiivinen kysymys', 10000);
await admin.click('Avaa vastauksille');
await part.waitFor(part.hasText('Cybersecurity in one word?'), 'kysymys osallistujalla', 10000);
step('Seuraava ja Avaa vastauksille toimivat viestivälilehdeltä: kysymys aukesi osallistujalle');

await admin.click('Merkitse vastatuksi');
await admin.waitFor(`document.getElementById('tab-btn-messages').textContent === 'Kysymykset ja palaute1 uutta'`, 'määrä pienenee', 5000);
step('Vastatuksi merkitseminen pienentää uusien määrää (1 uutta)');

// Valinta säilyy, kun luennoitsija käy luentolistassa ja palaa luennolle.
await admin.click('Kaikki luennot');
await admin.waitFor(admin.hasText('E2E Tabs'), 'luentolista');
await admin.click('Avaa');
await admin.waitFor(`!!document.getElementById('tab-btn-messages')`, 'luento');
s = await state();
if (s.selected.join() !== 'messages' || !s.messages) throw new Error('Valinta ei säilynyt: ' + JSON.stringify(s));
await admin.js(`document.getElementById('tab-btn-polls').click()`);
if (!(await state()).polls) throw new Error('Kyselyt-välilehti ei palannut');
step('Valittu välilehti säilyy luentolistan kautta; Kyselyt-välilehti palauttaa sarjat');
process.exit(0);
