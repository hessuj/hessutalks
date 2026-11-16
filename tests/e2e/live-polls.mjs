// Vaihe 2: sarjat, kysymykset taululla ja osallistujan näkymä kahdella välilehdellä (hallinta + osallistuja).
// Ajo: scripts/e2e.sh live-polls.mjs  (tai node tests/e2e/live-polls.mjs <cdp-port> <app-url>)
const [port, app] = [process.argv[2], process.argv[3]];

import { tab, step, setupAdmin, createEvent, openParticipant, pollItem, setTools } from './lib.mjs';

const admin = await tab(port);
await setupAdmin(admin, app);

// Luento englanniksi, kaksi sarjaa ja kysymykset
await createEvent(admin, 'E2E Cybersecurity', 'en');
for (const [slug, title] of [['m1', 'M1 Cyber and society'], ['M2', 'M2 Attacker']]) {
  await admin.click('Uusi sarja');
  await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
  await admin.fill('#set-slug', slug); await admin.fill('#set-title', title);
  await admin.submit('#set-slug');
  await admin.waitFor(admin.hasText(title), 'sarja ' + title);
}
step('Luento (osallistujan kieli English) ja sarjat M1, M2 luotu; tunniste m1 → M1');

await admin.click('Uusi kysymys', 'M1 Cyber and society');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-prompt', 'Which threat actor?');
await admin.fill('#poll-options', 'Criminal\nHacktivist\nState');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('Which threat actor?'), 'M1-kysymys');
await admin.click('Uusi kysymys', 'M2 Attacker');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake 2');
await admin.fill('#poll-type', 'words');
await admin.fill('#poll-prompt', 'Cybersecurity in one word?');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('Cybersecurity in one word?'), 'M2-kysymys');
step('Kysymykset luotu sarjoihin');

// Osallistuja: suomenkielinen selain, luennon kieli englanti
const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä englanniksi');
if ((await part.js('document.documentElement.lang')) !== 'en') throw new Error('Osallistujan kieli ei ole en');
step('Osallistuja (selain fi) näkee odotusnäkymän englanniksi: "Waiting for the next question…"');

// H2: Näytä taululla tuo kysymyksen taululle ja avaa sen vastauksille yhdellä napilla (issue #60).
const t0 = Date.now();
await admin.click('Näytä taululla', 'Which threat actor?');
await part.waitFor(part.hasText('Which threat actor?'), 'kysymys osallistujalle', 5000);
const latency = Date.now() - t0;
if (latency > 2000) throw new Error('Viive ' + latency + ' ms > 2000 ms');
await admin.waitFor(`${pollItem('Which threat actor?')}.matches('.staged[data-status="open"]')`, 'rivillä Taululla ja Auki');
step(`H2: Näytä taululla avasi kysymyksen, ja se näkyi osallistujalle ${latency} ms:ssa ilman sivun päivitystä`);

// Vastaus ja muutos (H3)
const answer = async (label) => {
  await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === ${JSON.stringify(label)}).querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
  await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus');
};
await answer('Hacktivist');
if (!(await part.js(part.hasText('Thanks! You can change your answer until the poll closes.')))) throw new Error('Kuittausteksti puuttuu');
const adminCount = () => admin.js(`${pollItem('Which threat actor?')}.querySelector('.run-count').textContent`);
await admin.waitFor(`${pollItem('Which threat actor?')}.querySelector('.run-count').textContent === '1'`, 'hallinta: 1 vastaus');
await answer('State');
await new Promise((r) => setTimeout(r, 3500));
const count = await adminCount();
if (count !== '1') throw new Error('Vastauksen muutos laski ' + count + ' vastausta');
step('H3: kuittaus "Thanks! …", vastauksen muutos lasketaan yhtenä vastauksena');

// H10: uudelleenlataus säilyttää vastauksen
await part.cdp('Page.reload');
await part.waitFor(part.hasText('Which threat actor?'), 'kysymys uudelleenlatauksen jälkeen');
const checked = await part.js(`[...document.querySelectorAll('.poll-choice')].find((l) => l.querySelector('input').checked)?.innerText.trim()`);
if (checked !== 'State') throw new Error('Valinta uudelleenlatauksen jälkeen: ' + checked);
step('H10: sivun uudelleenlataus näyttää aktiivisen kysymyksen ja oman vastauksen (State)');

// H4: sulkeminen
await admin.click('Sulje', 'Which threat actor?');
await part.waitFor(part.hasText('This poll is closed'), 'suljettu tila', 4000);
const disabled = await part.js(`[...document.querySelectorAll('form.poll input')].every((i) => i.disabled) && !document.querySelector('form.poll button:not([hidden])')`);
if (!disabled) throw new Error('Suljetussa kyselyssä voi yhä vastata');
step('H4: suljettu kysely näkyy osallistujalle tilana, vastaaminen estetty');

// H12: sarjojen järjestys muuttuu kesken luennon, ja kysymykset näytetään listasta missä järjestyksessä tahansa.
// Ohitus = sarjan kysymyksiä ei näytetä taululla (Seuraava/Edellinen ja Ohita poistettiin, issue #60).
await setTools(admin, 'M2 Attacker');
await admin.click('↑', 'M2 Attacker');
await admin.waitFor(`document.querySelector('section.set-card .set-head h3').textContent === 'M2 Attacker'`, 'M2 ensimmäiseksi');
if ((await adminCount()) !== '1') throw new Error('Sarjan siirto muutti vastauksia');
step('H12: sarjan siirto kesken luennon muuttaa järjestystä; vastaukset säilyvät');

// H10: yhteyskatko ja palautus
await admin.click('Näytä taululla', 'Cybersecurity in one word?');
await part.waitFor(part.hasText('Cybersecurity in one word?'), 'M2 osallistujalle');
await part.cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await part.waitFor(part.hasText('Connection lost. Reconnecting'), 'yhteyskatkon ilmoitus', 10000);
await admin.click('Sulje', 'Cybersecurity in one word?');
await part.cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await part.waitFor(`!document.body.innerText.includes('Connection lost') && document.body.innerText.includes('This poll is closed')`, 'palautuminen', 12000);
step('H10: yhteyskatko näyttää "Reconnecting…", palautuessa tila päivittyy (kysely suljettiin katkon aikana)');

// Tyhjennä taulu
await admin.click('Tyhjennä taulu');
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä', 4000);
if (await admin.js(`!!document.querySelector('li.poll-item.staged')`)) throw new Error('Taululle jäi kysymys');
step('Tyhjennä taulu palauttaa osallistujat odotusnäkymään');

// Tila tiedostosta (Apache), ei PHP:stä: jaetun palvelimen prosessiraja (kuormitustesti 28.10.).
const resources = () => part.js(`performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname)`);
const before = await resources();
await new Promise((r) => setTimeout(r, 6000));
const during = (await resources()).slice(before.length);
const fromFile = during.filter((p) => /^\/live\/[0-9a-f]{32}\.json$/.test(p)).length;
const fromApi = during.filter((p) => p === '/api/live').length;
if (fromFile < 3 || fromApi > 0) throw new Error(`6 s aikana tiedostosta ${fromFile}, /api/live ${fromApi}`);
step(`Osallistuja lukee tilan tiedostosta (${fromFile} kertaa 6 s:ssa), ei PHP:stä (/api/live 0)`);

// Luennon sulkeminen: tiedosto kertoo sen, ja selain hakee syyn PHP:ltä (410) osallistujan kielellä.
await admin.click('Sulje kysymykset');
await part.waitFor(part.hasText('This lecture is no longer accepting messages.'), 'suljettu luento', 5000);
step('Luennon sulkeminen näkyy osallistujalle: "This lecture is no longer accepting messages."');

const errs = [...admin.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
