// Kyselyjen kaksi tilaa (Hessun palaute 29.10.: aktivointi oli sekavaa, kun jokaisessa kortissa oli 11 nappia).
// Valmistelu: kortit ja muokkaus, ei aktivointia. Luennolla: ohjauspalkki, aktiivisen tulokset ja tiivis lista,
// jossa rivin klikkaus tekee kysymyksestä aktiivisen. Ei poisto- eikä muokkausnappeja luennon aikana.
// Ajo: scripts/e2e.sh run-mode.mjs  (tai node tests/e2e/run-mode.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, openParticipant, mode } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Run mode', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa ja 22 kysymystä'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa ja 22 kysymystä.'), 'tuonti');

const visible = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.offsetParent !== null)`;
const buttons = (sel) => admin.js(`${visible(sel + ' button')}.map((b) => b.textContent.trim())`);

// Valmistelu (oletus, kun mikään ei ole aktiivinen): kortit ja muokkaus, ei aktivointia eikä ohjauspalkkia.
const prep = await admin.js(`({
  pressed: document.querySelector('.mode-btn[aria-pressed="true"]')?.textContent,
  cards: ${visible('article.poll-card')}.length,
  control: ${visible('.live-control')}.length,
  tools: ${visible('.prep-tools button')}.map((b) => b.textContent),
})`);
const card = await admin.js(`[...document.querySelector('article.poll-card .q-actions').querySelectorAll('button')].map((b) => b.textContent.trim())`);
if (prep.pressed !== 'Valmistelu' || prep.cards !== 22 || prep.control !== 0 || !prep.tools.includes('Tuo JSON')) throw new Error('Valmistelu: ' + JSON.stringify(prep));
if (card.some((t) => ['Näytä', 'Avaa', 'Sulje', 'Tulokset projektorille'].includes(t)) || !card.includes('Muokkaa')) throw new Error('Kortin napit: ' + card);
step(`Valmistelu: 22 korttia, ei ohjauspalkkia; kortissa ${card.length} nappia (${card.join(', ')}), ei aktivointia`);

// Luennolla: tiivis lista numeroituna, ei muokkausta.
await mode(admin, 'live');
const live = await admin.js(`({
  rows: ${visible('.run-row')}.map((r) => r.querySelector('.run-num').textContent),
  cards: ${visible('article.poll-card')}.length,
  control: ${visible('.live-control')}.length,
  tools: ${visible('.prep-tools')}.length,
  edit: ${visible('#tab-polls button')}.map((b) => b.textContent.trim()).filter((t) => ['Muokkaa', 'Poista', 'Tyhjennä vastaukset', 'Uusi kysymys', 'Uusi sarja'].includes(t)),
})`);
if (live.rows.length !== 22 || live.rows[0] !== '1' || live.rows[21] !== '22' || live.cards !== 0 || live.control !== 1 || live.tools !== 0 || live.edit.length) {
  throw new Error('Luennolla: ' + JSON.stringify(live));
}
step('Luennolla: 22 numeroitua riviä, ohjauspalkki näkyvissä, ei muokkaus- eikä poistonappeja');

// Rivin klikkaus = aktiiviseksi (luonnos: osallistuja odottaa), ohjauspalkista auki.
const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
const third = await admin.js(`document.querySelectorAll('.run-row')[2].querySelector('.run-prompt').textContent`);
await admin.js(`document.querySelectorAll('.run-row')[2].click()`);
await admin.waitFor(`document.querySelector('.live-now strong')?.textContent === ${JSON.stringify(third)} && document.querySelectorAll('.run-row')[2].getAttribute('aria-current') === 'true'`, 'rivi 3 aktiiviseksi');
if (!(await admin.js(`document.querySelector('.live-now .eyebrow').textContent.includes('3/22')`))) throw new Error('Aktiivisen järjestysnumero');
await new Promise((r) => setTimeout(r, 2000));
if (!(await part.js(part.hasText('Waiting for the next question')))) throw new Error('Luonnos näkyi osallistujalle');
await admin.click('Avaa vastauksille');
await part.waitFor(part.hasText(third.slice(0, 30)), 'kysymys osallistujalle', 8000);
if (!(await admin.js(`!!document.querySelector('.run-results')`))) throw new Error('Aktiivisen tulokset puuttuvat');
step(`Rivin 3 klikkaus: aktiivinen 3/22, osallistuja odottaa; Avaa vastauksille → kysymys osallistujalle; tulokset näkyvissä`);

// Valinta säilyy, kun palataan valmisteluun ja takaisin; aktiivinen kortti merkitty.
await mode(admin, 'prep');
if ((await admin.js(`${visible('article.poll-card.active')}.length`)) !== 1) throw new Error('Aktiivinen kortti ei merkitty valmistelussa');
await mode(admin, 'live');
step('Tilan vaihto säilyttää aktiivisen kysymyksen; valmistelussa aktiivinen kortti on merkitty');
process.exit(0);
