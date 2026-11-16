// Hallinnan välilehdet (issue #60): Kysymykset, Vapaat kysymykset ja Palautteet. Kurssissa voi olla useita
// luentoja ja kymmeniä kysymyksiä, jolloin viestit hautautuivat sarjojen alle (Hessun USTP-kurssi 29.10.).
// Taulurivi näkyy kaikilla välilehdillä, ja viestivälilehdet kertovat uusien määrän.
// Ajo: scripts/e2e.sh tabs.mjs  (tai node tests/e2e/tabs.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, openParticipant, expand, pollItem } from './lib.mjs';

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

const KEYS = ['polls', 'question', 'feedback'];
const state = () => admin.js(`(() => {
  const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; };
  const btn = (k) => document.getElementById('tab-btn-' + k);
  return {
    polls: shown('#tab-polls'), question: shown('#tab-question'), feedback: shown('#tab-feedback'), board: shown('.stage-bar'),
    selected: ${JSON.stringify(KEYS)}.filter((k) => btn(k).getAttribute('aria-selected') === 'true'),
    labels: ${JSON.stringify(KEYS)}.map((k) => btn(k).textContent),
  };
})()`);
let s = await state();
if (!s.polls || s.question || s.feedback || !s.board || s.selected.join() !== 'polls') throw new Error('Alkutila: ' + JSON.stringify(s));
if (s.labels.join('|') !== 'Kysymykset|Vapaat kysymykset|Palautteet') throw new Error('Ei viestejä, ei merkkiä: ' + s.labels);
step('Oletuksena Kysymykset-välilehti: 9 sarjaa näkyvissä, viestit piilossa, taulurivi näkyvissä');

// Nappirivit eivät mene päällekkäin, kun ne rivittyvät (Hessun havainto Safarissa 29.10.).
await admin.cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 1000, deviceScaleFactor: 1, mobile: false });
await expand(admin, 'Cybersecurity in one word?');
const rows = await admin.js(`(() => {
  const out = [];
  for (const row of [...document.querySelectorAll('p, .q-actions')].filter((p) => p.querySelectorAll('button').length >= 2)) {
    const r = [...row.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect());
    const tops = [...new Set(r.map((x) => Math.round(x.top)))].sort((a, b) => a - b);
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push('päällekkäin');
    }
    for (let i = 1; i < tops.length; i++) {
      const above = Math.max(...r.filter((x) => Math.round(x.top) === tops[i - 1]).map((x) => x.bottom));
      if (tops[i] - above < 6) out.push('rivien väli ' + (tops[i] - above).toFixed(1) + ' px');
    }
    out.push('rivejä ' + tops.length);
  }
  return out;
})()`);
if (rows.some((x) => !x.startsWith('rivejä'))) throw new Error('Nappirivit: ' + rows.join(', '));
if (!rows.some((x) => x !== 'rivejä 1' && x !== 'rivejä 0')) throw new Error('Kapeassa näkymässä napit eivät rivittyneet, testi ei mittaa mitään: ' + rows);
await admin.cdp('Emulation.clearDeviceMetricsOverride');
step('Nappirivit 760 px:n näkymässä: ei päällekkäisyyksiä, rivien väli vähintään 6 px');

// Osallistuja lähettää kysymyksen ja palautteen, kun luennoitsija on Kysymykset-välilehdellä.
const part = await openParticipant(port, admin);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'viestilomake');
await part.fill('#nickname', 'Tab_Tester');
for (const [kind, text] of [['question', 'Is MFA enough?'], ['feedback', 'Great session']]) {
  await part.js(`(() => { document.querySelector('input[name=kind][value=${kind}]').click(); const t = document.getElementById('text'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await part.waitFor(`!document.getElementById('send').disabled && !document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetys');
}
await admin.waitFor(`document.getElementById('tab-btn-question').textContent === 'Vapaat kysymykset1 uutta' && document.getElementById('tab-btn-feedback').textContent === 'Palautteet1 uutta'`, 'uusien määrä välilehdissä', 10000);
if ((await state()).question) throw new Error('Viestit tulivat näkyviin ilman välilehden vaihtoa');
step('Kysymys ja palaute: kummankin välilehden merkki "1 uutta", kysymykset pysyvät näkyvissä');

await admin.js(`document.getElementById('tab-btn-question').click()`);
s = await state();
if (s.polls || !s.question || s.feedback || !s.board || s.selected.join() !== 'question') throw new Error('Vapaat kysymykset: ' + JSON.stringify(s));
await admin.waitFor(`document.getElementById('tab-question').innerText.includes('Is MFA enough?') && !document.getElementById('tab-question').innerText.includes('Great session')`, 'vain kysymys');
await admin.js(`document.getElementById('tab-btn-feedback').click()`);
await admin.waitFor(`document.getElementById('tab-feedback').innerText.includes('Great session') && !document.getElementById('tab-feedback').innerText.includes('Is MFA enough?')`, 'vain palaute');
step('Vapaat kysymykset ja Palautteet omilla välilehdillään; taulurivi näkyy kaikilla');

// Taulurivi ja kysymyksen näyttäminen toimivat, vaikka viestivälilehti on auki.
await admin.js(`${pollItem('Cybersecurity in one word?')}.querySelector('.board-btn').click()`);
await part.waitFor(part.hasText('Cybersecurity in one word?'), 'kysymys osallistujalla', 10000);
step('Kysymyksen Näytä taululla toimii myös viestivälilehden ollessa auki: kysymys aukesi osallistujalle');

await admin.click('Merkitse käsitellyksi');
await admin.waitFor(`document.getElementById('tab-btn-feedback').textContent === 'Palautteet' && document.getElementById('tab-btn-question').textContent === 'Vapaat kysymykset1 uutta'`, 'määrä pienenee', 5000);
step('Palautteen Merkitse käsitellyksi poistaa välilehden merkin; kysymysten merkki ennallaan');

// Valinta säilyy, kun luennoitsija käy luentolistassa ja palaa luennolle.
await admin.click('Kaikki luennot');
await admin.waitFor(`!!document.querySelector('.event-list .open-btn')`, 'luentolista');
await admin.click('Avaa');
await admin.waitFor(`!!document.getElementById('tab-btn-feedback')`, 'luento');
s = await state();
if (s.selected.join() !== 'feedback' || !s.feedback) throw new Error('Valinta ei säilynyt: ' + JSON.stringify(s));
await admin.js(`document.getElementById('tab-btn-polls').click()`);
if (!(await state()).polls) throw new Error('Kysymykset-välilehti ei palannut');
step('Valittu välilehti säilyy luentolistan kautta; Kysymykset-välilehti palauttaa sarjat');
process.exit(0);
