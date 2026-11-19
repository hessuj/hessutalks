// Hallinnan kysymyslista (issue #60, Hessun palaute 16.11.: "liian monimutkainen", aktiivinen kysymys ja
// esitysnäyttö -kohdat "epäselviä ja turhia"). Ei tiloja eikä aktiivista kysymystä: jokaisen kysymyksen
// toiminnot ovat sen rivillä, ja rivin klikkaus avaa alle tulokset ja muokkauksen.
// Ajo: scripts/e2e.sh admin-list.mjs  (tai node tests/e2e/admin-list.mjs <cdp-port> <app-url>)
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, openParticipant, pollItem, expand, lit } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Admin list', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa ja 22 kysymystä'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa ja 22 kysymystä.'), 'tuonti');

const visible = (sel) => `[...document.querySelectorAll(${lit(sel)})].filter((e) => e.offsetParent !== null)`;
const rowButtons = (prompt) => admin.js(`[...${pollItem(prompt)}.querySelectorAll('.poll-actions button')].map((b) => b.textContent)`);
const Q = 'Which of these EU regulations apply';   // M3, monivalinta, oikeat vastaukset 1–4

// Yksi lista: ei tilakytkintä, ohjauspalkkia, Seuraava/Edellinen- eikä Ohita-nappeja.
const list = await admin.js(`({
  rows: ${visible('li.poll-item')}.map((r) => r.querySelector('.run-num').textContent),
  removed: ${visible('button')}.map((b) => b.textContent.trim()).filter((t) => /^(Valmistelu|▶ Luennolla|Seuraava →|← Edellinen|Ohita|Odotusnäkymä|Aktiiviseksi|Ohjain|Kysymykset projektorille|Palautteet projektorille)$/.test(t)),
  old: document.querySelectorAll('.live-control, .mode-switch, article.poll-card').length,
})`);
if (list.rows.length !== 22 || list.rows[0] !== '1' || list.rows[21] !== '22' || list.removed.length || list.old) throw new Error('Lista: ' + JSON.stringify(list));
if ((await rowButtons(Q)).join() !== 'Näytä taululla') throw new Error('Luonnoksen rivi: ' + (await rowButtons(Q)));
step('Yksi numeroitu lista (22 kysymystä); ei tiloja, ohjauspalkkia eikä Seuraava/Ohita-nappeja; luonnoksella vain Näytä taululla');

// Rivin klikkaus avaa alle tulokset ja muokkauksen; Piilota sulkee. Muokkaus ja poisto vain avautuvassa osassa.
const rowEdit = await admin.js(`${visible('.poll-actions button')}.map((b) => b.textContent).filter((t) => /Muokkaa|Poista$|Tyhjennä/.test(t))`);
if (rowEdit.length) throw new Error('Muokkausnappeja rivillä: ' + rowEdit);
await expand(admin, Q);
const detail = await admin.js(`[...${pollItem(Q)}.querySelectorAll('.poll-detail button')].map((b) => b.textContent)`);
for (const b of ['Piilota', 'Muokkaa', 'Tyhjennä vastaukset', 'Poista', 'Esikatsele']) if (!detail.includes(b)) throw new Error('Avautuvasta osasta puuttuu ' + b + ': ' + detail);
if (!(await admin.js(`${pollItem(Q)}.querySelector('.poll-detail').innerText.includes('Oikea: 1, 2, 3, 4')`))) throw new Error('Oikea vastaus ei näy hallinnalle');
await admin.click('Piilota', Q);
await admin.waitFor(`!${pollItem(Q)}.querySelector('.poll-detail')`, 'suljettu');
step('Rivin klikkaus: tulokset, oikea vastaus ja muokkaus rivin alle; Piilota sulkee');

// Näytä taululla = projektorille ja auki vastauksille yhdellä napilla.
const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await admin.click('Näytä taululla', Q);
await part.waitFor(part.hasText(Q), 'kysymys osallistujalle', 8000);
await admin.waitFor(`${pollItem(Q)}.matches('.staged[data-status="open"]') && ${pollItem(Q)}.innerText.includes('Taululla')`, 'Taululla ja Auki');
const open = await rowButtons(Q);
if (open.join() !== 'Sulje,Poista taululta,Näytä tulokset,Paljasta oikea vastaus') throw new Error('Auki-rivin napit: ' + open);
await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === 'GDPR').querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await admin.waitFor(`${pollItem(Q)}.querySelector('.run-count').textContent === '1'`, '1 vastaus');
step('Näytä taululla: osallistuja näkee ja vastaa; rivillä Sulje, Poista taululta, Näytä tulokset, Paljasta oikea vastaus');

// Sulje: vastaanotto loppuu, kysymys jää taululle.
await admin.click('Sulje', Q);
await part.waitFor(part.hasText('This poll is closed'), 'suljettu osallistujalla', 8000);
await admin.waitFor(`${pollItem(Q)}.matches('.staged[data-status="closed"]')`, 'suljettu taululla');
step('Sulje: vastaaminen loppuu, kysymys jää taululle');

// Poista taululta: pois projektorilta ja puhelimista, vastaukset säilyvät; uudelleen näyttäminen avaa taas.
await admin.click('Poista taululta', Q);
await part.waitFor(part.hasText('Waiting for the next question'), 'pois osallistujalta', 8000);
await admin.waitFor(`!${pollItem(Q)}.matches('.staged') && ${pollItem(Q)}.querySelector('.run-count').textContent === '1'`, 'pois taululta, vastaus tallessa');
if ((await rowButtons(Q)).join() !== 'Näytä taululla,Näytä tulokset,Paljasta oikea vastaus') throw new Error('Taululta poistetun napit: ' + (await rowButtons(Q)));
await admin.click('Näytä taululla', Q);
await part.waitFor(`document.body.innerText.includes(${lit(Q)}) && !document.body.innerText.includes('This poll is closed')`, 'taas auki', 8000);
await admin.waitFor(`${pollItem(Q)}.dataset.status === 'open'`, 'auki uudelleen');
step('Poista taululta piilottaa osallistujilta, vastaukset säilyvät; uudelleen näyttäminen avaa vastauksille');

// Tyhjennä vastaukset vain avautuvasta osasta vahvistuksella.
await expand(admin, Q);
await admin.click('Tyhjennä vastaukset', Q);
await admin.waitFor(`${pollItem(Q)}.querySelector('.run-count').textContent === '0'`, 'tyhjennetty');
const asked = admin.dialogs();
if (!asked.some((d) => d.includes('Tyhjennetäänkö') && d.includes(Q))) throw new Error('Tyhjennys ilman vahvistusta: ' + JSON.stringify(asked));
step('Tyhjennä vastaukset kysyy vahvistuksen avautuvassa osassa');

const errs = [...admin.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
