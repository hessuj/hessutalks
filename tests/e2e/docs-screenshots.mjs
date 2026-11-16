// Käyttöohjeen ruutukaappaukset (docs/kayttoohje.md, docs/user-guide.md). Ei kuulu oletusajoon.
// Käy läpi luennoitsijan, osallistujan ja esitysnäytön toiminnot testidatalla ja tallentaa kuvat, joihin
// kuvattu painike tai alue on merkitty punaisella (numero viittaa ohjeen tekstiin).
//
//   scripts/e2e.sh "docs-screenshots.mjs fi" "docs-screenshots.mjs en"
//
// Kuvat: docs/kuvat/<kieli>/. Kieli määrää luennon sisällön ja osallistujan kielen (hallinta on aina suomeksi).
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tab, attach, connect, step, lit } from './lib.mjs';
import { loadEventPage } from '../../scripts/load-test.mjs';
import { createRequire } from 'node:module';

const [port, app, LANG = 'fi'] = [process.argv[2], process.argv[3], process.argv[4]];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'kuvat', LANG);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fi = LANG === 'fi';

// ---------------------------------------------------------------- sisältö (testidataa)

const C = fi ? {
  event: 'Tietoturvan perusteet, luento 3',
  set1: ['M1', 'M1 Uhkat ja riskit'],
  q1: 'Mikä näistä on kalasteluviestin tyypillisin tunnusmerkki?',
  q1opts: ['Kiireellisyys ja uhkailu', 'Yrityksen logo', 'Allekirjoitus'],
  q1expl: ['Oikein: kiire saa toimimaan ajattelematta.', 'Logon voi kopioida.', 'Allekirjoituksen voi väärentää.'],
  q2: 'Pohdi: miten organisaatiosi varautuu kiristyshaittaohjelmaan?',
  words: 'Tietoturva yhdellä sanalla?',
  likert: 'Tunnistan kalasteluviestin helposti.',
  likertLabels: ['Täysin eri mieltä', 'Täysin samaa mieltä'],
  multi: 'Mitkä näistä ovat henkilötietoja?',
  multiOpts: ['Nimi', 'IP-osoite', 'Huoneen lämpötila'],
  scale: 'Kuinka todennäköisesti suosittelisit kurssia?',
  open: 'Mikä jäi tänään mieleen?',
  set2: ['M2', 'M2 Suojautuminen'], set3: ['LOPPU', 'Lopuksi'],
  wordAnswers: ['luottamus', 'salaus', 'luottamus', 'riski', 'salasana', 'luottamus', 'salaus', 'varmuuskopio', 'riski', 'luottamus', 'paska'],
  openAnswers: ['Kalasteluviestien tunnusmerkit', 'Varmuuskopiot pitää testata', 'Monivaiheinen tunnistautuminen kaikkialle', 'Tää oli ihan perseestä'],
  nicks: ['Mansikka', 'Kysyjä_7', 'Tux'],
  messages: [['question', 'Pitääkö varmuuskopiot salata myös pilvessä?'], ['feedback', 'Hyvä esimerkki tuo kalastelutapaus!'], ['question', 'Onko passkey turvallisempi kuin salasana?']],
} : {
  event: 'Cybersecurity Basics, lecture 3',
  set1: ['M1', 'M1 Threats and risks'],
  q1: 'Which of these is the most typical sign of a phishing message?',
  q1opts: ['Urgency and threats', 'The company logo', 'A signature'],
  q1expl: ['Correct: urgency makes people act without thinking.', 'A logo can be copied.', 'A signature can be forged.'],
  q2: 'Reflect: how is your organisation prepared for ransomware?',
  words: 'Cybersecurity in one word?',
  likert: 'I can easily recognise a phishing message.',
  likertLabels: ['Strongly disagree', 'Strongly agree'],
  multi: 'Which of these are personal data?',
  multiOpts: ['Name', 'IP address', 'Room temperature'],
  scale: 'How likely would you recommend this course?',
  open: 'What stuck with you today?',
  set2: ['M2', 'M2 Protection'], set3: ['WRAP', 'Wrap-up'],
  wordAnswers: ['trust', 'encryption', 'trust', 'risk', 'password', 'trust', 'encryption', 'backup', 'risk', 'trust', 'shit'],
  openAnswers: ['Signs of phishing messages', 'Backups must be tested', 'Multi-factor authentication everywhere', 'This was fucking boring'],
  nicks: ['Strawberry', 'Asker_7', 'Tux'],
  messages: [['question', 'Should backups in the cloud be encrypted too?'], ['feedback', 'Great example with the phishing case!'], ['question', 'Is a passkey safer than a password?']],
};

const IMPORT = {
  event: { title: C.event },
  sets: [
    { id: C.set2[0], title: C.set2[1], questions: [
      { type: 'wordcloud', text: C.words, maxWords: 1 },
      { type: 'scale', text: C.likert, min: 1, max: 5, minLabel: C.likertLabels[0], maxLabel: C.likertLabels[1] },
      { type: 'multi', text: C.multi, options: C.multiOpts, correct: [0, 1] },
      { type: 'scale', text: C.scale, min: 0, max: 10 },
    ] },
    { id: C.set3[0], title: C.set3[1], questions: [{ type: 'open', text: C.open, multipleAnswers: true }] },
  ],
};

// ---------------------------------------------------------------- merkinnät ja kuvaus

// Sivulle lisättävä apuri: elementti tekstin perusteella (napit, linkit, välilehdet).
const HELPERS = `window.__el = (text, scopeSel, sel) => {
  const scopes = scopeSel ? [...document.querySelectorAll(scopeSel)] : [document];
  for (const s of scopes) {
    const e = [...s.querySelectorAll(sel || 'button, a, summary, label, select, .tab')].find((x) => x.textContent.trim() === text);
    if (e) return e;
  }
  return null;
};`;

/**
 * Tallentaa kuvan. marks: [{ el: 'JS-lauseke, joka palauttaa elementin', label?: '1', box?: true }].
 * area: JS-lauseke elementille, jonka alue kuvataan (oletus: koko näkymä). Merkinnät laajentavat aluetta.
 */
async function shot(t, name, { marks = [], area = null, pad = 14 } = {}) {
  await t.js(HELPERS);
  const r = await t.js(`(() => {
    const marks = [${marks.map((m) => `{ el: (${m.el}), label: ${lit(m.label || '')}, box: ${!!m.box} }`).join(',')}];
    const sx = window.scrollX, sy = window.scrollY;
    const rects = [];
    const layer = document.createElement('div');
    layer.id = '__marks';
    Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647', pointerEvents: 'none' });
    document.body.appendChild(layer);
    marks.forEach((m, i) => {
      if (!m.el) throw new Error('merkittävä elementti puuttuu: ' + i);
      const b = m.el.getBoundingClientRect();
      // Tiukka kehys: vierekkäiset napit erottuvat toisistaan (alueille hieman väljempi).
      const pad = m.box ? 7 : 4;
      const w = b.width + 2 * pad, h = b.height + 2 * pad;
      const x = b.left + sx - pad, y = b.top + sy - pad;
      const o = document.createElement('div');
      Object.assign(o.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
        border: '3px solid #e5003a', borderRadius: m.box ? '12px' : '9px', boxShadow: '0 0 0 2px #fff, inset 0 0 0 1px #fff', boxSizing: 'border-box' });
      layer.appendChild(o);
      rects.push({ x, y, w, h });
      if (m.label) {
        const n = document.createElement('div');
        n.textContent = m.label;
        Object.assign(n.style, { position: 'absolute', left: (x - 13) + 'px', top: (y - 15) + 'px', width: '24px', height: '24px',
          borderRadius: '50%', background: '#e5003a', color: '#fff', font: 'bold 14px/24px system-ui, sans-serif', textAlign: 'center',
          boxShadow: '0 0 0 2px #fff' });
        layer.appendChild(n);
        rects.push({ x: x - 13, y: y - 15, w: 24, h: 24 });
      }
    });
    const doc = document.documentElement;
    let box;
    const areaEl = ${area || 'null'};
    if (areaEl) {
      const b = areaEl.getBoundingClientRect();
      box = { x: b.left + sx, y: b.top + sy, w: b.width, h: b.height };
    } else {
      box = { x: sx, y: sy, w: window.innerWidth, h: window.innerHeight };
    }
    for (const q of rects) {
      const x2 = Math.max(box.x + box.w, q.x + q.w), y2 = Math.max(box.y + box.h, q.y + q.h);
      box.x = Math.min(box.x, q.x); box.y = Math.min(box.y, q.y); box.w = x2 - box.x; box.h = y2 - box.y;
    }
    const p = areaEl || rects.length ? ${pad} : 0;
    const x = Math.max(0, box.x - p), y = Math.max(0, box.y - p);
    return { x, y, width: Math.min(doc.scrollWidth, box.x + box.w + p) - x, height: Math.min(Math.max(doc.scrollHeight, window.innerHeight + sy), box.y + box.h + p) - y };
  })()`);
  const { data } = await t.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scale: 1 } });
  await t.js(`document.getElementById('__marks')?.remove(); true`);
  writeFileSync(join(OUT, name + '.png'), Buffer.from(data, 'base64'));
  step('kuva ' + name);
}

const el = (text, scope, sel) => `window.__el(${lit(text)}, ${lit(scope || null)}, ${lit(sel || null)})`;
const q = (sel) => `document.querySelector(${lit(sel)})`;
const view = (t, width, height, mobile = false) => t.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
const top = (t) => t.js('window.scrollTo(0, 0); true');
const into = async (t, expr) => { await t.js(HELPERS); await t.js(`(${expr}).scrollIntoView({ block: 'center' }); true`); };

/** Uusi osallistuja omassa selainkontekstissaan (oma localStorage = oma nimimerkki ja vastaajatunniste). */
async function isolated(url) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const call = (method, params) => new Promise((resolve) => {
    const id = ++seq;
    const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', on); resolve(m.result); } };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const { browserContextId } = await call('Target.createBrowserContext', {});
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true });
  ws.close();
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = await connect(list.find((x) => x.id === targetId).webSocketDebuggerUrl);
  await t.cdp('Network.enable');
  await t.cdp('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': fi ? 'fi-FI,fi;q=0.9' : 'en-GB,en;q=0.9' } });
  await view(t, 390, 844, true);
  await t.cdp('Page.navigate', { url });
  return t;
}

// Vastaukset suoraan rajapintaan salattuina (kuten scripts/load-test.mjs), jotta tuloksissa on useita vastaajia.
const require = createRequire(import.meta.url);
const sodium = require('../../public/assets/vendor/sodium.js');
await sodium.ready;
async function votes(eventUrl, pollId, answers) {
  const page = await loadEventPage(eventUrl);
  const pk = sodium.from_base64(page.pk, sodium.base64_variants.ORIGINAL);
  for (const a of answers) {
    const voter = sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.URLSAFE_NO_PADDING);
    const payload = JSON.stringify({ v: 1, e: page.code, p: pollId, a, ts: new Date().toISOString() });
    const ciphertext = sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(payload), pk), sodium.base64_variants.ORIGINAL);
    const res = await fetch(page.answer, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: page.origin, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ lang: page.lang, code: page.code, token: page.token, poll: pollId, voter, ciphertext }) });
    if (res.status !== 201) throw new Error('Vastaus hylättiin: ' + res.status + ' ' + (await res.text()));
  }
}
const pollId = (admin, prompt) => admin.js(`(async () => {
  const s = await (await fetch('/admin/api/state', { credentials: 'same-origin' })).json();
  const p = await (await fetch('/admin/api/events/' + s.events[0].id + '/polls', { credentials: 'same-origin' })).json();
  return p.polls.find((x) => x.prompt === ${lit(prompt)}).id;
})()`);

// ================================================================ 1. käyttöönotto

const admin = await tab(port);
await view(admin, 1200, 860);
await admin.cdp('WebAuthn.enable', { enableUI: false });
await admin.cdp('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
} });
await admin.cdp('Page.navigate', { url: app + '/admin' });
await admin.waitFor(admin.has('#setup-token'), 'käyttöönotto');
await admin.fill('#setup-token', 'E2E-TESTI-TOKEN');
await shot(admin, '01-kayttoonotto', { area: q('main'), marks: [
  { el: q('#setup-token'), label: '1', box: true }, { el: q('#pk-name'), label: '2', box: true }, { el: el('Luo passkey'), label: '3' }] });
await admin.submit('#setup-token');
await admin.waitFor(admin.has('#pp1'), 'avainten luonti');
await admin.fill('#pp1', 'e2e-oikein-pitka-tunnuslause'); await admin.fill('#pp2', 'e2e-oikein-pitka-tunnuslause');
await shot(admin, '02-salausavaimet', { area: q('main'), marks: [
  { el: q('#pp1'), label: '1', box: true }, { el: q('#pp2'), label: '2', box: true }, { el: el('Luo avaimet'), label: '3' }] });
await admin.submit('#pp1');
await admin.waitFor(admin.has('#ev-title'), 'luennot', 60000);

// ================================================================ 2. luento

await admin.fill('#ev-title', C.event);
await admin.fill('#ev-hours', '168');
await admin.fill('#ev-lang', LANG);
await shot(admin, '03-luo-luento', { area: q('main'), marks: [
  { el: q('#ev-title'), label: '1', box: true }, { el: q('#ev-hours'), label: '2', box: true },
  { el: q('#ev-lang'), label: '3', box: true }, { el: el('Luo luento'), label: '4' }] });
await admin.submit('#ev-title');
await admin.waitFor(admin.has('#tab-polls'), 'luennon näkymä');
const eventUrl = await admin.js(`document.querySelector('.share .url a').href`);

await shot(admin, '04-luennon-sivu', { area: q('.share'), marks: [
  { el: q('.share img'), label: '1', box: true }, { el: q('.big-code'), label: '2', box: true }, { el: q('.share .url a'), label: '3', box: true },
  { el: el('Sulje kysymykset'), label: '4' }, { el: el('Poista luento'), label: '5' }, { el: q('#event-lang'), label: '6', box: true }] });
await shot(admin, '05-tyokalupalkki', { area: q('.toolbar'), marks: [
  { el: el('Muokkaa otsikkoa'), label: '1' }, { el: el('Kaikki luennot'), label: '2' },
  { el: el('Asetukset'), label: '3' }, { el: el('Kirjaudu ulos'), label: '4' }] });
await admin.click('Muokkaa otsikkoa');
await admin.waitFor(admin.has('#event-title-edit'), 'otsikon muokkaus');
await shot(admin, '06-muokkaa-otsikkoa', { area: q('.title-edit'), marks: [{ el: q('#event-title-edit'), label: '1', box: true }, { el: el('Tallenna otsikko'), label: '2' }] });
await admin.click('Peruuta');

// ================================================================ 3. valmistelu: sarjat ja kysymykset

await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', C.set1[0]); await admin.fill('#set-title', C.set1[1]);
await shot(admin, '07-uusi-sarja', { area: q('.polls-admin'), marks: [
  { el: el('Uusi sarja'), label: '1' }, { el: q('#set-slug'), label: '2', box: true }, { el: q('#set-title'), label: '3', box: true }, { el: el('Luo sarja'), label: '4' }] });
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText(C.set1[1]), 'sarja');

await admin.click('Uusi kysymys', C.set1[1]);
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-prompt', C.q1);
await admin.fill('#poll-options', C.q1opts.join('\n'));
await admin.fill('#poll-correct', '1');
await admin.fill('#poll-explanations', C.q1expl.join('\n'));
await into(admin, q('.poll-form'));
await shot(admin, '08-uusi-kysymys', { area: q('.poll-form'), marks: [
  { el: q('#poll-type'), label: '1', box: true }, { el: q('#poll-prompt'), label: '2', box: true }, { el: q('#poll-options'), label: '3', box: true },
  { el: q('#poll-correct'), label: '4', box: true }, { el: q('#poll-explanations'), label: '5', box: true }, { el: el('Luo kysymys'), label: '6' }] });
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText(C.q1), 'kysymys 1');

await admin.click('Uusi kysymys', C.set1[1]);
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake 2');
await admin.fill('#poll-type', 'open');
await admin.waitFor(admin.has('#poll-open-max'), 'avoimen kentät');
await admin.fill('#poll-prompt', C.q2);
await admin.fill('#poll-open-max', '3500');
await into(admin, q('.poll-form'));
await shot(admin, '09-avoin-kysymys', { area: q('.poll-form'), marks: [
  { el: q('#poll-type'), label: '1', box: true }, { el: q('label.check'), label: '2', box: true }, { el: q('#poll-open-max'), label: '3', box: true }] });
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText(C.q2), 'kysymys 2');

// JSON-tuonti: tiedosto syötetään piilotettuun tiedostokenttään (sama kuin Tuo JSON -napin valinta).
// Oma, satunnaisesti nimetty kansio (0700): ennalta arvattava nimi yhteisessä temp-kansiossa altistaisi
// symlinkkihyökkäykselle monen käyttäjän koneella (CodeQL js/insecure-temporary-file).
const tmp = mkdtempSync(join(tmpdir(), 'hessutalks-ohje-'));
const file = join(tmp, `tuonti-${LANG}.json`);
writeFileSync(file, JSON.stringify(IMPORT, null, 2));
const { root } = await admin.cdp('DOM.getDocument', {});
const { nodeId } = await admin.cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '.polls-admin input[type=file]' });
await admin.cdp('DOM.setFileInputFiles', { nodeId, files: [file] });
await admin.waitFor(admin.has('.import-preview'), 'tuonnin yhteenveto');
await top(admin);
await shot(admin, '10-tuo-json', { area: q('.polls-admin'), marks: [{ el: el('Tuo JSON'), label: '1' }, { el: q('.import-preview'), label: '2', box: true }, { el: el('Tuo', '.import-preview'), label: '3' }] });
await admin.click('Tuo');
await admin.waitFor(admin.hasText(C.set2[1]), 'tuodut sarjat');
await admin.js(`document.querySelector('.polls-admin .notice')?.remove(); true`);
rmSync(tmp, { recursive: true, force: true });

await top(admin);
await shot(admin, '11-kysymykset-tyokalut', { area: q('.polls-admin > .toolbar'), marks: [
  { el: el('Uusi sarja'), label: '1' }, { el: el('Tuo JSON'), label: '2' }, { el: el('Vie JSON'), label: '3' },
  { el: el('Vie CSV'), label: '4' }, { el: el('Vie Markdown'), label: '5' }] });
const set1 = `[...document.querySelectorAll('section.set-card')].find((s) => s.querySelector('h3').textContent === ${lit(C.set1[1])})`;
await admin.js(`${set1}.querySelector('.set-tools-btn').click(); true`);
await admin.waitFor(`!!${set1}.querySelector('.set-tools')`, 'sarjan työkalut');
await shot(admin, '12-sarjan-painikkeet', { area: `${set1}.querySelector('.set-head')`, marks: [
  { el: el('Uusi kysymys', '.set-head'), label: '1' }, { el: `${set1}.querySelector('.set-tools-btn')`, label: '2' },
  { el: el('Muokkaa', '.set-tools'), label: '3' }, { el: el('↑', '.set-tools'), label: '4' }, { el: el('Vie JSON', '.set-tools'), label: '5' },
  { el: el('Vie CSV', '.set-tools'), label: '6' }, { el: el('Monista', '.set-tools'), label: '7' }, { el: el('Poista sarja', '.set-tools'), label: '8' }] });
await admin.js(`${set1}.querySelector('.set-tools-btn').click(); true`);
const item = (prompt) => `[...document.querySelectorAll('li.poll-item')].find((li) => li.querySelector('.run-prompt').textContent === ${lit(prompt)})`;
const item1 = item(C.q1);
await admin.js(`${item1}.querySelector('.poll-toggle').click(); true`);
await admin.waitFor(`!!${item1}.querySelector('.poll-detail')`, 'kysymys avattu');
await shot(admin, '13-kysymyksen-muokkaus', { area: item1, marks: [
  { el: `${item1}.querySelector('.poll-toggle')`, label: '1', box: true }, { el: `${item1}.querySelector('.hint.correct')`, label: '2', box: true },
  { el: el('Piilota', 'li.poll-item.expanded'), label: '3' }, { el: el('Esikatsele', 'li.poll-item.expanded'), label: '4' },
  { el: el('Esikatsele projektorilla', 'li.poll-item.expanded'), label: '5' }, { el: el('Muokkaa', 'li.poll-item.expanded'), label: '6' },
  { el: el('↑', 'li.poll-item.expanded'), label: '7' }, { el: `${item1}.querySelector('select.move-set')`, label: '8', box: true },
  { el: el('Tyhjennä vastaukset', 'li.poll-item.expanded'), label: '9' }, { el: el('Poista', 'li.poll-item.expanded'), label: '10' }] });

// Esikatselu osallistujan ulkoasussa (oma ikkuna)
await admin.click('Esikatsele', C.q1);
const prev = await attach(port, '/admin/esikatselu');
await view(prev, 390, 700, true);
await prev.waitFor(`!!document.querySelector('.poll-choice')`, 'esikatselu');
await shot(prev, '14-esikatselu', { marks: [{ el: q('main .notice'), label: '1', box: true }] });
await prev.cdp('Page.close').catch(() => {});
await admin.click('Piilota', C.q1);
await admin.waitFor(`!${item1}.querySelector('.poll-detail')`, 'kysymys suljettu');

// ================================================================ 4. osallistuja liittyy

const home = await isolated(app + '/');
await home.waitFor(home.has('#k'), 'etusivu');
const code = await admin.js(`document.querySelector('.big-code').textContent`);
await home.fill('#k', code);
await shot(home, '15-etusivu', { marks: [{ el: q('#k'), label: '1', box: true }, { el: q('.code-form button'), label: '2' }] });
await home.cdp('Page.close').catch(() => {});

const part = await isolated(eventUrl);
await part.waitFor(part.has('#ask-form:not([hidden])'), 'osallistujan sivu');
await part.waitFor(`!document.getElementById('polls-zone').hidden`, 'kyselyalue');
await shot(part, '16-osallistuja', { marks: [
  { el: q('#polls-zone'), label: '1', box: true }, { el: q('.zone-nick'), label: '2', box: true },
  { el: q('.zone-ask'), label: '3', box: true }, { el: q('.lang-switch'), label: '4', box: true }] });
await part.fill('#nickname', C.nicks[0]);
await part.js(`(() => { document.querySelector('input[name=kind][value=question]').checked = true; const t = document.getElementById('text'); t.value = ${lit(C.messages[0][1])}; t.dispatchEvent(new Event('input')); return true; })()`);
await into(part, q('.zone-nick'));
await shot(part, '17-kysy', { area: q('#ask-form'), marks: [
  { el: q('#nickname'), label: '1', box: true }, { el: q('.kind'), label: '2', box: true }, { el: q('#text'), label: '3', box: true }, { el: q('#send'), label: '4' }] });
await part.js(`document.getElementById('ask-form').requestSubmit(); true`);
await part.waitFor(`!document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetetty');
await into(part, q('#status'));
await shot(part, '18-lahetetty', { area: q('#ask-form'), marks: [{ el: q('#nick-owned'), label: '1', box: true }, { el: q('#status'), label: '2', box: true }] });

// Muut osallistujat lähettävät viestejä (omat selainkontekstit)
for (let i = 1; i < C.messages.length; i++) {
  const p = await isolated(eventUrl);
  await p.waitFor(p.has('#ask-form:not([hidden])'), 'osallistuja ' + i);
  await p.fill('#nickname', C.nicks[i]);
  await p.js(`(() => { document.querySelector(${lit('input[name=kind][value=' + C.messages[i][0] + ']')}).checked = true; const t = document.getElementById('text'); t.value = ${lit(C.messages[i][1])}; t.dispatchEvent(new Event('input')); document.getElementById('ask-form').requestSubmit(); return true; })()`);
  await p.waitFor(`!document.getElementById('status').hidden && !/…$/.test(document.getElementById('status').textContent)`, 'lähetetty ' + i);
  await p.cdp('Page.close').catch(() => {});
}

// ================================================================ 5. luennolla: taulu ja kysymyksen rivi

await top(admin);
await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys#');
await view(stage, 1280, 720);
await stage.waitFor(`document.body.innerText.includes(${lit(code)})`, 'esitysnäyttö');
await shot(admin, '19-taulu', { area: q('.stage-bar'), marks: [
  { el: q('.stage-status'), label: '1', box: true }, { el: el('Avaa esitysnäyttö'), label: '2' }, { el: el('QR isona'), label: '3' },
  { el: el('Tyhjennä taulu'), label: '4' }, { el: q('.stage-bar .q-actions .hint'), label: '5', box: true }] });
await sleep(800);
await shot(stage, '20-esitysnaytto-odotus');

await top(admin);
await shot(admin, '21-kysymyslista', { area: q('.polls-admin'), marks: [
  { el: q('#tab-btn-polls'), label: '1', box: true }, { el: `${item1}.querySelector('.poll-toggle')`, label: '2', box: true },
  { el: `${item1}.querySelector('.board-btn')`, label: '3' }] });

// Kysymys taululle (näytetään ja avataan), vastauksia
await admin.click('Näytä taululla', C.q1);
await stage.waitFor(`document.querySelector('.poll-stage-prompt')?.textContent === ${lit(C.q1)}`, 'kysymys näytöllä');
await part.waitFor(`!!document.querySelector('.poll-choice')`, 'kysymys osallistujalla');
await part.js(`(() => { document.querySelectorAll('.poll-choice input')[0].click(); return true; })()`);
await top(part);
await shot(part, '23-osallistuja-vastaa', { area: q('#polls-zone'), marks: [{ el: q('.poll-choice'), label: '1', box: true }, { el: q('form.poll button[type=submit]'), label: '2' }] });
await part.js(`document.querySelector('form.poll').requestSubmit(); true`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus');
const id1 = await pollId(admin, C.q1);
await votes(eventUrl, id1, [0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 0, 0, 1]);
await admin.waitFor(`${item1}.querySelector('.run-count').textContent === '14'`, '14 vastausta', 15000);
await stage.waitFor(`document.querySelector('.poll-stage-count')?.textContent.startsWith('14')`, 'vastausmäärä näytöllä', 8000);
await into(admin, item1);
await shot(admin, '22-rivi-taululla', { area: `${item1}.querySelector('.poll-row')`, marks: [
  { el: `${item1}.querySelector('.badge.live')`, label: '1', box: true }, { el: `${item1}.querySelector('.run-count')`, label: '2', box: true },
  { el: el('Sulje', 'li.poll-item.staged'), label: '3' }, { el: el('Poista taululta', 'li.poll-item.staged'), label: '4' },
  { el: el('Näytä tulokset', 'li.poll-item.staged'), label: '5' }, { el: el('Paljasta oikea vastaus', 'li.poll-item.staged'), label: '6' }] });
await shot(stage, '24-esitysnaytto-kysymys', { marks: [{ el: q('.poll-stage-count'), label: '1', box: true }, { el: q('.poll-stage-foot img'), label: '2', box: true }] });
await admin.click('Näytä tulokset', C.q1);
await admin.click('Paljasta oikea vastaus', C.q1);
await stage.waitFor(`!!document.querySelector('.res-row.correct')`, 'paljastus näytöllä');
await sleep(1200);
await shot(stage, '25-esitysnaytto-tulokset', { marks: [{ el: q('.res-row.correct'), label: '1', box: true }] });
await part.waitFor(`!!document.querySelector('#polls .res-row.correct, #polls .correct')`, 'paljastus osallistujalla', 8000);
await top(part);
await shot(part, '26-osallistuja-tulokset', { area: q('#polls-zone') });

// Tulokset hallinnassa: rivin klikkaus avaa ne kysymyksen alle.
await admin.js(`${item1}.querySelector('.poll-toggle').click(); true`);
await admin.waitFor(`!!${item1}.querySelector('.poll-detail .res-row')`, 'tulokset hallinnassa');
await into(admin, item1);
await shot(admin, '28-tulokset-hallinnassa', { area: item1, marks: [
  { el: `${item1}.querySelector('.poll-detail .results')`, label: '1', box: true }, { el: el('Piilota', 'li.poll-item.expanded'), label: '2' }] });
await admin.click('Piilota', C.q1);

// Useampi kysymys taululla: sanapilvi ja Likert muiden rinnalle
for (const prompt of [C.words, C.likert]) {
  await admin.click('Näytä taululla', prompt);
  await admin.waitFor(`${item(prompt)}?.matches('.staged[data-status="open"]')`, 'auki taululla: ' + prompt);
}
await votes(eventUrl, await pollId(admin, C.words), C.wordAnswers);
await votes(eventUrl, await pollId(admin, C.likert), [4, 5, 3, 4, 4, 2, 5, 4, 3, 4]);
await admin.click('Näytä tulokset', C.likert);
await admin.click('Näytä tulokset', C.words);
await stage.waitFor(`document.querySelectorAll('.board .tile').length === 3 && !!document.querySelector('.res-cloud *')`, 'ruudukko', 10000);
await sleep(1500);
await top(admin);
await shot(admin, '29-useita-taululla', { area: q('.set-list'), marks: [
  { el: `document.querySelectorAll('li.poll-item.staged')[0]`, label: '1', box: true },
  { el: `document.querySelectorAll('li.poll-item.staged')[1]`, label: '2', box: true },
  { el: `document.querySelectorAll('li.poll-item.staged')[2]`, label: '3', box: true }] });
await shot(stage, '30-esitysnaytto-ruudukko');
await part.waitFor(`document.querySelectorAll('#polls form.poll, #polls .poll').length >= 2`, 'useita osallistujalla');
await top(part);
await shot(part, '31-osallistuja-useita', { area: q('#polls-zone') });

// Moderointi: sanapilven sana ja kirosanasuodatin (kysymyksen avautuvassa osassa)
const wordsItem = item(C.words);
await admin.js(`${wordsItem}.querySelector('.poll-toggle').click(); true`);
await admin.waitFor(`!!${wordsItem}.querySelector('.poll-hidden button')`, 'suodattimen osuma', 8000);
await into(admin, wordsItem);
await shot(admin, '32-sanapilvi-moderointi', { area: `${wordsItem}.querySelector('.poll-detail')`, marks: [
  { el: `[...${wordsItem}.querySelectorAll('.res-word')].find((w) => w.textContent === ${lit(C.wordAnswers[3])})`, label: '1' },
  { el: `${wordsItem}.querySelector('.poll-hidden')`, label: '2', box: true }] });
await admin.click('Piilota', C.words);

// Avoin kysymys: vastauksia, piilotus ja suodatin
await admin.click('Tyhjennä taulu');
await admin.waitFor(`!document.querySelector('li.poll-item.staged')`, 'taulu tyhjä');
await admin.click('Näytä taululla', C.open);
await admin.waitFor(`${item(C.open)}?.matches('.staged[data-status="open"]')`, 'avoin auki');
await votes(eventUrl, await pollId(admin, C.open), C.openAnswers);
await admin.click('Näytä tulokset', C.open);
const openItem = item(C.open);
await admin.js(`${openItem}.querySelector('.poll-toggle').click(); true`);
await admin.waitFor(`!!${openItem}.querySelector('.res-open li button') && !!${openItem}.querySelector('.poll-hidden button')`, 'avoimet vastaukset', 10000);
await into(admin, openItem);
await shot(admin, '33-avoin-moderointi', { area: `${openItem}.querySelector('.poll-detail')`, marks: [
  { el: `${openItem}.querySelector('.res-open li button')`, label: '1' }, { el: `${openItem}.querySelector('.poll-hidden')`, label: '2', box: true }] });
await admin.click('Piilota', C.open);

// Iso QR
await admin.click('Tyhjennä taulu');
await top(admin);
await admin.click('QR isona');
await sleep(1200);
await shot(stage, '34-iso-qr');
await admin.click('QR pieneksi');

// ================================================================ 6. vapaat kysymykset ja palautteet

await admin.js(`document.getElementById('tab-btn-question').click(); true`);
await admin.waitFor(`document.querySelectorAll('#tab-question li.q').length === ${C.messages.filter((m) => m[0] === 'question').length}`, 'viestit');
await sleep(2500);
await top(admin);
await sleep(300);
await shot(admin, '35-viestit', { area: q('#tab-question'), marks: [
  { el: q('#tab-btn-question'), label: '1', box: true }, { el: el('Näytä taululla', '#tab-question'), label: '2' },
  { el: el('Merkitse vastatuksi', '#tab-question'), label: '3' }, { el: el('Poista', '#tab-question'), label: '4' }] });
const msgButton = (tabSel, text, label) => admin.js(`[...[...document.querySelectorAll(${lit(tabSel + ' li.q')})].find((li) => li.innerText.includes(${lit(text)})).querySelectorAll('button')].find((b) => b.textContent === ${lit(label)}).click(), true`);
await msgButton('#tab-question', C.messages[2][1], 'Näytä taululla');
await msgButton('#tab-feedback', C.messages[1][1], 'Näytä taululla');
await stage.waitFor(`document.body.innerText.includes(${lit(C.messages[2][1])}) && document.body.innerText.includes(${lit(C.messages[1][1])})`, 'viestit näytöllä', 8000);
await sleep(1000);
await shot(stage, '36-esitysnaytto-viestit');
await admin.click('Tyhjennä taulu');

// ================================================================ 7. luentolista, asetukset, kirjautuminen

await admin.js(`document.getElementById('tab-btn-polls').click(); true`);
await admin.click('Kaikki luennot');
await admin.waitFor(admin.has('.event-list'), 'luentolista');
await shot(admin, '37-luentolista', { area: q('main'), marks: [{ el: q('.event-list li'), label: '1', box: true }, { el: el('Avaa', '.event-list'), label: '2' }] });

await admin.click('Asetukset');
await admin.waitFor(admin.hasText('Tietoturvaloki'), 'asetukset');
await shot(admin, '38-asetukset', { area: q('main'), marks: [
  { el: q('#new-pk'), label: '1', box: true }, { el: el('Lisää passkey'), label: '2' }, { el: el('Lataa avaimen varmuuskopio'), label: '3' },
  { el: el('Vaihda tunnuslause', null, 'button'), label: '4' }, { el: `[...document.querySelectorAll('h2')].find((h) => h.textContent === 'Tietoturvaloki')`, label: '5', box: true }] });

// Toinen laite (sama istunto): avausnäkymä ja uloskirjautuminen
const phone = await tab(port);
await view(phone, 390, 844, true);
await phone.cdp('Page.navigate', { url: app + '/admin' });
await phone.waitFor(phone.hasText('Avaa kysymykset'), 'avausnäkymä');
await shot(phone, '39-avaa-kysymykset', { marks: [{ el: el('Avaa passkeylla'), label: '1' }, { el: el('Avaa tunnuslauseella'), label: '2' }] });
await phone.click('Kirjaudu ulos');
await phone.waitFor(phone.hasText('Kirjaudu passkeylla'), 'kirjautuminen');
await shot(phone, '41-kirjaudu', { marks: [{ el: el('Kirjaudu passkeylla'), label: '1' }] });

const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
