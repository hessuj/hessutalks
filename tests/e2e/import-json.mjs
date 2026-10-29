// Vaihe 3 (H14): kurssin JSON-tiedoston tuonti hallinnassa, esikatselu, vienti ja oikeiden vastausten piilotus osallistujalta.
// Ajo: scripts/e2e.sh import-json.mjs  (tai node tests/e2e/import-json.mjs <cdp-port> <app-url>)
import { readFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab, step, setupAdmin, createEvent, openParticipant, openPoll, mode } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'Cybersecurity Fundamentals – MMoIT 2026', 'en');

// Tiedoston valinta piilotetulle file-kentälle (sama kuin käyttäjän valinta tiedostodialogista).
const chooseFile = async () => {
  const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
  const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
};

await chooseFile();
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa ja 22 kysymystä'), 'esikatselu');
const preview = await admin.js(`document.querySelector('.import-preview').innerText`);
if (preview.includes('Ohitetaan')) throw new Error('Esikatselussa ei pitäisi olla ohitettavia:\n' + preview);
if (await admin.js(`document.querySelectorAll('section.set-card').length`) !== 0) throw new Error('Esikatselu tallensi sarjoja');
step('Esikatselu: 9 sarjaa, 22 kysymystä, ei ohitettavia; mitään ei vielä tallennettu');

await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa ja 22 kysymystä.'), 'tuonti');
const slugs = await admin.js(`[...document.querySelectorAll('section.set-card .set-head .code')].map((e) => e.textContent)`);
if (slugs.join(',') !== 'OPEN,M1,M2,M3,M4,M5,M6,WRAP-FRI,CLOSE-SAT') throw new Error('Sarjat: ' + slugs);
const m3 = await admin.js(`[...document.querySelectorAll('section.set-card')].find((s) => s.querySelector('.set-head h3').textContent === 'M3 Rules of the game').innerText`);
if (!m3.includes('Oikea: 1, 2, 3, 4 · selitykset')) throw new Error('M3:n oikeat vastaukset puuttuvat:\n' + m3);
step('H14: tuonti loi sarjat oikeassa järjestyksessä; M3:n oikeat vastaukset ja selitykset tallessa');

// Uudelleentuonti estyy (sarjat ovat jo luennolla).
await chooseFile();
await admin.waitFor(admin.hasText('Tiedostoa ei voi tuoda'), 'toinen tuonti estyy');
await admin.click('Sulje');
step('Sama tiedosto uudelleen: "Tiedostoa ei voi tuoda" (sarjat jo luennolla), ei kaksoiskappaleita');

// Osallistuja ei näe oikeita vastauksia eikä selityksiä.
const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await openPoll(admin, 'Which of these EU regulations');
await part.waitFor(part.hasText('Which of these EU regulations'), 'M3 osallistujalle');
const network = await part.js(`fetch(document.getElementById('polls').dataset.endpoint + '?code=' + document.getElementById('ask').dataset.code).then((r) => r.text())`);
if (network.includes('correct') || network.includes('DORA covers')) throw new Error('Oikea vastaus vuoti osallistujalle: ' + network);
step('Osallistujan rajapinta ei sisällä oikeita vastauksia eikä selityksiä');

// Vienti lataa JSONin, joka vastaa tuotua.
const dir = mkdtempSync(join(tmpdir(), 'hessutalks-export-'));
await admin.cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
await mode(admin, 'prep');
await admin.click('Vie JSON');
let file = null;
for (let i = 0; i < 50 && !file; i++) {
  await new Promise((r) => setTimeout(r, 100));
  file = readdirSync(dir).find((f) => f.endsWith('.json'));
}
if (!file) throw new Error('Vientitiedostoa ei syntynyt');
const exported = JSON.parse(readFileSync(join(dir, file), 'utf8'));
rmSync(dir, { recursive: true });
const m4 = exported.sets.find((s) => s.id === 'M4');
if (exported.sets.length !== 9 || m4.questions[0].correct[0] !== 1 || m4.questions[0].explanations[1] !== 'Safety first – blades and people.') {
  throw new Error('Vienti ei vastaa tuontia');
}
step(`Vie JSON latasi ${file}: 9 sarjaa, oikeat vastaukset ja selitykset mukana`);

const errs = [...admin.logs, ...part.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
