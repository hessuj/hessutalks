/*
 * HessuTalks – ylläpitäjän näkymä.
 *
 * Turvallisuusperiaatteet:
 *  - Kirjautuminen passkeylla (WebAuthn). Ei salasanoja palvelimelle.
 *  - Yksityinen salausavain avataan VAIN tässä selaimessa: passkeyn PRF-arvolla (sama
 *    biometria kuin kirjautumisessa) tai varakeinona tunnuslauseella (Argon2id -> XSalsa20-Poly1305).
 *    PRF-arvo ei lähde selaimesta. Avain pidetään vain muistissa. Sivun uudelleenlataus lukitsee.
 *  - Purettu sisältö lisätään DOMiin vain textContentilla (ei innerHTML:ää) -> ei XSS:ää.
 */
(function () {
  'use strict';

  var root = document.getElementById('admin');
  if (!root) return;

  var BASE = root.dataset.base;
  var API = BASE + '/admin/api/';
  var csrf = root.dataset.csrf;
  var KDF_OPS = 3;
  var KDF_MEM = 64 * 1024 * 1024;
  var MIN_PASSPHRASE = 12;
  var POLL_MS = 2500;

  var sodium = null;
  var secretKey = null;   // Uint8Array, vain muistissa
  var publicKey = null;
  var state = null;
  var pollTimer = null;
  var pendingPrf = null;  // { id, output, wrap } kirjautumisen jälkeen, kunnes avain on avattu
  var prfDiag = null;     // miksi PRF-arvoa ei saatu (näytetään avausnäkymässä)
  var PRF_CONTEXT = 'HessuTalks PRF unlock v1';

  // ================================================================ DOM-apurit

  /** h('tag.class', {attr}, ...lapset) – lapset ovat merkkijonoja (textContent) tai solmuja. */
  function h(spec, attrs) {
    var parts = spec.split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  function mount() {
    stopPolling();
    root.replaceChildren();
    for (var i = 0; i < arguments.length; i++) append(root, arguments[i]);
    var first = root.querySelector('input, button');
    if (first) first.focus();
  }
  function notice(msg, kind) {
    return h('p.notice' + (kind ? '.' + kind : ''), { role: kind === 'error' ? 'alert' : 'status', text: msg });
  }
  function fmtTime(ts) {
    return new Date(ts * 1000).toLocaleString('fi-FI', { dateStyle: 'short', timeStyle: 'short' });
  }

  // ================================================================ verkko

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { secretKey = null; presenterEnd(); showLogin('Istunto on päättynyt. Kirjaudu uudelleen.'); throw new Error('401'); }
        if (!res.ok) throw new Error(data.error || ('Virhe ' + res.status));
        if (data && typeof data.csrf === 'string') csrf = data.csrf;
        return data;
      });
    });
  }

  // ================================================================ WebAuthn

  function b64urlToBuf(s) {
    return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING).buffer;
  }
  function bufToB64url(buf) {
    return sodium.to_base64(new Uint8Array(buf), sodium.base64_variants.URLSAFE_NO_PADDING);
  }
  function prepCreate(o) {
    var pk = o.publicKey;
    pk.challenge = b64urlToBuf(pk.challenge);
    pk.user.id = b64urlToBuf(pk.user.id);
    (pk.excludeCredentials || []).forEach(function (c) { c.id = b64urlToBuf(c.id); });
    // PRF päälle jo luonnissa: turva-avaimet (hmac-secret) vaativat sen. Muut selaimet ohittavat.
    pk.extensions = Object.assign({}, pk.extensions, { prf: {} });
    return o;
  }
  function prepGet(o) {
    var pk = o.publicKey;
    pk.challenge = b64urlToBuf(pk.challenge);
    (pk.allowCredentials || []).forEach(function (c) { c.id = b64urlToBuf(c.id); });
    // PRF-suola (eval-muoto: toimii myös salasanamanagereissa). Selaimet ilman PRF:ää ohittavat laajennuksen.
    if (o.prfSalt) pk.extensions = { prf: { eval: { first: b64urlToBuf(o.prfSalt) } } };
    return { publicKey: pk };
  }

  function registerPasskey(name) {
    return api('POST', 'passkey/register-options', {}).then(function (opts) {
      return navigator.credentials.create(prepCreate(opts));
    }).then(function (cred) {
      return api('POST', 'passkey/register', {
        name: name,
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        attestationObject: bufToB64url(cred.response.attestationObject)
      });
    });
  }

  /**
   * Lukee PRF-tuloksen. Hyväksyy standardin ArrayBufferin, typed arrayn ja (1Passwordin
   * laajennuksen palauttaman) tavallisen numerotaulukon. diag kertoo muodon, ei arvoa.
   */
  function prfResult(ext) {
    if (!ext || !ext.prf) return { output: null, diag: 'ei PRF-vastausta (selain tai passkey ei tue)' };
    var first = ext.prf.results && ext.prf.results.first;
    if (!first) return { output: null, diag: 'PRF-vastaus ilman tulosta' + (ext.prf.enabled === false ? ' (enabled: false)' : '') };
    var bytes = null;
    if (first instanceof ArrayBuffer) bytes = new Uint8Array(first.slice(0));
    else if (ArrayBuffer.isView(first)) bytes = new Uint8Array(first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength));
    else if (Array.isArray(first) && first.every(function (b) { return b === (b & 255); })) bytes = Uint8Array.from(first);
    if (!bytes || bytes.length !== 32) {
      return { output: null, diag: 'PRF-tulos väärää muotoa (' + Object.prototype.toString.call(first) + (bytes ? ', ' + bytes.length + ' tavua' : '') + ')' };
    }
    return { output: bytes, diag: null };
  }

  /** Kirjautuu ja ottaa talteen PRF-arvon (pendingPrf), jos passkey ja selain tukevat sitä. */
  function loginWithPasskey() {
    var output = null;
    return api('POST', 'login/options', {}).then(function (opts) {
      return navigator.credentials.get(prepGet(opts));
    }).then(function (cred) {
      var ext = typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {};
      var res = prfResult(ext);
      output = res.output;
      prfDiag = res.diag;
      return api('POST', 'login', {
        id: bufToB64url(cred.rawId),
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : null
      });
    }).then(function (r) {
      forgetPrf();
      if (output && r.passkey) pendingPrf = { id: r.passkey, output: output, wrap: r.prf || null };
      return r;
    });
  }

  function webauthnSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  }

  // ================================================================ salausavaimet

  function deriveKey(passphrase, salt, ops, mem) {
    return sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES, passphrase, salt, ops, mem, sodium.crypto_pwhash_ALG_ARGON2ID13
    );
  }
  function b64(u8) { return sodium.to_base64(u8, sodium.base64_variants.ORIGINAL); }
  function unb64(s) { return sodium.from_base64(s, sodium.base64_variants.ORIGINAL); }

  function wrapSecret(sk, pk, passphrase) {
    var salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    var nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    var key = deriveKey(passphrase, salt, KDF_OPS, KDF_MEM);
    var enc = sodium.crypto_secretbox_easy(sk, nonce, key);
    sodium.memzero(key);
    return {
      public_key: b64(pk), enc_secret_key: b64(enc), nonce: b64(nonce), salt: b64(salt),
      opslimit: KDF_OPS, memlimit: KDF_MEM
    };
  }

  function unlock(keys, passphrase) {
    var key = deriveKey(passphrase, unb64(keys.salt), keys.opslimit, keys.memlimit);
    try {
      var sk = sodium.crypto_secretbox_open_easy(unb64(keys.enc_secret_key), unb64(keys.nonce), key);
      var pk = unb64(keys.public_key);
      // Varmistus: yksityinen avain vastaa tallennettua julkista avainta.
      if (sodium.compare(sodium.crypto_scalarmult_base(sk), pk) !== 0) throw new Error('Avainpari ei täsmää.');
      secretKey = sk; publicKey = pk;
    } finally {
      sodium.memzero(key);
    }
  }

  // ---------------------------------------------------------------- avaus passkeylla (PRF)

  /** PRF-arvosta johdettu salausavain. Konteksti erottaa sen muista mahdollisista käytöistä. */
  function prfKey(output) {
    return sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, output, sodium.from_string(PRF_CONTEXT));
  }

  function forgetPrf() {
    if (pendingPrf) sodium.memzero(pendingPrf.output);
    pendingPrf = null;
  }

  /** Avaa yksityisen avaimen passkeyn kopiosta. Palauttaa true, jos onnistui. */
  function unlockWithPrf(keys) {
    if (!pendingPrf || !pendingPrf.wrap) return false;
    var key = prfKey(pendingPrf.output);
    try {
      var sk = sodium.crypto_secretbox_open_easy(unb64(pendingPrf.wrap.enc_secret_key), unb64(pendingPrf.wrap.nonce), key);
      var pk = unb64(keys.public_key);
      if (sodium.compare(sodium.crypto_scalarmult_base(sk), pk) !== 0) throw new Error('Avainpari ei täsmää.');
      secretKey = sk; publicKey = pk;
      forgetPrf();
      return true;
    } catch (e) {
      // Kopio on vanhentunut tai vioittunut: tunnuslauseella avattaessa tallennetaan uusi.
      pendingPrf.wrap = null;
      return false;
    } finally {
      sodium.memzero(key);
    }
  }

  /** Tallentaa avatusta avaimesta passkey-kohtaisen kopion, jos kirjautuminen tuotti PRF-arvon. */
  function enablePrfUnlock() {
    if (!pendingPrf || !secretKey) return Promise.resolve(false);
    var id = pendingPrf.id;
    var key = prfKey(pendingPrf.output);
    var nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    var enc = sodium.crypto_secretbox_easy(secretKey, nonce, key);
    sodium.memzero(key);
    forgetPrf();
    return api('POST', 'passkeys/' + id + '/prf', { public_key: b64(publicKey), enc_secret_key: b64(enc), nonce: b64(nonce) })
      .then(function () { return true; });
  }

  function downloadBackup(keys) {
    var blob = new Blob([JSON.stringify({
      app: 'HessuTalks', kind: 'encrypted-admin-key', created: new Date().toISOString(),
      public_key: keys.public_key, enc_secret_key: keys.enc_secret_key, nonce: keys.nonce,
      salt: keys.salt, opslimit: keys.opslimit, memlimit: keys.memlimit
    }, null, 2)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'hessutalks-avainvarmuuskopio.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /** Purkaa viestin. Palauttaa null, jos purku epäonnistuu. */
  function decrypt(ciphertext) {
    try {
      var plain = sodium.crypto_box_seal_open(unb64(ciphertext), publicKey, secretKey);
      var obj = JSON.parse(sodium.to_string(plain));
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) {
      return null;
    }
  }

  // ================================================================ näkymät: käyttöönotto ja kirjautuminen

  function showSetup(msg) {
    var tokenInput = h('input', { type: 'text', id: 'setup-token', autocomplete: 'off', spellcheck: 'false', required: true });
    var nameInput = h('input', { type: 'text', id: 'pk-name', maxlength: 60, value: 'MacBook Pro' });
    var out = h('div');
    var form = h('form', { onsubmit: function (ev) {
      ev.preventDefault();
      out.replaceChildren(notice('Tarkistetaan…'));
      api('POST', 'setup/token', { token: tokenInput.value.trim() })
        .then(function () { return registerPasskey(nameInput.value.trim()); })
        .then(function () { start(); })
        .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
    } },
      h('label', { for: 'setup-token', text: 'Käyttöönottotunnus' }), tokenInput,
      h('p.hint', { text: 'Tunnus tulostui, kun asetustiedosto luotiin komennolla bin/init.php.' }),
      h('label', { for: 'pk-name', text: 'Passkeyn nimi' }), nameInput,
      h('p', null, h('button.btn', { type: 'submit', text: 'Luo passkey' }))
    );
    mount(h('h1', { text: 'Ota hallinta käyttöön' }),
      h('p', { text: 'Rekisteröi ensimmäinen passkey. Sen jälkeen kirjaudut aina Touch ID:llä, Face ID:llä tai turva-avaimella.' }),
      msg ? notice(msg, 'error') : null, webauthnSupported() ? form : notice('Selain ei tue passkeyta.', 'error'), out);
  }

  function showLogin(msg) {
    var out = h('div', null, msg ? notice(msg, 'error') : null);
    var btn = h('button.btn', { type: 'button', text: 'Kirjaudu passkeylla', onclick: function () {
      btn.disabled = true;
      out.replaceChildren(notice('Odotetaan passkeyta…'));
      loginWithPasskey().then(function () { start(); }).catch(function (e) {
        btn.disabled = false;
        if (e.message !== '401') out.replaceChildren(notice(e.name === 'NotAllowedError' ? 'Kirjautuminen peruttiin.' : e.message, 'error'));
      });
    } });
    mount(h('p.ready', { text: 'READY.' }), h('h1', { text: 'Kirjaudu hallintaan' }),
      webauthnSupported() ? btn : notice('Selain ei tue passkeyta.', 'error'), out);
  }

  // ================================================================ näkymät: avaimet

  function passphraseFields(label) {
    var a = h('input', { type: 'password', id: 'pp1', autocomplete: 'new-password', minlength: MIN_PASSPHRASE, required: true });
    var b = h('input', { type: 'password', id: 'pp2', autocomplete: 'new-password', required: true });
    return {
      nodes: [h('label', { for: 'pp1', text: label }), a, h('label', { for: 'pp2', text: 'Toista tunnuslause' }), b],
      value: function () {
        if (a.value.length < MIN_PASSPHRASE) throw new Error('Tunnuslauseessa pitää olla vähintään ' + MIN_PASSPHRASE + ' merkkiä.');
        if (a.value !== b.value) throw new Error('Tunnuslauseet eivät täsmää.');
        return a.value;
      }
    };
  }

  function showKeySetup() {
    var pp = passphraseFields('Uusi tunnuslause');
    var out = h('div');
    mount(h('h1', { text: 'Luo salausavaimet' }),
      h('div.keybox', null,
        h('p', { text: 'Kysymykset salataan julkisella avaimella. Ne voi avata vain yksityisellä avaimella, joka suojataan tunnuslauseella tässä selaimessa. Palvelin ei koskaan näe tunnuslausetta.' }),
        h('p', null, h('strong', { text: 'Jos tunnuslause unohtuu, kysymyksiä ei voi palauttaa kukaan.' }),
          ' Tallenna se salasanojen hallintaan ja lataa avaimen varmuuskopio.')),
      h('form', { onsubmit: function (ev) {
        ev.preventDefault();
        var pass;
        try { pass = pp.value(); } catch (e) { out.replaceChildren(notice(e.message, 'error')); return; }
        out.replaceChildren(notice('Luodaan avaimia…'));
        setTimeout(function () {
          var kp = sodium.crypto_box_keypair();
          var wrapped = wrapSecret(kp.privateKey, kp.publicKey, pass);
          api('POST', 'keys', wrapped).then(function () {
            secretKey = kp.privateKey; publicKey = kp.publicKey;
            downloadBackup(wrapped);
            return loadState();
          }).then(showEvents).catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
        }, 30);
      } }, pp.nodes, h('p', null, h('button.btn', { type: 'submit', text: 'Luo avaimet' }))),
      out);
  }

  /**
   * Tunnuslause on varakeino. Jos kirjautuminen tuotti PRF-arvon, avatusta avaimesta tallennetaan
   * passkey-kohtainen kopio, ja seuraavalla kerralla pelkkä passkey riittää.
   */
  function showUnlock(msg) {
    var input = h('input', { type: 'password', id: 'pp', autocomplete: 'current-password', required: true });
    var out = h('div', null, msg ? notice(msg, 'error') : null);
    var prfBtn = webauthnSupported() ? h('button.btn', { type: 'button', text: 'Avaa passkeylla', onclick: function () {
      prfBtn.disabled = true;
      out.replaceChildren(notice('Odotetaan passkeyta…'));
      loginWithPasskey().then(function () { start(); }).catch(function (e) {
        prfBtn.disabled = false;
        if (e.message !== '401') out.replaceChildren(notice(e.name === 'NotAllowedError' ? 'Peruttiin.' : e.message, 'error'));
      });
    } }) : null;
    mount(h('h1', { text: 'Avaa kysymykset' }),
      h('p', null, 'Avaimen sormenjälki ', h('span.fingerprint', { text: state.keys.fingerprint })),
      pendingPrf ? null : h('p', null, prfBtn),
      h('form', { onsubmit: function (ev) {
        ev.preventDefault();
        out.replaceChildren(notice('Avataan…'));
        setTimeout(function () {
          try {
            unlock(state.keys, input.value);
          } catch (e) {
            out.replaceChildren(notice('Väärä tunnuslause.', 'error'));
            input.select();
            return;
          }
          input.value = '';
          enablePrfUnlock().then(function (enabled) {
            return loadState().then(function () {
              showEvents(enabled ? 'Avaus passkeylla otettu käyttöön. Seuraavalla kerralla tunnuslausetta ei kysytä.' : null);
            });
          }).catch(function (e) { if (e.message !== '401') showEvents('Avausta passkeylla ei voitu ottaa käyttöön: ' + e.message); });
        }, 30);
      } },
        h('p.hint', { text: pendingPrf
          ? 'Tämä passkey tukee avausta, mutta sitä ei ole vielä otettu käyttöön. Avaa kerran tunnuslauseella, niin jatkossa passkey riittää.'
          : 'Varakeino: passkey ei antanut avausarvoa (PRF). Syy on yleensä salasanamanageri, joka ei tue PRF:ää. Apple Salasanoihin (iCloud) tai Google-salasanoihin tallennettu passkey tukee sitä.'
            + (prfDiag ? ' Tekninen syy: ' + prfDiag + '.' : '') }),
        h('label', { for: 'pp', text: 'Tunnuslause' }), input,
        h('p', null, h('button.btn' + (pendingPrf ? '' : '.ghost'), { type: 'submit', text: 'Avaa tunnuslauseella' }), ' ', logoutButton())),
      out);
  }

  // ================================================================ näkymät: luennot

  function toolbar(title, extra) {
    return h('div.toolbar', null,
      h('h1', { text: title }), h('span.spacer'), extra || null,
      h('button.btn.ghost.small', { type: 'button', text: 'Asetukset', onclick: showSettings }),
      logoutButton());
  }

  function logoutButton() {
    return h('button.btn.ghost.small', { type: 'button', text: 'Kirjaudu ulos', onclick: function () {
      api('POST', 'logout', {}).catch(function () {}).then(function () { secretKey = null; window.location.reload(); });
    } });
  }

  function loadState() {
    return api('GET', 'state').then(function (s) { state = s; return s; });
  }

  function showEvents(msg) {
    var title = h('input', { type: 'text', id: 'ev-title', maxlength: 120, required: true, placeholder: 'esim. Cybersecurity Fundamentals, luento 3' });
    var hours = h('select', { id: 'ev-hours' },
      h('option', { value: '', text: 'Kunnes suljen' }),
      h('option', { value: '3', text: '3 tuntia' }),
      h('option', { value: '24', text: '1 vuorokausi' }),
      h('option', { value: '168', text: '1 viikko' }));
    var out = h('div', null, msg ? notice(msg, 'ok') : null);
    var list = h('ul.event-list');

    function render() {
      list.replaceChildren();
      if (!state.events.length) {
        list.replaceWith(h('p.empty', { text: 'Ei vielä luentoja. Luo ensimmäinen yllä, niin saat koodin ja QR-koodin jaettavaksi.' }));
        return;
      }
      state.events.forEach(function (ev) {
        list.appendChild(h('li', null,
          h('span.code', { text: ev.code }),
          h('strong', null, ev.title,
            ev.new_count ? h('span.badge.new', { text: ev.new_count + ' uutta' }) : null,
            !ev.open ? h('span.badge.closed', { text: 'suljettu' }) : null),
          h('button.btn.small.open-btn', { type: 'button', text: 'Avaa', onclick: function () { showEvent(ev.id); } }),
          h('span.meta', { text: fmtTime(ev.created_at) + ', ' + ev.question_count + ' viestiä' })));
      });
    }

    mount(toolbar('Luennot'),
      h('form.row-form', { onsubmit: function (ev) {
        ev.preventDefault();
        api('POST', 'events', { title: title.value, hours: hours.value ? parseInt(hours.value, 10) : null })
          .then(function (r) { return loadState().then(function () { showEvent(r.event.id); }); })
          .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
      } },
        h('div', null, h('label', { for: 'ev-title', text: 'Uuden luennon nimi' }), title),
        h('div', null, h('label', { for: 'ev-hours', text: 'Kysymykset auki' }), hours),
        h('button.btn', { type: 'submit', text: 'Luo luento' })),
      out, list);
    render();
  }

  // ================================================================ näkymä: yksi luento

  var STATUS_LABEL = { 'new': 'Uusi', answered: 'Vastattu', archived: 'Arkistoitu' };

  function qrDataUrl(text, cell) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createDataURL(cell, 4);
  }

  // ================================================================ esitysnäyttö (projektori)
  //
  // Esitysikkunat (/admin/esitys) avataan jatketulle näytölle, jolloin hallintanäkymä jää
  // läppärin näytölle. Ikkunoita voi olla auki useita yhtä aikaa, yksi kutakin näkymää kohden:
  // "esitys" (QR-koodi, yksittäinen viesti), "kysymykset", "palautteet" ja "kysely-<id>".
  // Ikkunoissa ei ole salausavainta: tämä ikkuna lähettää niille vain näytettävän sisällön
  // postMessagella saman originin sisällä.
  //
  // Näkyvä esitysikkuna lähettää tahdistusviestin (tick) parin sekunnin välein. Sen avulla tulokset
  // päivittyvät, vaikka tämä välilehti olisi taustalla (selain hidastaa taustan ajastimia).

  var ORIGIN = window.location.origin;
  var screens = {};           // avain -> { win, msg, live, fitTo }
  var presenterNote = h('span.hint');
  var liveRefresh = null;     // nykyisen luentonäkymän päivitysfunktio (tick kutsuu)
  var lastTick = 0;

  function screenOpen(sc) { return !!sc && !!sc.win && !sc.win.closed; }

  function screenPost(sc, msg) {
    if (screenOpen(sc)) sc.win.postMessage(msg, ORIGIN);
  }

  /** Valitsee näytön, joka ei ole tämän ikkunan näyttö (Window Management API, Chrome/Edge). */
  function extendedScreen() {
    if (typeof window.getScreenDetails !== 'function') return Promise.resolve(null);
    return window.getScreenDetails().then(function (d) {
      var cur = d.currentScreen;
      var others = d.screens.filter(function (s) {
        return s.availLeft !== cur.availLeft || s.availTop !== cur.availTop;
      });
      return others.filter(function (s) { return !s.isPrimary; })[0] || others[0] || null;
    }).catch(function () { return null; });
  }

  // Ikkuna avataan ensin kohtuullisen kokoisena kohdenäytön keskelle. Se suurennetaan vasta, kun on
  // varmistettu, että selain todella sijoitti sen sinne: muuten ylisuuri ikkuna jäisi väärälle näytölle.
  var PRESENTER_W = 960;
  var PRESENTER_H = 600;

  function openScreen(key, sc) {
    return extendedScreen().then(function (scr) {
      var features = 'popup,width=' + PRESENTER_W + ',height=' + PRESENTER_H;
      if (scr) {
        features += ',left=' + Math.round(scr.availLeft + (scr.availWidth - PRESENTER_W) / 2) +
          ',top=' + Math.round(scr.availTop + (scr.availHeight - PRESENTER_H) / 2);
      }
      // Ei noopeneria: esitysikkuna tarvitsee avaajan viestien lähettäjän tunnistamiseen.
      sc.win = window.open(BASE + '/admin/esitys', 'hessutalks-' + key, features);
      sc.fitTo = sc.win ? scr : null;
      if (!sc.win) {
        presenterNote.textContent = 'Selain esti ikkunan. Salli ponnahdusikkunat tai paina nappia uudelleen.';
      } else if (!scr) {
        presenterNote.textContent = 'Siirrä esitysikkuna projektorin näytölle ja kaksoisklikkaa sitä (koko näyttö). Automaattinen sijoitus toimii Chromessa ja Edgessä.';
      }
    });
  }

  function isOnScreen(win, scr) {
    var x = win.screenX + win.outerWidth / 2;
    var y = win.screenY + win.outerHeight / 2;
    return x >= scr.availLeft && x < scr.availLeft + scr.availWidth &&
      y >= scr.availTop && y < scr.availTop + scr.availHeight;
  }

  /** Suurentaa esitysikkunan kohdenäytön kokoiseksi, jos ikkuna on kohdenäytöllä. */
  function fitScreen(sc) {
    var scr = sc.fitTo;
    sc.fitTo = null;
    if (!scr || !screenOpen(sc)) return;
    if (!isOnScreen(sc.win, scr)) {
      presenterNote.textContent = 'Selain ei sijoittanut ikkunaa toiselle näytölle. Raahaa se projektorille ja kaksoisklikkaa sitä (koko näyttö).';
      return;
    }
    sc.win.moveTo(scr.availLeft, scr.availTop);
    sc.win.resizeTo(scr.availWidth, scr.availHeight);
    presenterNote.textContent = 'Esitysnäyttö avattu toiselle näytölle. Kaksoisklikkaa sitä tai paina F: koko näyttö.';
  }

  /**
   * Näyttää sisällön projektorin ikkunassa key. live = funktio, joka tuottaa päivittyvän sisällön;
   * updateScreens() lähettää sen ikkunaan aina, kun se muuttuu.
   */
  function present(key, msg, live) {
    var sc = screens[key] || (screens[key] = { win: null, msg: null, live: null, fitTo: null });
    sc.msg = msg;
    sc.live = live || null;
    if (screenOpen(sc)) {
      screenPost(sc, msg);
      try { sc.win.focus(); } catch (e) { /* selain voi estää */ }
      return;
    }
    openScreen(key, sc);
  }

  /** Lähettää päivittyvien näkymien uuden sisällön ikkunoihin, jos se on muuttunut. */
  function updateScreens() {
    Object.keys(screens).forEach(function (key) {
      var sc = screens[key];
      if (!sc.live || !screenOpen(sc)) return;
      var next = sc.live();
      if (next && JSON.stringify(next) !== JSON.stringify(sc.msg)) { sc.msg = next; screenPost(sc, next); }
    });
  }

  function anyScreenOpen() {
    return Object.keys(screens).some(function (k) { return screenOpen(screens[k]); });
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== ORIGIN || !ev.data) return;
    var sc = null;
    Object.keys(screens).forEach(function (k) { if (screenOpen(screens[k]) && screens[k].win === ev.source) sc = screens[k]; });
    if (!sc) return;
    if (ev.data.type === 'ready') {
      fitScreen(sc);
      if (sc.msg) screenPost(sc, sc.msg);
    } else if (ev.data.type === 'tick' && liveRefresh && Date.now() - lastTick > 1500) {
      lastTick = Date.now();
      liveRefresh();
    }
  });

  /** Tyhjentää kaikki projektorin ikkunat. */
  function blankScreens() {
    Object.keys(screens).forEach(function (k) {
      var sc = screens[k];
      sc.msg = { type: 'blank' }; sc.live = null;
      screenPost(sc, sc.msg);
    });
  }

  function presenterEnd() {
    Object.keys(screens).forEach(function (k) {
      var sc = screens[k];
      sc.msg = null; sc.live = null;
      screenPost(sc, { type: 'end' });
    });
  }

  // ================================================================ kyselyt (luennon näkymässä)

  var TYPE_LABEL = { single: 'Monivalinta, yksi vastaus', multi: 'Monivalinta, useita vastauksia', words: 'Sanapilvi', likert: 'Likert-asteikko', scale: 'Asteikko 0–10' };
  var POLL_STATUS_LABEL = { draft: 'Luonnos', open: 'Auki', closed: 'Suljettu' };
  var LABEL_DEFAULTS = {
    likert: ['Täysin eri mieltä', 'Täysin samaa mieltä'],
    scale: ['Ei lainkaan', 'Erittäin paljon']
  };

  /** Lataa QR-koodin PNG-kuvana (esim. luentokalvoon). */
  function downloadQr(text, filename) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var cell = 16;
    var margin = 4;
    var size = (n + 2 * margin) * cell;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
      }
    }
    canvas.toBlob(function (blob) {
      var a = h('a', { href: URL.createObjectURL(blob), download: filename });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, 'image/png');
  }

  /**
   * Luennon kyselyt: luonti, muokkaus, avaus/sulkeminen ja reaaliaikaiset tulokset.
   * Vastaukset puretaan tässä selaimessa; palvelin ei näe niitä.
   */
  function pollsPanel(eventId, getEvent) {
    var polls = [];
    var answers = {};       // kyselyn id -> { vastaaja: vastaus }
    var invalid = {};       // kyselyn id -> hylättyjen vastausten määrä
    var generations = {};   // kyselyn id -> sukupolvi (kasvaa, kun vastaukset tyhjennetään)
    var hidden = {};        // kyselyn id -> { sana: true } (sanapilven moderointi, vain muistissa)
    var lastAnswerId = 0;
    var views = {};         // kyselyn id -> tuloselementti (säilyy, jotta kaaviot animoituvat)
    var listEl = h('div.poll-list');
    var formEl = h('div');
    var outEl = h('div');
    var el = h('section.polls-admin', null,
      h('div.toolbar', null, h('h2', { text: 'Kyselyt' }), h('span.spacer'),
        h('button.btn.small', { type: 'button', text: 'Uusi kysely', onclick: function () { showForm(null); } })),
      outEl, formEl, listEl);

    function findPoll(pid) {
      for (var i = 0; i < polls.length; i++) if (polls[i].id === pid) return polls[i];
      return null;
    }
    function fail(e) { if (e.message !== '401') outEl.replaceChildren(notice(e.message, 'error')); }

    function load() {
      return api('GET', 'events/' + eventId + '/polls').then(function (r) { polls = r.polls; renderAll(); });
    }

    function tallyFor(poll) {
      var map = answers[poll.id] || {};
      return HessuResults.tally(poll, Object.keys(map).map(function (k) { return map[k]; }), hidden[poll.id]);
    }

    function pollMessage(pid) {
      var poll = findPoll(pid);
      if (!poll) return { type: 'blank' };
      return {
        type: 'poll', code: getEvent().code, url: poll.url, status: poll.status,
        poll: { id: poll.id, type: poll.type, prompt: poll.prompt, config: poll.config },
        data: tallyFor(poll)
      };
    }

    /** Hakee uudet salatut vastaukset, purkaa ja tarkistaa ne. */
    function refreshAnswers() {
      return api('GET', 'events/' + eventId + '/poll-answers?after=' + lastAnswerId).then(function (r) {
        var changed = false;
        var gens = r.generations || {};
        Object.keys(gens).forEach(function (pid) {
          if (generations[pid] !== undefined && generations[pid] !== gens[pid]) { answers[pid] = {}; invalid[pid] = 0; changed = true; }
          generations[pid] = gens[pid];
        });
        // Vastaus kyselyyn, jota tämä näkymä ei vielä tunne: ladataan kyselyt ensin ja haetaan uudelleen.
        if (r.answers.some(function (a) { return !findPoll(a.poll_id); })) return load();
        var code = getEvent().code;
        r.answers.forEach(function (a) {
          if (a.id > lastAnswerId) lastAnswerId = a.id;
          var poll = findPoll(a.poll_id);
          var m = decrypt(a.ciphertext);
          // Vastaus hyväksytään vain, jos se on salattu juuri tälle luennolle ja kyselylle.
          var value = m && m.e === code && m.p === a.poll_id ? HessuResults.validAnswer(poll, m.a) : null;
          var map = answers[a.poll_id] || (answers[a.poll_id] = {});
          if (value === null) { invalid[a.poll_id] = (invalid[a.poll_id] || 0) + 1; delete map[a.voter]; }
          else map[a.voter] = value;
          changed = true;
        });
        if (changed) updateResults();
      });
    }

    function updateResults() {
      polls.forEach(function (poll) {
        var view = views[poll.id];
        if (!view || !view.el.isConnected) return;
        var data = tallyFor(poll);
        view.count.textContent = data.voters + ' vastausta' +
          (invalid[poll.id] ? ', ' + invalid[poll.id] + ' hylätty (virheellinen tai toiselle kyselylle salattu)' : '');
        HessuResults.render(view.el, poll, data, poll.type === 'words' ? { onWord: function (word) { hideWord(poll, word); } } : null);
        renderHidden(poll);
      });
      updateScreens();
    }

    function hideWord(poll, word) {
      if (!window.confirm('Piilotetaanko "' + word + '" tuloksista ja projektorilta?')) return;
      (hidden[poll.id] || (hidden[poll.id] = {}))[word] = true;
      updateResults();
    }
    function renderHidden(poll) {
      var view = views[poll.id];
      var words = Object.keys(hidden[poll.id] || {});
      view.hidden.replaceChildren();
      if (!words.length) return;
      view.hidden.appendChild(h('span.hint', { text: 'Piilotetut: ' }));
      words.forEach(function (word) {
        view.hidden.appendChild(h('button.btn.ghost.small', { type: 'button', text: word + ' ↺', title: 'Palauta näkyviin', onclick: function () {
          delete hidden[poll.id][word]; updateResults();
        } }));
      });
    }

    function act(poll, action, body, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      api('POST', 'polls/' + poll.id + '/' + action, body || {}).then(function (r) {
        if (action === 'delete') {
          polls = polls.filter(function (p) { return p.id !== poll.id; });
          var sc = screens['kysely-' + poll.id];
          if (sc) { sc.live = null; sc.msg = { type: 'blank' }; screenPost(sc, sc.msg); }
        } else {
          polls = polls.map(function (p) { return p.id === poll.id ? r.poll : p; });
        }
        if (action === 'reset') { answers[poll.id] = {}; invalid[poll.id] = 0; }
        renderAll();
      }).catch(fail);
    }

    function renderAll() {
      outEl.replaceChildren();
      listEl.replaceChildren();
      if (!polls.length) {
        listEl.appendChild(h('p.empty', { text: 'Ei kyselyitä. Luo kysely valmiiksi ennen luentoa ja lataa sen QR-koodi kalvoon.' }));
      }
      polls.forEach(function (poll) {
        var view = views[poll.id] || (views[poll.id] = { el: h('div'), count: h('span.hint'), hidden: h('div.poll-hidden') });
        var next = { draft: ['Avaa kysely', 'open'], open: ['Sulje kysely', 'closed'], closed: ['Avaa uudelleen', 'open'] }[poll.status];
        listEl.appendChild(h('article.poll-card', { 'data-status': poll.status },
          h('div.poll-card-head', null,
            h('span.badge.' + poll.status, { text: POLL_STATUS_LABEL[poll.status] || poll.status }),
            h('span.hint', { text: TYPE_LABEL[poll.type] || poll.type })),
          h('p.poll-card-prompt', { text: poll.prompt }),
          h('div.q-actions', null,
            h('button.btn.small', { type: 'button', text: next[0], onclick: function () { act(poll, 'status', { status: next[1] }); } }),
            h('button.btn.small', { type: 'button', text: 'Tulokset projektorille', onclick: function () {
              present('kysely-' + poll.id, pollMessage(poll.id), function () { return pollMessage(poll.id); });
            } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Lataa QR-koodi', title: poll.url, onclick: function () {
              downloadQr(poll.url, 'hessutalks-' + getEvent().code + '-kysely-' + poll.id + '.png');
            } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Muokkaa', onclick: function () { showForm(poll); } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Tyhjennä vastaukset', onclick: function () {
              act(poll, 'reset', {}, 'Tyhjennetäänkö kyselyn "' + poll.prompt + '" kaikki vastaukset pysyvästi?');
            } }),
            h('button.btn.danger.small', { type: 'button', text: 'Poista', onclick: function () {
              act(poll, 'delete', {}, 'Poistetaanko kysely "' + poll.prompt + '" ja sen vastaukset pysyvästi?');
            } })),
          h('p.url', null, h('a', { href: poll.url, target: '_blank', rel: 'noopener', text: poll.url })),
          view.count, view.el, view.hidden));
      });
      updateResults();
    }

    // ---------------------------------------------------------------- lomake

    function showForm(poll) {
      var editing = !!poll;
      var cfg = editing ? poll.config : {};
      var type = h('select', { id: 'poll-type', disabled: editing },
        Object.keys(TYPE_LABEL).map(function (k) { return h('option', { value: k, text: TYPE_LABEL[k], selected: editing && poll.type === k }); }));
      var prompt = h('input', { type: 'text', id: 'poll-prompt', maxlength: 300, required: true, value: editing ? poll.prompt : '',
        placeholder: 'esim. Mikä on tärkein tietoturvaperiaate?' });
      var fields = h('div');
      var inputs = {};

      function renderFields() {
        var t = type.value;
        fields.replaceChildren();
        inputs = {};
        if (t === 'single' || t === 'multi') {
          inputs.options = h('textarea', { id: 'poll-options', rows: 5, placeholder: 'Yksi vaihtoehto per rivi (2–10)' });
          inputs.options.value = (cfg.options || []).join('\n');
          fields.append(h('label', { for: 'poll-options', text: 'Vaihtoehdot' }), inputs.options);
        } else if (t === 'likert' || t === 'scale') {
          if (t === 'likert') {
            inputs.points = h('select', { id: 'poll-points' },
              h('option', { value: '5', text: '5 kohtaa', selected: cfg.points !== 7 }),
              h('option', { value: '7', text: '7 kohtaa', selected: cfg.points === 7 }));
            fields.append(h('label', { for: 'poll-points', text: 'Asteikko' }), inputs.points);
          }
          var defs = LABEL_DEFAULTS[t];
          inputs.min = h('input', { type: 'text', id: 'poll-min', maxlength: 40, value: editing ? (cfg.min_label || '') : defs[0] });
          inputs.max = h('input', { type: 'text', id: 'poll-max', maxlength: 40, value: editing ? (cfg.max_label || '') : defs[1] });
          fields.append(
            h('label', { for: 'poll-min', text: t === 'scale' ? 'Selite arvolle 0' : 'Selite arvolle 1' }), inputs.min,
            h('label', { for: 'poll-max', text: t === 'scale' ? 'Selite arvolle 10' : 'Selite suurimmalle arvolle' }), inputs.max);
        } else {
          fields.append(h('p.hint', { text: 'Kuulijat vastaavat 1–3 sanalla. Samat vastaukset kasvattavat sanaa pilvessä. Voit piilottaa sopimattoman sanan klikkaamalla sitä tuloksissa.' }));
        }
      }

      function config() {
        var t = type.value;
        if (t === 'single' || t === 'multi') return { options: inputs.options.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean) };
        if (t === 'likert') return { points: parseInt(inputs.points.value, 10), min_label: inputs.min.value, max_label: inputs.max.value };
        if (t === 'scale') return { min_label: inputs.min.value, max_label: inputs.max.value };
        return {};
      }

      type.addEventListener('change', renderFields);
      renderFields();
      var out = h('div');
      formEl.replaceChildren(h('form.poll-form', { onsubmit: function (ev) {
        ev.preventDefault();
        var req = editing
          ? api('POST', 'polls/' + poll.id + '/update', { prompt: prompt.value, config: config() })
          : api('POST', 'events/' + eventId + '/polls', { type: type.value, prompt: prompt.value, config: config() });
        req.then(function () { formEl.replaceChildren(); return load(); })
          .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
      } },
        h('h3', { text: editing ? 'Muokkaa kyselyä' : 'Uusi kysely' }),
        h('label', { for: 'poll-type', text: 'Kysymystyyppi' }), type,
        h('label', { for: 'poll-prompt', text: 'Kysymys' }), prompt,
        fields,
        h('p', null, h('button.btn.small', { type: 'submit', text: editing ? 'Tallenna' : 'Luo kysely' }), ' ',
          h('button.btn.ghost.small', { type: 'button', text: 'Peruuta', onclick: function () { formEl.replaceChildren(); } })),
        out));
      prompt.focus();
    }

    return { el: el, load: load, refresh: refreshAnswers };
  }

  function showEvent(id) {
    var event = null;
    var items = [];          // {id, status, created_at, nickname_id, msg}
    var lastId = 0;
    var filter = 'open';     // open = uudet + vastatut, new, answered, archived, all
    var listEl = h('ul.questions');
    var headEl = h('div');
    var countEl = h('span.hint');
    var panel = pollsPanel(id, function () { return event; });

    function renderHead() {
      var url = event.url;
      headEl.replaceChildren(
        toolbar(event.title, h('button.btn.ghost.small', { type: 'button', text: 'Kaikki luennot', onclick: function () { loadState().then(function () { showEvents(); }); } })),
        h('div.share', null,
          h('img', { src: qrDataUrl(url, 4), alt: 'QR-koodi luennon kysymyssivulle' }),
          h('div', null,
            h('p.big-code', { text: event.code }),
            h('p.url', null, h('a', { href: url, target: '_blank', rel: 'noopener', text: url })),
            h('p', null,
              h('button.btn.small', { type: 'button', text: 'QR-koodi projektorille', onclick: function () {
                present('esitys', { type: 'qr', code: event.code, url: url });
              } }), ' ',
              h('button.btn.small', { type: 'button', text: 'Kysymykset projektorille', onclick: function () {
                present('kysymykset', listMessage('question'), function () { return listMessage('question'); });
              } }), ' ',
              h('button.btn.small', { type: 'button', text: 'Palautteet projektorille', onclick: function () {
                present('palautteet', listMessage('feedback'), function () { return listMessage('feedback'); });
              } }), ' ',
              h('button.btn.ghost.small', { type: 'button', text: 'Tyhjennä projektori', onclick: blankScreens }), ' ',
              h('button.btn.ghost.small', { type: 'button', text: event.open ? 'Sulje kysymykset' : 'Avaa kysymykset', onclick: function () {
                api('POST', 'events/' + id + '/status', { status: event.open ? 'closed' : 'open' }).then(function (r) { event = r.event; renderHead(); });
              } }), ' ',
              h('button.btn.danger.small', { type: 'button', text: 'Poista luento', onclick: function () {
                if (!window.confirm('Poistetaanko luento "' + event.title + '" ja kaikki sen viestit pysyvästi?')) return;
                api('POST', 'events/' + id + '/delete', {}).then(function () { return loadState(); }).then(function () { showEvents('Luento poistettu.'); });
              } })),
            h('p.hint', { text: event.open ? 'Kysymykset ovat auki.' : 'Kysymykset on suljettu. Osallistujat eivät voi lähettää uusia viestejä.' }),
            h('p', null, presenterNote)))
      );
    }

    // Projektorin lista (kysymykset tai palautteet omissa ikkunoissaan): käsiteltävät viestit, uusin ensin.
    // Lista päivittyy projektorille automaattisesti uusien viestien tullessa.
    var LIST_MAX = 10;
    function listMessage(kind) {
      var bad = nickConflicts();
      var shown = items.filter(function (it) {
        var m = it.msg;
        return m && (m.k === 'feedback') === (kind === 'feedback') && m.e === event.code && typeof m.t === 'string' &&
          typeof m.n === 'string' && !bad[it.nickname_id] && (it.status === 'new' || it.status === 'answered');
      }).slice(-LIST_MAX).reverse();
      return {
        type: 'list', title: event.title + ' · ' + (kind === 'feedback' ? 'Palautteet' : 'Kysymykset'),
        items: shown.map(function (it) { return { nick: it.msg.n, text: it.msg.t }; })
      };
    }

    function filterButton(key, label) {
      return h('button.btn.ghost.small', { type: 'button', 'aria-pressed': String(filter === key), text: label, onclick: function () {
        filter = key; filtersEl.replaceChildren.apply(filtersEl, filterButtons()); renderList();
      } });
    }
    function filterButtons() {
      return [filterButton('open', 'Käsiteltävät'), filterButton('new', 'Uudet'), filterButton('answered', 'Vastatut'),
        filterButton('archived', 'Arkisto'), filterButton('all', 'Kaikki'), countEl];
    }
    var filtersEl = h('div.filters');

    function setStatus(item, status) {
      api('POST', 'questions/' + item.id + '/status', { status: status }).then(function () { item.status = status; renderList(); });
    }

    // Tunnistaa, jos sama nimimerkkivaraus on käyttänyt eri nimimerkkiä salatun viestin sisällä
    // (vain muokatulla asiakasohjelmalla mahdollista).
    function nickConflicts() {
      var seen = {}, bad = {};
      items.forEach(function (it) {
        if (!it.msg) return;
        var k = it.nickname_id;
        if (seen[k] === undefined) seen[k] = it.msg.n;
        else if (seen[k] !== it.msg.n) bad[k] = true;
      });
      return bad;
    }

    function renderList() {
      var bad = nickConflicts();
      var visible = items.filter(function (it) {
        if (filter === 'all') return true;
        if (filter === 'open') return it.status === 'new' || it.status === 'answered';
        return it.status === filter;
      }).slice().reverse();
      countEl.textContent = visible.length + ' / ' + items.length + ' viestiä';
      updateScreens();
      listEl.replaceChildren();
      if (!visible.length) {
        listEl.appendChild(h('li.empty', { text: items.length ? 'Ei viestejä tällä suodattimella.' : 'Ei vielä viestejä. Uudet viestit tulevat näkyviin automaattisesti.' }));
        return;
      }
      visible.forEach(function (it) {
        var m = it.msg;
        var warn = !m || m.e !== event.code || typeof m.t !== 'string' || bad[it.nickname_id];
        var li = h('li.q' + (m && m.k === 'feedback' ? '.feedback' : '') + (warn ? '.warn' : ''), { 'data-status': it.status },
          h('div.q-head', null,
            h('strong', { text: m && typeof m.n === 'string' ? m.n : '?' }),
            h('span', { text: m && m.k === 'feedback' ? 'Palaute' : 'Kysymys' }),
            h('span', { text: fmtTime(it.created_at) }),
            h('span', { text: STATUS_LABEL[it.status] || it.status })),
          !m ? notice('Viestiä ei voitu purkaa. Se on vioittunut tai salattu toisella avaimella.', 'error') : null,
          m && m.e !== event.code ? notice('Viesti on salattu toiselle luennolle. Se on voitu siirtää tietokannassa.', 'error') : null,
          bad[it.nickname_id] ? notice('Sama nimimerkkivaraus on käyttänyt eri nimimerkkejä.', 'error') : null,
          m ? h('p.q-text', { text: String(m.t) }) : null,
          h('div.q-actions', null,
            m ? h('button.btn.small', { type: 'button', text: 'Näytä projektorilla', onclick: function () {
              present('esitys', { type: 'question', nick: typeof m.n === 'string' ? m.n : '?', text: String(m.t) });
              if (it.status === 'new') setStatus(it, 'answered');
            } }) : null,
            it.status !== 'answered' ? h('button.btn.ghost.small', { type: 'button', text: 'Merkitse vastatuksi', onclick: function () { setStatus(it, 'answered'); } }) : null,
            it.status !== 'new' ? h('button.btn.ghost.small', { type: 'button', text: 'Palauta uudeksi', onclick: function () { setStatus(it, 'new'); } }) : null,
            it.status !== 'archived' ? h('button.btn.ghost.small', { type: 'button', text: 'Arkistoi', onclick: function () { setStatus(it, 'archived'); } }) : null,
            h('button.btn.danger.small', { type: 'button', text: 'Poista', onclick: function () {
              if (!window.confirm('Poistetaanko viesti pysyvästi?')) return;
              api('POST', 'questions/' + it.id + '/delete', {}).then(function () {
                items = items.filter(function (x) { return x.id !== it.id; }); renderList();
              });
            } })));
        listEl.appendChild(li);
      });
    }

    function poll() {
      return api('GET', 'events/' + id + '/questions?after=' + lastId).then(function (r) {
        var first = event === null;
        event = r.event;
        r.questions.forEach(function (q) {
          items.push({ id: q.id, status: q.status, created_at: q.created_at, nickname_id: q.nickname_id, msg: decrypt(q.ciphertext) });
          if (q.id > lastId) lastId = q.id;
        });
        var statuses = r.statuses || {};
        items = items.filter(function (it) { return statuses[it.id] !== undefined; });
        items.forEach(function (it) { it.status = statuses[it.id]; });
        if (first) renderHead();
        renderList();
      });
    }

    // Päivitys: kysymykset ja kyselyvastaukset. Ajastin toimii, kun välilehti on näkyvissä;
    // taustalla esitysikkunan tick-viesti kutsuu samaa funktiota (ks. esitysnäyttö).
    function refreshAll() {
      return poll().then(function () { return panel.refresh(); });
    }

    mount(headEl, panel.el, h('h2', { text: 'Kysymykset ja palaute' }), filtersEl, listEl);
    filtersEl.replaceChildren.apply(filtersEl, filterButtons());
    poll().then(function () { return panel.load(); }).then(function () { return panel.refresh(); }).then(function () {
      liveRefresh = function () { refreshAll().catch(function () {}); };
      pollTimer = setInterval(function () {
        if (document.hidden) return;
        refreshAll().catch(function () {});
      }, POLL_MS);
    }).catch(function (e) { if (e.message !== '401') root.appendChild(notice(e.message, 'error')); });
  }

  function stopPolling() {
    liveRefresh = null;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ================================================================ näkymä: asetukset

  function showSettings() {
    var out = h('div');
    var pkList = h('ul.event-list');
    state.passkeys.forEach(function (p) {
      pkList.appendChild(h('li', null,
        h('span.code', { text: '#' + p.id }),
        h('strong', { text: p.name }),
        h('button.btn.danger.small.open-btn', { type: 'button', text: 'Poista', onclick: function () {
          if (!window.confirm('Poistetaanko passkey "' + p.name + '"?')) return;
          api('POST', 'passkeys/' + p.id + '/delete', {}).then(loadState).then(showSettings)
            .catch(function (e) { out.replaceChildren(notice(e.message, 'error')); });
        } }),
        p.prf ? h('button.btn.ghost.small', { type: 'button', text: 'Poista avaus', title: 'Tunnuslause kysytään taas tällä passkeylla', onclick: function () {
          if (!window.confirm('Poistetaanko avaus passkeylla "' + p.name + '"? Kirjautuminen toimii edelleen, mutta avaimen avaus vaatii tunnuslauseen.')) return;
          api('POST', 'passkeys/' + p.id + '/prf-delete', {}).then(loadState).then(showSettings)
            .catch(function (e) { out.replaceChildren(notice(e.message, 'error')); });
        } }) : null,
        h('span.meta', { text: 'Luotu ' + fmtTime(p.created_at) + (p.last_used_at ? ', käytetty ' + fmtTime(p.last_used_at) : '')
          + (p.prf ? ' · avaus passkeylla käytössä' : ' · avaus tunnuslauseella')
          + (p.id === state.passkey ? ' · tämä istunto' : '') })));
    });
    var pkName = h('input', { type: 'text', id: 'new-pk', maxlength: 60, placeholder: 'esim. iPhone' });
    var pp = passphraseFields('Uusi tunnuslause');
    var audit = h('ul.event-list');

    mount(toolbar('Asetukset', h('button.btn.ghost.small', { type: 'button', text: 'Kaikki luennot', onclick: function () { showEvents(); } })),
      out,
      h('h2', { text: 'Passkeyt' }),
      h('p', { text: 'Lisää varapasskey esimerkiksi puhelimeen, jotta et lukitse itseäsi ulos.' }),
      h('p.hint', { text: 'Avaus passkeylla: passkey tuottaa laitteessa salaisen arvon, jolla yksityinen avain avataan tässä selaimessa. Arvo ei lähde palvelimelle. Avaus otetaan käyttöön passkeykohtaisesti, kun avaat kerran tunnuslauseella sillä kirjauduttuasi. Tunnuslause ja varmuuskopio jäävät varakeinoksi.' }),
      pkList,
      h('form.row-form', { onsubmit: function (ev) {
        ev.preventDefault();
        registerPasskey(pkName.value.trim() || 'Passkey').then(loadState).then(function () { showSettings(); })
          .catch(function (e) { out.replaceChildren(notice(e.message, 'error')); });
      } }, h('div', null, h('label', { for: 'new-pk', text: 'Uuden passkeyn nimi' }), pkName), h('button.btn', { type: 'submit', text: 'Lisää passkey' })),

      h('h2', { text: 'Salausavain' }),
      h('p', null, 'Sormenjälki ', h('span.fingerprint', { text: state.keys.fingerprint })),
      h('p', null, h('button.btn.ghost.small', { type: 'button', text: 'Lataa avaimen varmuuskopio', onclick: function () { downloadBackup(state.keys); } })),
      h('form', { onsubmit: function (ev) {
        ev.preventDefault();
        var pass;
        try { pass = pp.value(); } catch (e) { out.replaceChildren(notice(e.message, 'error')); return; }
        var wrapped = wrapSecret(secretKey, publicKey, pass);
        api('POST', 'keys/rewrap', wrapped).then(loadState).then(function () {
          downloadBackup(state.keys);
          out.replaceChildren(notice('Tunnuslause vaihdettu. Uusi varmuuskopio ladattiin.', 'ok'));
        }).catch(function (e) { out.replaceChildren(notice(e.message, 'error')); });
      } }, h('h3', { text: 'Vaihda tunnuslause' }), pp.nodes, h('p', null, h('button.btn.small', { type: 'submit', text: 'Vaihda tunnuslause' }))),

      h('h2', { text: 'Tietoturvaloki' }),
      audit);

    api('GET', 'audit').then(function (r) {
      r.entries.forEach(function (e) {
        audit.appendChild(h('li', null, h('span.code', { text: e.action }), h('span', { text: e.detail }),
          h('span.meta', { text: fmtTime(e.ts) + ', asiakas ' + String(e.client).slice(0, 8) })));
      });
    }).catch(function () {});
  }

  // ================================================================ käynnistys

  function start() {
    if (!secretKey) {
      return loadState().then(function () {
        if (!state.keys) { forgetPrf(); showKeySetup(); return; }
        var hadWrap = !!(pendingPrf && pendingPrf.wrap);
        if (unlockWithPrf(state.keys)) { showEvents(); return; }
        showUnlock(hadWrap ? 'Avaus passkeylla epäonnistui. Avaa tunnuslauseella.' : null);
      }).catch(function (e) { if (e.message !== '401') mount(notice(e.message, 'error')); });
    }
    return loadState().then(function () { showEvents(); });
  }

  var s = window.sodium;
  (s && s.ready ? s.ready.then(function () { return s; }) : Promise.reject(new Error('Salauskirjasto puuttuu.')))
    .then(function (lib) {
      sodium = lib;
      var mode = root.dataset.mode;
      if (mode === 'setup') showSetup();
      else if (mode === 'login') showLogin();
      else start();
    })
    .catch(function (e) { mount(notice('Alustus epäonnistui: ' + e.message, 'error')); });

  // Lukitse avain, jos välilehti suljetaan tai sivu ladataan uudelleen.
  // Tyhjennä myös esitysnäyttö, ettei purettu sisältö jää sinne näkyviin.
  window.addEventListener('pagehide', function () { if (secretKey) sodium.memzero(secretKey); secretKey = null; presenterEnd(); });
})();
