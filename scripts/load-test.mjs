#!/usr/bin/env node
// Kuormitustesti (vaatimus 8: 150 samanaikaista osallistujaa, tulokset alle 2 s:ssa).
// Simuloi osallistujia kuten polls.js: luennon sivu ladataan kerran, tila luetaan 1,2 s välein staattisesta
// tilatiedostosta (Apache, ei PHP:tä; /api/live vain, jos tiedosto puuttuu tai luento on suljettu), ja avattuun
// kysymykseen vastataan satunnaisesti --vote-window sekunnin sisällä.
// Vastaukset salataan luennon julkisella avaimella (crypto_box_seal) kuten selaimessa: palvelin ei näe sisältöä.
//
//   node scripts/load-test.mjs http://localhost:8080/k/ABC234 --clients 150 --duration 60
//   node scripts/load-test.mjs https://hessujarvinen.com/hessutalks/k/KOODI --production --clients 150
//
// Tuotantoon ajetaan vain erilliselle testiluennolle (--production vaaditaan https-osoitteelle).
// Ajo keskeytyy, jos yli 20 % pyynnöistä epäonnistuu 10 sekunnin aikana (ei kuormiteta rikkinäistä palvelua).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const POLL_MS = 1200;
const MAX_BACKOFF_MS = 8000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_CLIENTS = 300;
const FILE_MAX_MISSES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
};

/** Luennon sivulta osallistujan tarvitsemat tiedot (sama data-* kuin polls.js käyttää). */
export async function loadEventPage(url) {
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`Luennon sivu: HTTP ${res.status}`);
  const html = await res.text();
  const ask = html.match(/<[^>]*\sdata-pk="[^"]*"[^>]*>/)?.[0];
  const box = html.match(/<[^>]*\sdata-answer-endpoint="[^"]*"[^>]*>/)?.[0];
  if (!ask || !box) throw new Error('Luennon sivulta puuttuu avain tai kyselyalue (onko luento auki?)');
  const origin = new URL(url).origin;
  return {
    origin,
    code: attr(ask, 'data-code'),
    pk: attr(ask, 'data-pk'),
    token: attr(ask, 'data-token'),
    lang: attr(ask, 'data-lang') || 'en',
    live: new URL(attr(box, 'data-endpoint'), origin).href,
    file: attr(box, 'data-live-file') ? new URL(attr(box, 'data-live-file'), origin).href : null,
    answer: new URL(attr(box, 'data-answer-endpoint'), origin).href,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summary(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s.length ? s[s.length - 1] : null };
}

function answerFor(poll, i) {
  const cfg = poll.config || {};
  const options = Array.isArray(cfg.options) ? cfg.options.length : 0;
  switch (poll.type) {
    case 'single': return Math.floor(Math.random() * Math.max(options, 1));
    case 'multi': return [Math.floor(Math.random() * Math.max(options, 1))];
    case 'likert': return 1 + Math.floor(Math.random() * 5);
    case 'scale': {
      const min = Number.isInteger(cfg.min) ? cfg.min : 1;
      const max = Number.isInteger(cfg.max) ? cfg.max : 5;
      return min + Math.floor(Math.random() * (max - min + 1));
    }
    case 'words': return 'kuorma' + (i % 20);
    default: return 'Kuormitustesti ' + i;
  }
}

/**
 * Käynnistää osallistujat. Palauttaa olion, jolla ajon voi lopettaa (stop) ja jonka stats-kentästä
 * selaintesti voi lukea tilanteen kesken ajon (esim. milloin viimeinen vastaus hyväksyttiin).
 */
export async function start(url, { clients = 150, rampSeconds = 15, voteWindowSeconds = 10, log = console.log } = {}) {
  if (clients < 1 || clients > MAX_CLIENTS) throw new Error(`--clients 1–${MAX_CLIENTS}`);
  const sodium = require('../public/assets/vendor/sodium.js');
  await sodium.ready;

  const stats = {
    startedAt: Date.now(), joined: 0, live: [], file: [], answer: [], statuses: {}, errors: 0, requests: 0,
    seen: new Map(),      // kysymyksen id → [aika, jolloin kukin osallistuja näki sen]
    accepted: new Map(),  // kysymyksen id → hyväksyttyjen vastausten lukumäärä
    acceptedAt: new Map(), // kysymyksen id → hyväksyttyjen vastausten ajat (selaintesti mittaa viiveen esitysnäkymään)
    aborted: null,
  };
  const recent = [];      // [aika, ok] viimeisten 10 s ajalta
  let stopped = false;
  const timers = new Set();

  const count = (status, ok) => {
    stats.requests++;
    stats.statuses[status] = (stats.statuses[status] || 0) + 1;
    if (!ok) stats.errors++;
    const now = Date.now();
    recent.push([now, ok]);
    while (recent.length && recent[0][0] < now - 10000) recent.shift();
    if (recent.length >= 50 && recent.filter((r) => !r[1]).length / recent.length > 0.2 && !stats.aborted) {
      stats.aborted = `Yli 20 % pyynnöistä epäonnistui 10 s aikana (${JSON.stringify(stats.statuses)})`;
      log('!! ' + stats.aborted + ' – keskeytetään');
      stop();
    }
  };

  const timed = async (fn) => {
    const ctrl = new AbortController();
    const abort = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const res = await fn(ctrl.signal);
      const body = await res.json().catch(() => ({}));
      return { res, body, ms: performance.now() - t0 };
    } finally {
      clearTimeout(abort);
    }
  };

  const later = (ms, fn) => {
    const t = setTimeout(() => { timers.delete(t); if (!stopped) fn(); }, ms);
    timers.add(t);
  };

  async function participant(i) {
    let page;
    try {
      page = await loadEventPage(url);
    } catch (e) {
      count('page-error', false);
      log(`osallistuja ${i}: ${e.message}`);
      return;
    }
    stats.joined++;
    const voter = sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.URLSAFE_NO_PADDING);
    const publicKey = sodium.from_base64(page.pk, sodium.base64_variants.ORIGINAL);
    let version = null;
    let failures = 0;
    const answered = new Set();

    const vote = async (poll) => {
      const payload = JSON.stringify({ v: 1, e: page.code, p: poll.id, a: answerFor(poll, i), ts: new Date().toISOString() });
      const ciphertext = sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(payload), publicKey), sodium.base64_variants.ORIGINAL);
      try {
        const { res, ms } = await timed((signal) => fetch(page.answer, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Origin: page.origin, 'Sec-Fetch-Site': 'same-origin' },
          body: JSON.stringify({ lang: page.lang, code: page.code, token: page.token, poll: poll.id, voter, ciphertext }),
        }));
        stats.answer.push(ms);
        count('answer ' + res.status, res.status === 201);
        if (res.status === 201) {
          stats.accepted.set(poll.id, (stats.accepted.get(poll.id) || 0) + 1);
          if (!stats.acceptedAt.has(poll.id)) stats.acceptedAt.set(poll.id, []);
          stats.acceptedAt.get(poll.id).push(Date.now());
        }
      } catch (e) {
        count('answer ' + (e.name === 'AbortError' ? 'timeout' : 'network'), false);
      }
    };

    let fileMisses = 0;
    const api = async () => {
      const q = `?code=${encodeURIComponent(page.code)}&lang=${encodeURIComponent(page.lang)}` + (version !== null ? `&v=${version}` : '');
      const r = await timed((signal) => fetch(page.live + q, { signal, cache: 'no-store' }));
      stats.live.push(r.ms);
      count('live ' + r.res.status, r.res.ok || r.res.status === 410);
      return r;
    };
    // Kuten polls.js fetchState: tiedosto ensin, PHP vain tarvittaessa.
    const state = async () => {
      if (!page.file || fileMisses >= FILE_MAX_MISSES) return api();
      const r = await timed((signal) => fetch(page.file, { signal, cache: 'no-store' }));
      stats.file.push(r.ms);
      count('file ' + r.res.status, r.res.ok || r.res.status === 404);
      if (r.res.ok && typeof r.body.v === 'number') {
        fileMisses = 0;
        const expired = typeof r.body.closes_at === 'number' && Date.now() / 1000 >= r.body.closes_at;
        if (!r.body.closed && !expired) return r;
      } else if (r.res.status === 404) {
        fileMisses++;
      } else if (!r.res.ok) {
        return r;
      }
      return api();
    };

    const refresh = async () => {
      try {
        const { res, body } = await state();
        if (res.status === 410) return;   // luento suljettu: osallistuja lopettaa kuten selaimessa
        if (!res.ok) throw new Error(String(res.status));
        failures = 0;
        if (!body.unchanged && body.v !== version) {
          version = typeof body.v === 'number' ? body.v : null;
          const poll = body.poll;
          if (poll && poll.status === 'open' && !answered.has(poll.id)) {
            answered.add(poll.id);
            if (!stats.seen.has(poll.id)) stats.seen.set(poll.id, []);
            stats.seen.get(poll.id).push(Date.now());
            later(Math.random() * voteWindowSeconds * 1000, () => vote(poll));
          }
        }
        later(POLL_MS, refresh);
      } catch (e) {
        if (e.name === 'AbortError') count('live timeout', false);
        else if (!/^\d+$/.test(e.message)) count('live network', false);
        failures++;
        later(Math.min(POLL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS), refresh);
      }
    };
    refresh();
  }

  // Osallistujat liittyvät tasaisesti rampSeconds-sekunnin aikana (QR-koodi luennon alussa).
  for (let i = 0; i < clients; i++) later((i / clients) * rampSeconds * 1000, () => participant(i));

  function stop() {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  }

  return { stats, stop };
}

export function report(stats) {
  const seconds = (Date.now() - stats.startedAt) / 1000;
  const polls = [...stats.seen.entries()].map(([id, times]) => ({
    id, seenBy: times.length, spreadMs: Math.max(...times) - Math.min(...times), accepted: stats.accepted.get(id) || 0,
  }));
  return {
    seconds: Math.round(seconds), joined: stats.joined, requests: stats.requests,
    rps: Math.round((stats.requests / seconds) * 10) / 10, errors: stats.errors, statuses: stats.statuses,
    fileMs: summary(stats.file.map(Math.round)), liveMs: summary(stats.live.map(Math.round)), answerMs: summary(stats.answer.map(Math.round)), polls, aborted: stats.aborted,
  };
}

function args(argv) {
  const out = { url: null, clients: 150, duration: 60, ramp: 15, voteWindow: 10, production: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--production') out.production = true;
    else if (a === '--clients') out.clients = Number(argv[++i]);
    else if (a === '--duration') out.duration = Number(argv[++i]);
    else if (a === '--ramp') out.ramp = Number(argv[++i]);
    else if (a === '--vote-window') out.voteWindow = Number(argv[++i]);
    else if (!a.startsWith('--')) out.url = a;
    else throw new Error('Tuntematon valitsin ' + a);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  if (!o.url || !/\/k\/[A-Za-z0-9-]+\/?$/.test(o.url)) {
    console.error('Anna luennon osallistujalinkki, esim. http://localhost:8080/k/ABC234');
    process.exit(2);
  }
  if (o.url.startsWith('https://') && !o.production) {
    console.error('https-osoite: lisää --production ja käytä vain erillistä testiluentoa.');
    process.exit(2);
  }
  console.log(`${o.clients} osallistujaa, liittyminen ${o.ramp} s, kesto ${o.duration} s, vastaukset ${o.voteWindow} s sisällä avauksesta → ${o.url}`);
  const run = await start(o.url, { clients: o.clients, rampSeconds: o.ramp, voteWindowSeconds: o.voteWindow });
  const tick = setInterval(() => {
    const r = report(run.stats);
    console.log(`${r.seconds} s: liittyneet ${r.joined}, ${r.rps} pyyntöä/s, virheet ${r.errors}, tiedosto p95 ${r.fileMs.p95} ms, PHP-tilakyselyt ${r.liveMs.n}, vastaukset ${r.polls.map((p) => p.accepted).join('/') || 0}`);
  }, 5000);
  const end = Date.now() + o.duration * 1000;
  while (Date.now() < end && !run.stats.aborted) await sleep(250);
  clearInterval(tick);
  run.stop();
  await sleep(REQUEST_TIMEOUT_MS);
  console.log(JSON.stringify(report(run.stats), null, 2));
  process.exit(run.stats.aborted ? 1 : 0);
}
