// Luentojen arkistointi ja palautus (issue #67). Päätökset: osallistuja näkee suljetun luennon ilmoituksen,
// auki olevan luennon voi arkistoida suoraan (arkistointi sulkee), palautus palauttaa suljettuna, eikä
// automaattista arkistointia ole (sitä valvoo PHPUnit, koska aikaa ei voi siirtää selaintestissä).
// Ajo: scripts/e2e.sh archive.mjs  (tai node tests/e2e/archive.mjs <cdp-port> <app-url>)
import { tab, step, setupAdmin, createEvent, openParticipant, pollItem } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const TITLE = 'E2E Arkistoitava luento';
const PROMPT = 'Arkistoinnin testikysymys?';

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Muu luento', 'fi');
await admin.click('Kaikki luennot');
await admin.waitFor(admin.has('#ev-title'), 'luentolista');
await createEvent(admin, TITLE, 'fi');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'A1'); await admin.fill('#set-title', 'A1 Arkisto');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('A1 Arkisto'), 'sarja');
await admin.click('Uusi kysymys', 'A1 Arkisto');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-prompt', PROMPT);
await admin.fill('#poll-options', 'Kyllä\nEi');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText(PROMPT), 'kysymys');
await admin.click('Näytä taululla', PROMPT);
await admin.waitFor(`${pollItem(PROMPT)}.dataset.status === 'open' && ${pollItem(PROMPT)}.classList.contains('staged')`, 'kysymys auki taululla');

const part = await openParticipant(port, admin);
await part.waitFor(part.hasText(PROMPT), 'osallistuja näkee kysymyksen');
step('Auki oleva luento, jonka kysymys on taululla ja osallistujalla');

// Arkistointi suoraan auki olevalta luennolta: vahvistus, luento pois listalta, Arkisto (1).
await admin.click('Arkistoi');
await admin.waitFor(admin.hasText('Luento arkistoitu.'), 'arkistoitu');
if (!admin.dialogs().some((d) => d.includes(TITLE) && d.includes('tiedot säilyvät'))) throw new Error('Vahvistus puuttuu: ' + admin.dialogs());
const list = await admin.js(`({
  titles: [...document.querySelectorAll('.event-list li strong')].map((e) => e.textContent),
  archive: [...document.querySelectorAll('button')].map((b) => b.textContent).find((t) => t.startsWith('Arkisto (')),
})`);
if (list.titles.some((t) => t.includes(TITLE)) || !list.titles.some((t) => t.includes('E2E Muu luento')) || list.archive !== 'Arkisto (1)') throw new Error('Luentolista: ' + JSON.stringify(list));
step('Arkistoi (vahvistuksella) siirtää luennon pois luentolistalta; muut luennot jäävät; Arkisto (1)');

// Osallistuja näkee suljetun luennon ilmoituksen.
await part.cdp('Page.reload');
await part.waitFor(part.hasText('Kysymykset on suljettu'), 'suljetun luennon ilmoitus');
if (await part.js(part.hasText(PROMPT))) throw new Error('Arkistoidun luennon kysymys näkyy osallistujalle');
step('Osallistuja näkee linkistä suljetun luennon ilmoituksen, ei kysymystä');

// Arkistonäkymä ja arkistoidun luennon sivu: kysymys suljettu ja pois taululta, tiedot tallella.
await admin.click('Arkisto (1)');
await admin.waitFor(admin.hasText(TITLE), 'arkistonäkymä');
if (!(await admin.js(admin.hasText('arkistoitu ')))) throw new Error('Arkistointiaika puuttuu');
await admin.click('Avaa');
await admin.waitFor(admin.hasText(PROMPT), 'arkistoidun luennon sivu');
const page = await admin.js(`({
  buttons: [...document.querySelectorAll('.share .actions button')].map((b) => b.textContent),
  status: ${pollItem(PROMPT)}.dataset.status, staged: ${pollItem(PROMPT)}.classList.contains('staged'),
})`);
if (page.buttons.join() !== 'Palauta,Poista luento' || page.status !== 'closed' || page.staged) throw new Error('Arkistoitu luento: ' + JSON.stringify(page));
step('Arkisto listaa luennon; sivulla Palauta ja Poista luento; kysymys suljettu ja pois taululta, kysymys tallella');

// Palautus suljettuna, avaus uudelleen tavalliseen tapaan.
await admin.click('Palauta');
await admin.waitFor(admin.hasText('Avaa kysymykset'), 'palautettu suljettuna');
if (!admin.dialogs().some((d) => d.includes('suljettuna'))) throw new Error('Palautuksen vahvistus puuttuu');
await admin.click('Avaa kysymykset');
await admin.waitFor(admin.hasText('Sulje kysymykset'), 'avattu uudelleen');
await part.cdp('Page.reload');
await part.waitFor(`!!document.querySelector('form') && !document.body.innerText.includes('Kysymykset on suljettu')`, 'osallistujalle auki');
await admin.click('Kaikki luennot');
await admin.waitFor(admin.hasText('Arkisto (0)'), 'arkisto tyhjä');
const back = await admin.js(`[...document.querySelectorAll('.event-list li')].find((li) => li.textContent.includes(${JSON.stringify(TITLE)}))?.textContent || ''`);
if (!back || back.includes('suljettu')) throw new Error('Palautettu ja avattu luento listalla: ' + back);
step('Palauta palauttaa luennon suljettuna (Avaa kysymykset), avaus toimii tavalliseen tapaan; listalla auki, Arkisto (0)');

const errs = [...admin.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
