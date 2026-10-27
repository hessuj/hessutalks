// Päästä päähän -testi: passkey-kirjautuminen ja avaimen avaus PRF:llä Chromen virtuaalisella autentikaattorilla.
// Ajo: scripts/e2e.sh passkey-prf.mjs  (tai node tests/e2e/passkey-prf.mjs <cdp-port> <app-url> [noprf])
const [port, app] = [process.argv[2], process.argv[3]];
const hasPrf = process.argv[4] !== 'noprf';

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map((a) => a.value || a.description).join(' '));
});
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expr, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(expr).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error('Aikakatkaisu: ' + what + '\nSivu: ' + (await js('document.body.innerText').catch(() => '?')) + '\n' + logs.join('\n'));
}
const text = () => js('document.body.innerText');
const has = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
const hasText = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;
const clickText = (t) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(t)}); if (!b) throw new Error('nappi puuttuu: ${t}'); b.click(); return true; })()`);
const fill = (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; return true; })()`);
const submit = (sel) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).closest('form').requestSubmit(); return true; })()`);
const step = (s) => console.log('✓ ' + s);

await cdp('Runtime.enable');
await cdp('Page.enable');
await cdp('WebAuthn.enable', { enableUI: false });
const { authenticatorId } = await cdp('WebAuthn.addVirtualAuthenticator', { options: {
  protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf,
} });

const PASS = 'e2e-oikein-pitka-tunnuslause';
await cdp('Page.navigate', { url: app + '/admin' });
await waitFor(has('#setup-token'), 'käyttöönottolomake');
await fill('#setup-token', 'E2E-TESTI-TOKEN');
await submit('#setup-token');
await waitFor(hasText('Luo salausavaimet'), 'avainten luonti');
step('Ensimmäinen passkey rekisteröity');
await fill('#pp1', PASS); await fill('#pp2', PASS);
await submit('#pp1');
await waitFor(has('#ev-title'), 'luentonäkymä avainten luonnin jälkeen', 60000);
step('Salausavaimet luotu');

// Uloskirjautuminen ja kirjautuminen passkeylla: ensimmäisellä kerralla tunnuslause, ja avaus otetaan käyttöön.
await clickText('Kirjaudu ulos');
await waitFor(hasText('Kirjaudu hallintaan'), 'kirjautumissivu');
await clickText('Kirjaudu passkeylla');
await waitFor(has('#pp'), 'avausnäkymä');
const unlockText = await text();
if (hasPrf && !unlockText.includes('tukee avausta')) throw new Error('PRF-vihjettä ei näy:\n' + unlockText);
if (!hasPrf && unlockText.includes('tukee avausta')) throw new Error('PRF-vihje näkyi ilman PRF:ää');
step('Kirjautuminen passkeylla, avausnäkymä ' + (hasPrf ? 'tarjoaa käyttöönoton' : 'pyytää tunnuslauseen (ei PRF:ää)'));
await fill('#pp', PASS);
await submit('#pp');
await waitFor(has('#ev-title'), 'luentonäkymä tunnuslauseen jälkeen', 60000);
const enabled = (await text()).includes('Avaus passkeylla otettu käyttöön');
if (enabled !== hasPrf) throw new Error('Käyttöönottoilmoitus: ' + enabled);
step(hasPrf ? 'Avaus passkeylla otettu käyttöön' : 'Ilman PRF:ää avaus jäi tunnuslauseelle');

// Toinen kirjautuminen: pelkkä passkey riittää.
await clickText('Kirjaudu ulos');
await waitFor(hasText('Kirjaudu hallintaan'), 'kirjautumissivu 2');
await clickText('Kirjaudu passkeylla');
if (hasPrf) {
  await waitFor(has('#ev-title'), 'luentonäkymä suoraan passkeylla');
  step('Toinen kirjautuminen: ei tunnuslausetta, kysymykset auki yhdellä passkeylla');

  // Sivun uudelleenlataus lukitsee avaimen. Avaus onnistuu napilla ilman tunnuslausetta.
  await cdp('Page.reload');
  await waitFor(hasText('Avaa passkeylla'), 'avausnäkymä uudelleenlatauksen jälkeen');
  await clickText('Avaa passkeylla');
  await waitFor(has('#ev-title'), 'luentonäkymä Avaa passkeylla -napilla');
  step('Uudelleenlatauksen jälkeen avaus yhdellä passkeylla');

  // Asetussivu näyttää tilan.
  await clickText('Asetukset');
  await waitFor(hasText('avaus passkeylla käytössä'), 'asetussivun PRF-tila');
  step('Asetussivu näyttää: avaus passkeylla käytössä');
} else {
  await waitFor(has('#pp'), 'avausnäkymä ilman PRF:ää');
  step('Ilman PRF:ää kirjautuminen toimii ja tunnuslause kysytään');
}
const creds = await cdp('WebAuthn.getCredentials', { authenticatorId });
console.log('Virtuaalisen autentikaattorin passkeyt:', creds.credentials.length);
if (logs.length) console.log('Selaimen virheet:\n' + logs.join('\n'));
process.exit(0);
