// Selaintestien yhteiset apufunktiot: Chrome DevTools Protocol ilman ulkoisia kirjastoja.
// Jokainen välilehti omaan ikkunaansa, jotta molemmat ovat näkyvissä (document.hidden = false).
export async function tab(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => browser.addEventListener('open', r, { once: true }));
  const targetId = await new Promise((resolve) => {
    browser.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) resolve(m.result.targetId); });
    browser.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', newWindow: true } }));
  });
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return connect(list.find((x) => x.id === targetId).webSocketDebuggerUrl);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') {
      // confirm() on sovelluksen omaa käyttöä (vahvistukset); alert() tarkoittaisi suoritettua skriptiä (XSS).
      if (m.params.type === 'alert') logs.push('ALERT ' + m.params.message);
      cdp('Page.handleJavaScriptDialog', { accept: true });
    }
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
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const t = {
    cdp, js, logs,
    async waitFor(expr, what, ms = 20000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await js(expr).catch(() => false)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Aikakatkaisu: ' + what + ' (visibilityState=' + (await js('document.visibilityState').catch(() => '?')) + ')\n--- sivu ---\n' + (await js('document.body.innerText').catch(() => '?')).slice(0, 3000) + '\n' + logs.join('\n'));
    },
    hasText: (s) => `document.body.innerText.includes(${JSON.stringify(s)})`,
    has: (sel) => `!!document.querySelector(${JSON.stringify(sel)})`,
    // Nappi tekstin mukaan, valinnaisesti elementin sisältä, jossa on annettu teksti.
    click: (text, within) => js(`(() => {
      let scope = document;
      if (${JSON.stringify(within || '')}) {
        scope = [...document.querySelectorAll('section.set-card, article.poll-card, .live-control')].find((e) => e.innerText.includes(${JSON.stringify(within || '')}));
        if (!scope) throw new Error('alue puuttuu: ${within}');
      }
      const b = [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) throw new Error('nappi puuttuu: ${text}');
      if (b.disabled) throw new Error('nappi pois käytöstä: ${text}');
      b.click(); return true; })()`),
    fill: (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change')); return true; })()`),
    submit: (sel) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).closest('form').requestSubmit(); return true; })()`),
  };
  return t;
}
export const step = (s) => console.log('✓ ' + s);

/** Liittyy jo avattuun ikkunaan (esim. hallinnan avaama esitysikkuna) osoitteen perusteella. */
export async function attach(port, urlPart, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find((x) => x.type === 'page' && x.url.includes(urlPart));
    if (target) return connect(target.webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Ikkunaa ei löytynyt: ' + urlPart);
}

/** Ylläpitäjän käyttöönotto virtuaalisella passkeylla (PRF) ja salausavaimet. Palauttaa luentolistan näkymässä. */
export async function setupAdmin(admin, app) {
  await admin.cdp('WebAuthn.enable', { enableUI: false });
  await admin.cdp('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
  } });
  await admin.cdp('Page.navigate', { url: app + '/admin' });
  await admin.waitFor(admin.has('#setup-token'), 'käyttöönotto');
  await admin.fill('#setup-token', 'E2E-TESTI-TOKEN');
  await admin.submit('#setup-token');
  await admin.waitFor(admin.has('#pp1'), 'avainten luonti');
  await admin.fill('#pp1', 'e2e-oikein-pitka-tunnuslause'); await admin.fill('#pp2', 'e2e-oikein-pitka-tunnuslause');
  await admin.submit('#pp1');
  await admin.waitFor(admin.has('#ev-title'), 'luennot', 60000);
}

/** Luo luennon ja avaa sen näkymän. */
export async function createEvent(admin, title, lang) {
  await admin.fill('#ev-title', title);
  if (lang) await admin.fill('#ev-lang', lang);
  await admin.submit('#ev-title');
  await admin.waitFor(admin.hasText('Kysymyssarjat'), 'luennon näkymä');
}

/** Avaa osallistujan ikkunan luennon linkistä (selaimen kieli suomi). */
export async function openParticipant(port, admin) {
  const url = await admin.js(`document.querySelector('.share .url a').href`);
  const part = await tab(port);
  await part.cdp('Network.enable');
  await part.cdp('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': 'fi-FI,fi;q=0.9' } });
  await part.cdp('Page.navigate', { url });
  return part;
}
