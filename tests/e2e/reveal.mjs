// Vaihe 5: tulosten näyttö/piilotus, oikean vastauksen paljastus ja tuloskooste osallistujille (P2).
// Ajo: scripts/e2e.sh reveal.mjs  (tai node tests/e2e/reveal.mjs <cdp-port> <app-url>)
import { tab, attach, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Reveal', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'M4'); await admin.fill('#set-title', 'M4 Case');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('M4 Case'), 'sarja');

const question = async (type, prompt, fill) => {
  await admin.click('Uusi kysymys', 'M4 Case');
  await admin.waitFor(admin.has('#poll-prompt'), 'lomake');
  await admin.fill('#poll-type', type);
  await admin.fill('#poll-prompt', prompt);
  await fill();
  await admin.submit('#poll-prompt');
  await admin.waitFor(admin.hasText(prompt), 'kysymys ' + prompt);
};
await question('single', 'What is your FIRST action?', async () => {
  await admin.fill('#poll-options', 'Send a notice\nStop the mowers\nCollect logs');
  await admin.fill('#poll-correct', '2');
  await admin.fill('#poll-explanations', 'Important, but not first.\nSafety first – blades and people.\nDo this right after.');
});
await question('likert', 'Security slows down development.', async () => {});
if (!(await admin.js(admin.hasText('Oikea: 2 · selitykset')))) throw new Error('Oikea vastaus ei tallentunut lomakkeelta');
step('Visakysymys luotu lomakkeella: oikea vastaus 2 ja selitykset');

const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await admin.click('Avaa', 'What is your FIRST action?');
await part.waitFor(part.hasText('What is your FIRST action?'), 'kysymys osallistujalle');
await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === 'Stop the mowers').querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus');

await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.waitFor(`document.querySelector('.poll-stage-count')?.textContent.startsWith('1 vastausta')`, 'vastausmäärä projektorilla', 8000);
if (!(await stage.js(`!!document.querySelector('.results.res-hidden') && [...document.querySelectorAll('.res-value')].every((e) => e.textContent === '')`))) {
  throw new Error('Tulokset näkyivät ennen Näytä tulokset -painiketta');
}
if (await part.js(part.hasText('Safety first'))) throw new Error('Selitys näkyi osallistujalle ennen paljastusta');
step('Ennen näyttämistä: projektorilla vaihtoehdot ja vastausmäärä ilman lukuja, osallistujalla ei selityksiä');

await admin.click('Näytä tulokset');
await stage.waitFor(`[...document.querySelectorAll('.res-row')].some((r) => r.innerText.includes('Stop the mowers') && r.innerText.includes('100 % (1)'))`, 'tulokset projektorilla');
await part.waitFor(`!document.querySelector('.poll-results-box').hidden && document.querySelector('.poll-results-box').innerText.includes('100 % (1)')`, 'tulokset osallistujalle', 8000);
step('Näytä tulokset: pylväät projektorilla ja tuloskooste osallistujalla (100 % (1))');

await admin.click('Paljasta oikea vastaus');
await stage.waitFor(`document.querySelector('.res-row.correct')?.innerText.includes('✓ Stop the mowers') && document.body.innerText.includes('Safety first – blades and people.')`, 'paljastus projektorilla');
await part.waitFor(`document.querySelector('.poll-choice.correct')?.innerText.includes('Stop the mowers') && document.body.innerText.includes('Safety first – blades and people.')`, 'paljastus osallistujalla', 8000);
step('Paljasta oikea vastaus: ✓ ja selitykset projektorilla ja osallistujalla');

await admin.click('Piilota tulokset');
await part.waitFor(`document.querySelector('.poll-results-box').hidden`, 'kooste piiloon');
await stage.waitFor(`!!document.querySelector('.results.res-hidden')`, 'projektori piiloon');
step('Piilota tulokset: kooste katoaa osallistujalta ja luvut projektorilta');

// Asteikko: keskiarvo osallistujalle
await admin.click('Seuraava →');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('Security slows down development.')`, 'aktiivinen asteikko');
await admin.click('Avaa vastauksille');
await part.waitFor(part.hasText('Security slows down development.'), 'asteikko osallistujalle');
await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === '4').querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus 2');
await admin.click('Näytä tulokset');
await part.waitFor(`document.querySelector('.poll-results-box')?.innerText.includes('Average 4')`, 'keskiarvo osallistujalle', 10000);
if (await admin.js(admin.hasText('Paljasta oikea vastaus'))) throw new Error('Paljastusnappi näkyi kysymyksessä ilman oikeaa vastausta');
step('Asteikko: osallistuja näkee jakauman ja keskiarvon (Average 4); ei paljastusnappia ilman oikeaa vastausta');

const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
