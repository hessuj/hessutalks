// Vaihe 8 (SHOULD): CSV-vienti (5.4) kaavainjektion estolla, sarjan monistus, kysymyksen siirto ja esikatselu (6).
// Ajo: scripts/e2e.sh should.mjs  (tai node tests/e2e/should.mjs <cdp-port> <app-url>)
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab, attach, step, setupAdmin, createEvent, openParticipant } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const fixture = fileURLToPath(new URL('../fixtures/mmoit-2026.json', import.meta.url));
const EVIL = '=HYPERLINK("http://evil.example","klik")';

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E SHOULD', 'en');
const { root } = await admin.cdp('DOM.getDocument', { depth: 0 });
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [fixture] });
await admin.waitFor(admin.hasText('Tuodaan 9 sarjaa'), 'esikatselu');
await admin.click('Tuo');
await admin.waitFor(admin.hasText('Tuotu 9 sarjaa'), 'tuonti');

// Vastauksia: M2 monivalinta ja WRAP-FRI avoin teksti (kaavainjektioyritys)
const part = await openParticipant(port, admin);
await part.waitFor(part.hasText('Waiting for the next question'), 'odotusnäkymä');
await admin.click('Avaa', 'Which threat actor would most likely target');
await part.waitFor(part.hasText('Which threat actor would most likely target'), 'M2 osallistujalle');
await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === 'Insider').querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus');
await admin.click('Avaa', 'What surprised you today?');
await part.waitFor(part.hasText('What surprised you today?'), 'avoin osallistujalle');
await part.js(`(() => { const a = document.querySelector('form.poll textarea'); a.value = ${JSON.stringify(EVIL)}; document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus 2');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('1 vastausta')`, 'vastaus hallinnassa', 8000);

// CSV
const dir = mkdtempSync(join(tmpdir(), 'hessutalks-csv-'));
await admin.cdp('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
await admin.click('Vie CSV');
let file = null;
for (let i = 0; i < 50 && !file; i++) {
  await new Promise((r) => setTimeout(r, 100));
  file = readdirSync(dir).find((f) => f.endsWith('.csv'));
}
if (!file) throw new Error('CSV:tä ei syntynyt');
const text = readFileSync(join(dir, file), 'utf8');
rmSync(dir, { recursive: true });
const lines = text.split('\r\n');
if (text.charCodeAt(0) !== 0xfeff) throw new Error('BOM puuttuu');
if (!lines[0].endsWith('Sarja;Sarjan nimi;Nro;Kysymys;Tyyppi;Vaihtoehto tai vastaus;Määrä;Aikaleima (UTC);Piilotettu')) throw new Error('Otsikko: ' + lines[0]);
if (!lines.some((l) => l.startsWith('M2;') && l.includes(';Insider;1;20'))) throw new Error('M2 Insider puuttuu:\n' + lines.filter((l) => l.startsWith('M2')).join('\n'));
const evilLine = lines.find((l) => l.startsWith('WRAP-FRI;') && l.includes('HYPERLINK'));
if (!evilLine || !evilLine.includes(`"'=HYPERLINK(""http://evil.example"",""klik"")"`)) throw new Error('Kaavainjektio ei estetty: ' + evilLine);
if (/voter|[0-9a-f]{32}/.test(text)) throw new Error('CSV:ssä osallistujatunniste');
step(`CSV ${file}: BOM, otsikko, M2 Insider 1, kaava "${EVIL}" muutettu tekstiksi ('), ei osallistujatunnisteita`);

// Monistus ja siirto
await admin.click('Monista', 'M5 Governance and risk');
await admin.waitFor(`[...document.querySelectorAll('section.set-card .set-head .code')].some((e) => e.textContent === 'M5-2')`, 'monistettu M5-2');
const m52 = await admin.js(`[...document.querySelectorAll('section.set-card')].find((s) => s.querySelector('.code').textContent === 'M5-2').innerText`);
if (!m52.includes('M5 Governance and risk (kopio)') || !m52.includes('3 kysymystä')) throw new Error('Monistus: ' + m52);
await admin.js(`(() => { const card = [...document.querySelectorAll('article.poll-card')].find((c) => c.innerText.includes('Your most important takeaway')); const sel = card.querySelector('select.move-set'); sel.value = [...sel.options].find((o) => o.text.startsWith('WRAP-FRI')).value; sel.dispatchEvent(new Event('change')); return true; })()`);
await admin.waitFor(`[...document.querySelectorAll('section.set-card')].find((s) => s.querySelector('.code').textContent === 'WRAP-FRI').innerText.includes('Your most important takeaway')`, 'siirto WRAP-FRI:hin');
step('Sarjan monistus (M5-2, 3 kysymystä) ja kysymyksen siirto CLOSE-SAT → WRAP-FRI');

// Esikatselu osallistujan ulkoasussa ja projektorilla
await admin.click('Esikatsele', 'Is this a risk? \'A DDoS attack');
const pv = await attach(port, '/admin/esikatselu');
await pv.waitFor(pv.hasText('A DDoS attack causes 2 hours'), 'osallistujan esikatselu');
if (await pv.js(`document.body.innerText.includes('correct') || !!document.querySelector('.poll-choice.correct')`)) throw new Error('Esikatselu paljasti oikean vastauksen');
await pv.js(`(() => { document.querySelector('.poll-choice input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await pv.waitFor(pv.hasText('Preview: the answer is not sent.'), 'esikatselu ei lähetä');
await admin.click('Esikatsele projektorilla', 'Is this a risk? \'A DDoS attack');
const st = await attach(port, '/admin/esitys');
await st.waitFor(`document.querySelector('.poll-stage-prompt')?.textContent.includes('A DDoS attack')`, 'projektorin esikatselu');
step('Esikatselu: osallistujan kortti (englanniksi, ei lähetä, ei oikeaa vastausta) ja projektorin näkymä');

const errs = [...admin.logs, ...part.logs, ...pv.logs, ...st.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
