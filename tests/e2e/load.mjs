// Kuormitus (vaatimus 8, H13): 150 osallistujaa (scripts/load-test.mjs) ja oikea hallinta + esitysikkuna.
// Mittaa: avatun kysymyksen näkyminen kaikille ja viive viimeisestä vastauksesta esitysnäkymän vastausmäärään.
// Ajo: scripts/e2e.sh load.mjs  (ei oletusajossa: kestää noin minuutin)
import { tab, attach, step, setupAdmin, createEvent } from './lib.mjs';
import { start, report } from '../../scripts/load-test.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const CLIENTS = Number(process.argv[4] || 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Load', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'M1'); await admin.fill('#set-title', 'M1 Load');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('M1 Load'), 'sarja');
await admin.click('Uusi kysymys', 'M1 Load');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-prompt', 'Which control matters most?');
await admin.fill('#poll-options', 'MFA\nBackups\nPatching\nTraining');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('Which control matters most?'), 'kysymys');
const url = await admin.js(`document.querySelector('.share .url a').href`);

await admin.click('Aktiivinen projektorille');
const stage = await attach(port, '/admin/esitys');
await stage.cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

const run = await start(url, { clients: CLIENTS, rampSeconds: 10, voteWindowSeconds: 10, log: () => {} });
const joinEnd = Date.now() + 30000;
while (run.stats.joined < CLIENTS && Date.now() < joinEnd) await sleep(100);
if (run.stats.joined < CLIENTS) throw new Error(`Liittyi vain ${run.stats.joined}/${CLIENTS}`);
await sleep(2000);
step(`${CLIENTS} osallistujaa liittyi ja kysyy tilaa 1,2 s välein`);

await admin.click('Seuraava →');
await admin.waitFor(`document.querySelector('.live-control').innerText.includes('Which control matters most?')`, 'aktiivinen');
const opened = Date.now();
await admin.click('Avaa vastauksille');
const pollId = () => [...run.stats.seen.keys()][0];
while ((run.stats.seen.get(pollId())?.length || 0) < CLIENTS && Date.now() - opened < 15000) await sleep(50);
const seen = run.stats.seen.get(pollId()) || [];
if (seen.length < CLIENTS) throw new Error(`Kysymys näkyi vain ${seen.length}/${CLIENTS} osallistujalle`);
const viewMs = Math.max(...seen) - opened;
step(`Avattu kysymys näkyi kaikille ${CLIENTS} osallistujalle ${viewMs} ms:ssa (vaatimus alle 2 000 ms)`);

// Vastausmäärä esitysnäkymässä: mitataan jokaisen vastauksen viive (hyväksytty → näkyy luvussa).
const lags = [];
let shown = 0;
const watchEnd = Date.now() + 30000;
while (Date.now() < watchEnd) {
  const acceptedTimes = run.stats.acceptedAt.get(pollId()) || [];
  const text = await stage.js(`document.querySelector('.poll-stage-count')?.textContent || ''`);
  const n = Number((text.match(/^(\d+) vastausta/) || [])[1] || 0);
  for (let i = shown; i < Math.min(n, acceptedTimes.length); i++) lags.push(Date.now() - acceptedTimes[i]);
  shown = Math.max(shown, n);
  if (shown >= CLIENTS) break;
  await sleep(50);
}
run.stop();
const r = report(run.stats);
console.log(JSON.stringify({ ...r, viewMs, presenterLagMs: { p50: lags.sort((a, b) => a - b)[Math.floor(lags.length / 2)], max: Math.max(...lags) } }, null, 2));
if (shown < CLIENTS) throw new Error(`Esitysnäkymässä ${shown}/${CLIENTS} vastausta`);
if (r.errors > 0) throw new Error('Virheellisiä pyyntöjä: ' + JSON.stringify(r.statuses));
const maxLag = Math.max(...lags);
step(`Kaikki ${CLIENTS} vastausta esitysnäkymässä; viive vastauksesta esitysnäkymään enintään ${maxLag} ms`);
if (viewMs > 2000) throw new Error(`Näkymän vaihto ${viewMs} ms > 2000 ms`);
if (maxLag > 2000) throw new Error(`Tulokset esitysnäkymässä ${maxLag} ms > 2000 ms`);
process.exit(0);
