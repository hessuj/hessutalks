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

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const logs = [];
  const dialogs = [];   // vahvistusikkunoiden tekstit (testit tarkistavat, mitä kysyttiin)
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Page.javascriptDialogOpening') {
      // confirm() on sovelluksen omaa käyttöä (vahvistukset); alert() tarkoittaisi suoritettua skriptiä (XSS).
      if (m.params.type === 'alert') logs.push('ALERT ' + m.params.message);
      dialogs.push(m.params.message);
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
    dialogs: () => dialogs.slice(),
    hasText: (s) => `document.body.innerText.includes(${JSON.stringify(s)})`,
    has: (sel) => `!!document.querySelector(${JSON.stringify(sel)})`,
    // Nappi tekstin mukaan, valinnaisesti elementin sisältä, jossa on annettu teksti.
    click: (text, within) => js(`(() => {
      let scope = document;
      if (${JSON.stringify(within || '')}) {
        // Alue tunnistetaan otsikosta (sarjan nimi tai kysymysteksti), ei koko tekstistä: valikot (esim. Siirrä
        // sarjaan) sisältävät muiden sarjojen nimiä. Sarjan napit ovat sen otsikkorivillä ja työkalurivillä.
        const w = ${JSON.stringify(within || '')};
        const title = (e) => (e.matches('li.poll-item') ? e.querySelector('.run-prompt') : e.querySelector('.set-head h3')).textContent;
        const area = [...document.querySelectorAll('section.set-card, li.poll-item')].find((e) => title(e).includes(w));
        scope = area && area.matches('section.set-card') ? { querySelectorAll: (q) => [...area.querySelectorAll(':scope > .set-head ' + q + ', :scope > .set-tools ' + q)] } : area;
        if (!scope) throw new Error('alue puuttuu: ' + w);
      }
      const b = [...scope.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
      if (!b) throw new Error('nappi puuttuu: ' + ${JSON.stringify(text)});
      if (b.disabled) throw new Error('nappi pois käytöstä: ' + ${JSON.stringify(text)});
      b.click(); return true; })()`),
    fill: (sel, v) => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change')); return true; })()`),
    submit: (sel) => js(`(() => { document.querySelector(${JSON.stringify(sel)}).closest('form').requestSubmit(); return true; })()`),
  };
  return t;
}
export const step = (s) => console.log('✓ ' + s);

/**
 * Liittyy jo avattuun ikkunaan (esim. hallinnan avaama esitysikkuna) osoitteen perusteella. ending erottaa
 * esikatseluikkunan (#tunniste.p) projektorin ikkunasta (#tunniste), joiden osoitteet alkavat samoin.
 */
export async function attach(port, urlPart, ms = 10000, ending = null) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find((x) => x.type === 'page' && x.url.includes(urlPart) && (ending === null || x.url.endsWith(ending)));
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
  await admin.waitFor(admin.has('#tab-polls'), 'luennon näkymä');
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

/** Kysymysrivin valitsin (JavaScript-lauseke selaimeen) kysymystekstin mukaan. */
export const pollItem = (prompt) => `[...document.querySelectorAll('li.poll-item')].find((li) => li.querySelector('.run-prompt').textContent.includes(${JSON.stringify(prompt)}))`;

/** Avaa kysymyksen rivin alle tulokset ja muokkauksen (rivin klikkaus), ellei se ole jo auki. */
export async function expand(admin, prompt) {
  await admin.js(`(() => { const li = ${pollItem(prompt)}; if (!li) throw new Error('rivi puuttuu: ' + ${JSON.stringify(prompt)});
    if (!li.classList.contains('expanded')) li.querySelector('.poll-toggle').click(); return true; })()`);
  await admin.waitFor(`${pollItem(prompt)}?.querySelector('.poll-detail') != null`, 'avattu: ' + prompt);
}

/** Avaa sarjan työkalurivin (Muokkaa, järjestys, vienti, Monista, Poista sarja). */
export async function setTools(admin, setTitle) {
  await admin.js(`(() => { const s = [...document.querySelectorAll('section.set-card')].find((x) => x.querySelector('.set-head h3').textContent === ${JSON.stringify(setTitle)});
    if (!s) throw new Error('sarja puuttuu: ' + ${JSON.stringify(setTitle)});
    if (!s.querySelector('.set-tools')) s.querySelector('.set-tools-btn').click(); return true; })()`);
  await admin.waitFor(`[...document.querySelectorAll('section.set-card')].some((x) => x.querySelector('.set-head h3').textContent === ${JSON.stringify(setTitle)} && x.querySelector('.set-tools'))`, 'sarjan työkalut');
}

/**
 * Vain tämä kysymys taululle ja auki vastauksille: taulu tyhjennetään ensin (testit olettavat yhden
 * kysymyksen kerrallaan), sitten rivin Näytä taululla.
 */
export async function openPoll(admin, prompt) {
  if (await admin.js(`!!document.querySelector('li.poll-item.staged')`)) {
    await admin.click('Tyhjennä taulu');
    await admin.waitFor(`!document.querySelector('li.poll-item.staged')`, 'taulu tyhjä');
  }
  await admin.click('Näytä taululla', prompt);
  await admin.waitFor(`${pollItem(prompt)}?.matches('.staged[data-status="open"]')`, 'auki taululla: ' + prompt);
}
