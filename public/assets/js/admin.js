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
  var POLL_MS = 1000;   // vaatimus 8: tulokset esitysnäkymään alle 2 s:ssa (haut ovat inkrementaalisia, ?after=)

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
      state.events && state.events.length ? h('p', null, h('button.btn.ghost.small', { type: 'button', text: 'Puhelinohjain',
        title: 'Ohjaa aktiivista kysymystä avaamatta salausavainta', onclick: showRemotePicker })) : null,
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
        h('p.actions', null, h('button.btn' + (pendingPrf ? '' : '.ghost'), { type: 'submit', text: 'Avaa tunnuslauseella' }), ' ', logoutButton())),
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
    var lang = langSelect('ev-lang', null);
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
        api('POST', 'events', { title: title.value, hours: hours.value ? parseInt(hours.value, 10) : null, lang: lang.value || null })
          .then(function (r) { return loadState().then(function () { showEvent(r.event.id); }); })
          .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
      } },
        h('div', null, h('label', { for: 'ev-title', text: 'Uuden luennon nimi' }), title),
        h('div', null, h('label', { for: 'ev-hours', text: 'Kysymykset auki' }), hours),
        h('div', null, h('label', { for: 'ev-lang', text: 'Osallistujien kieli' }), lang),
        h('button.btn', { type: 'submit', text: 'Luo luento' })),
      out, list);
    render();
  }

  // ================================================================ näkymä: yksi luento

  /** Osallistujan sivun oletuskieli. Osallistuja voi silti vaihtaa kieltä FI/EN-kytkimestä. */
  function langSelect(id, value) {
    return h('select', { id: id },
      h('option', { value: '', text: 'Selaimen kielen mukaan', selected: !value }),
      h('option', { value: 'en', text: 'English', selected: value === 'en' }),
      h('option', { value: 'fi', text: 'Suomi', selected: value === 'fi' }));
  }

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
  var liveCommand = null;     // nykyisen luentonäkymän ohjausfunktio (pikanäppäimet ja esitysikkunan komennot)
  var eventTab = 'polls';     // luentonäkymän valittu välilehti (säilyy luentojen välillä tämän sivun ajan)

  // Pikanäppäimet (hallinta ja esitysikkuna). Esitysohjaimet lähettävät yleensä PageUp/PageDown.
  var COMMAND_KEYS = {
    ArrowRight: 'next', PageDown: 'next', ArrowLeft: 'prev', PageUp: 'prev',
    ' ': 'toggle', r: 'results', R: 'results', a: 'reveal', A: 'reveal', q: 'qr', Q: 'qr'
  };
  var COMMANDS = { next: 1, prev: 1, toggle: 1, results: 1, reveal: 1, qr: 1 };
  document.addEventListener('keydown', function (e) {
    if (!liveCommand || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var t = e.target;
    // Lomakkeissa näppäimet toimivat normaalisti. Ohjauspalkin napeissa pikanäppäin voittaa: muuten
    // hiirellä painettu (fokukseen jäänyt) Seuraava-nappi painuisi välilyönnistä uudelleen.
    var inControl = t && t.closest && t.closest('.live-control');
    if (t && !inControl && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(t.tagName))) return;
    var cmd = COMMAND_KEYS[e.key];
    if (!cmd) return;
    e.preventDefault();
    liveCommand(cmd);
  });
  var lastTick = 0;

  function screenOpen(sc) { return !!sc && !!sc.win && !sc.win.closed; }

  // Projektorin kieli = luennon osallistujien kieli (yleisö on sama). "Selaimen mukaan" → suomi.
  var screenLang = 'fi';
  function setScreenLang(eventLang) {
    var next = eventLang === 'en' ? 'en' : 'fi';
    if (next === screenLang) return;
    screenLang = next;
    Object.keys(screens).forEach(function (k) { var sc = screens[k]; if (sc.msg) screenPost(sc, sc.live ? (sc.msg = sc.live()) : sc.msg); });
  }

  function screenPost(sc, msg) {
    if (screenOpen(sc)) sc.win.postMessage(Object.assign({}, msg, { lang: screenLang }), ORIGIN);
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
    } else if (ev.data.type === 'command' && liveCommand && COMMANDS[ev.data.cmd] === 1) {
      liveCommand(ev.data.cmd);
    } else if (ev.data.type === 'tick' && liveRefresh && Date.now() - lastTick > 800) {
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

  var TYPE_LABEL = { single: 'Monivalinta, yksi vastaus', multi: 'Monivalinta, useita vastauksia', open: 'Avoin teksti', words: 'Sanapilvi', likert: 'Likert-asteikko', scale: 'Asteikko 0–10' };
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
   * Luennon kysymyssarjat ja kyselyt: luonti, järjestys, ohitus, aktiivisen kysymyksen ohjaus
   * ja reaaliaikaiset tulokset. Vastaukset puretaan tässä selaimessa; palvelin ei näe niitä.
   */
  function pollsPanel(eventId, getEvent) {
    var sets = [];
    var polls = [];
    var active = null;      // aktiivisen kysymyksen id tai null (odotusnäkymä)
    var showQr = false;     // projektorin iso QR-koodi
    var version = null;     // ohjaustilan versio: muuttuu, kun toinen hallintaikkuna (esim. puhelin) ohjaa
    var answers = {};       // kyselyn id -> { vastaaja: vastaus }
    var invalid = {};       // kyselyn id -> hylättyjen vastausten määrä
    var generations = {};   // kyselyn id -> sukupolvi (kasvaa, kun vastaukset tyhjennetään)
    var mods = {};          // kyselyn id -> moderointi (piilotetut/hyväksytyt), tallennetaan salattuna palvelimelle
    var expanded = {};      // kyselyn id -> tulokset auki
    var lastAnswerId = 0;
    var lastTs = {};        // kyselyn id -> viimeisimmän vastauksen aikaleima (CSV)
    var views = {};         // kyselyn id -> tuloselementti (säilyy, jotta kaaviot animoituvat)
    var controlEl = h('div.live-control');
    var setsEl = h('div.set-list');
    var formEl = h('div');
    var outEl = h('div');
    var fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 60000) { outEl.replaceChildren(notice('Tiedosto on liian suuri (enintään 60 kt).', 'error')); return; }
      file.text().then(previewImport).catch(fail);
    } });
    var el = h('section.polls-admin', null, fileInput,
      h('div.toolbar', null, h('h2', { text: 'Kysymyssarjat' }), h('span.spacer'),
        h('button.btn.ghost.small', { type: 'button', text: 'Tuo JSON', title: 'Tuo sarjat JSON-tiedostosta', onclick: function () { fileInput.click(); } }),
        h('button.btn.ghost.small', { type: 'button', text: 'Vie JSON', title: 'Lataa kaikki sarjat JSON-tiedostona', onclick: function () { exportJson(null); } }),
        h('button.btn.ghost.small', { type: 'button', text: 'Vie CSV', title: 'Tulokset taulukkona (puretaan tässä selaimessa)', onclick: function () { exportCsv(null); } }),
        h('button.btn.small', { type: 'button', text: 'Uusi sarja', onclick: function () { showSetForm(null); } })),
      outEl, formEl, setsEl);

    function findPoll(pid) {
      for (var i = 0; i < polls.length; i++) if (polls[i].id === pid) return polls[i];
      return null;
    }
    function findSet(sid) {
      for (var i = 0; i < sets.length; i++) if (sets[i].id === sid) return sets[i];
      return null;
    }
    function fail(e) { if (e.message !== '401') outEl.replaceChildren(notice(e.message, 'error')); }

    function applyState(r) {
      sets = r.sets; polls = r.polls; active = r.active;
      if (typeof r.version === 'number') version = r.version;
      if (typeof r.show_qr === 'boolean') showQr = r.show_qr;
      polls.forEach(function (p) { mods[p.id] = readModeration(p.moderation); });
      outEl.replaceChildren();
      renderAll();
    }

    // ---------------------------------------------------------------- moderointi
    // Piilotukset salataan omalla julkisella avaimella (sealed box): palvelin ei näe piilotettuja sanoja.

    function toSet(list, numeric) {
      var out = {};
      (Array.isArray(list) ? list : []).forEach(function (v) {
        if (numeric ? Number.isInteger(v) : typeof v === 'string' && v.length <= 100) out[v] = true;
      });
      return out;
    }
    function readModeration(ct) {
      var m = ct ? decrypt(ct) : null;
      var mod = HessuResults.emptyModeration();
      if (!m || m.v !== 1) return mod;
      mod.words = toSet(m.words); mod.answers = toSet(m.answers, true);
      mod.approved = toSet(m.approved, true); mod.approvedWords = toSet(m.approvedWords);
      return mod;
    }
    function keys(o, numeric) { return Object.keys(o).map(function (k) { return numeric ? parseInt(k, 10) : k; }); }
    function saveModeration(poll) {
      var m = mods[poll.id];
      var empty = !Object.keys(m.words).length && !Object.keys(m.answers).length && !Object.keys(m.approved).length && !Object.keys(m.approvedWords).length;
      var ct = empty ? null : b64(sodium.crypto_box_seal(sodium.from_string(JSON.stringify({
        v: 1, words: keys(m.words), answers: keys(m.answers, true), approved: keys(m.approved, true), approvedWords: keys(m.approvedWords)
      })), publicKey));
      updateResults();
      api('POST', 'polls/' + poll.id + '/moderation', { ciphertext: ct }).catch(fail);
    }
    function modFor(poll) { return mods[poll.id] || (mods[poll.id] = HessuResults.emptyModeration()); }
    function load() {
      return api('GET', 'events/' + eventId + '/polls').then(applyState);
    }
    function liveAct(body) {
      return api('POST', 'events/' + eventId + '/live', body).then(applyState).catch(fail);
    }

    function tallyFor(poll) {
      var map = answers[poll.id] || {};
      return HessuResults.tally(poll, Object.keys(map).map(function (k) { return map[k]; }), modFor(poll));
    }

    function pollMessage(pid) {
      var poll = findPoll(pid);
      if (!poll) return { type: 'blank' };
      var data = tallyFor(poll);
      // Projektorille vain näkyvien avoimien vastausten tekstit (uusimmat), ei tunnisteita. Pitkistä
      // pohdintavastauksista vain alku: koko teksti jää hallintaan ja CSV:hen.
      if (poll.type === 'open') data = { voters: data.voters, items: data.items.slice(0, 30).map(function (it) { return HessuResults.clip(it.text); }) };
      return {
        type: 'poll', code: getEvent().code, url: poll.url, status: poll.status,
        poll: { id: poll.id, type: poll.type, prompt: poll.prompt, config: HessuResults.publicConfig(poll.config) },
        data: data, results: poll.results_visible, reveal: revealFor(poll), bigQr: showQr
      };
    }
    function revealFor(poll) {
      return poll.revealed && Array.isArray(poll.config.correct)
        ? { correct: poll.config.correct, explanations: poll.config.explanations || null } : null;
    }

    // Tuloskooste osallistujille (P2): vain kun tulokset ovat näkyvissä, vain määrät ja tunnusluvut.
    // Lähetetään, kun luvut muuttuvat, enintään parin sekunnin välein.
    var SUMMARY_TYPES = { single: 1, multi: 1, likert: 1, scale: 1 };
    var published = {};      // kyselyn id -> { key, at }
    var summaryTimer = null;
    function publishSummaries() {
      polls.forEach(function (poll) {
        if (!poll.results_visible || !SUMMARY_TYPES[poll.type]) { delete published[poll.id]; return; }
        var d = tallyFor(poll);
        var summary = { voters: d.voters, counts: d.counts };
        if (typeof d.mean === 'number') { summary.mean = Math.round(d.mean * 100) / 100; summary.median = d.median; }
        var key = JSON.stringify(summary);
        var prev = published[poll.id];
        if (prev && prev.key === key) return;
        if (prev && Date.now() - prev.at < 2000) {
          if (!summaryTimer) summaryTimer = setTimeout(function () { summaryTimer = null; publishSummaries(); }, 2100);
          return;
        }
        published[poll.id] = { key: key, at: Date.now() };
        api('POST', 'polls/' + poll.id + '/summary', { summary: summary }).catch(function () { delete published[poll.id]; });
      });
    }

    /** Projektorin "aktiivinen kysymys" -ikkuna: aktiivinen kysymys tai luennon QR-koodi. */
    function liveMessage() {
      var ev = getEvent();
      return active ? pollMessage(active) : { type: 'qr', code: ev.code, url: ev.url };
    }

    /** Ohjauskomento pikanäppäimestä, esitysikkunasta tai napista. */
    function command(cmd) {
      var poll = findPoll(active);
      switch (cmd) {
        case 'next': return liveAct({ action: 'next' });
        case 'prev': return liveAct({ action: 'prev' });
        case 'toggle': if (poll) act(poll, 'status', { status: poll.status === 'open' ? 'closed' : 'open' }); return;
        case 'results': if (poll) act(poll, 'results', { visible: !poll.results_visible }); return;
        case 'reveal': if (poll && Array.isArray(poll.config.correct)) act(poll, 'reveal', { revealed: !poll.revealed }); return;
        case 'qr':
          api('POST', 'events/' + eventId + '/qr', { show: !showQr }).then(load).catch(fail);
      }
    }

    /** Hakee uudet salatut vastaukset, purkaa ja tarkistaa ne. */
    function refreshAnswers() {
      return api('GET', 'events/' + eventId + '/poll-answers?after=' + lastAnswerId).then(function (r) {
        // Toinen hallintaikkuna (puhelimen ohjain) muutti tilaa: ladataan kysymykset ja ohjaustila.
        if (typeof r.version === 'number' && version !== null && r.version !== version) {
          return load().then(function () { return refreshAnswers(); });
        }
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
          if (!lastTs[a.poll_id] || a.ts > lastTs[a.poll_id]) lastTs[a.poll_id] = a.ts;
          var poll = findPoll(a.poll_id);
          var m = decrypt(a.ciphertext);
          // Vastaus hyväksytään vain, jos se on salattu juuri tälle luennolle ja kyselylle.
          var value = m && m.e === code && m.p === a.poll_id ? HessuResults.validAnswer(poll, m.a) : null;
          var map = answers[a.poll_id] || (answers[a.poll_id] = {});
          if (value === null) { invalid[a.poll_id] = (invalid[a.poll_id] || 0) + 1; delete map[a.voter]; }
          else map[a.voter] = poll.type === 'open' ? { id: a.id, text: value, ts: a.ts } : value;
          changed = true;
        });
        if (changed) updateResults();
        return r.answers.length;
      });
    }

    // ---------------------------------------------------------------- CSV-vienti (vaatimus 5.4)
    // Vastaukset puretaan tässä selaimessa: palvelin ei näe CSV:n sisältöä. Ei osallistujatunnisteita.

    function loadAllAnswers() {
      return refreshAnswers().then(function (n) { return n >= 2000 ? loadAllAnswers() : null; });
    }
    function iso(ts) { return ts ? new Date(ts * 1000).toISOString() : ''; }

    function csvRows(onlySet) {
      var rows = [['Sarja', 'Sarjan nimi', 'Nro', 'Kysymys', 'Tyyppi', 'Vaihtoehto tai vastaus', 'Määrä', 'Aikaleima (UTC)', 'Piilotettu']];
      sets.forEach(function (set) {
        if (onlySet && set.id !== onlySet.id) return;
        polls.filter(function (p) { return p.set_id === set.id; }).forEach(function (poll, i) {
          var map = answers[poll.id] || {};
          var values = Object.keys(map).map(function (k) { return map[k]; });
          var mod = modFor(poll);
          var row = function (label, count, ts, hidden) {
            rows.push([set.slug, set.title, i + 1, poll.prompt, TYPE_LABEL[poll.type] || poll.type, label, count, iso(ts), hidden ? 'kyllä' : '']);
          };
          var d = HessuResults.tally(poll, values, mod);
          if (poll.type === 'single' || poll.type === 'multi') {
            poll.config.options.forEach(function (opt, j) { row(opt, d.counts[j], lastTs[poll.id]); });
          } else if (poll.type === 'likert' || poll.type === 'scale') {
            d.counts.forEach(function (n, j) { row(String(d.from + j), n, lastTs[poll.id]); });
          } else if (poll.type === 'words') {
            var counts = {};
            values.forEach(function (w) { counts[w] = (counts[w] || 0) + 1; });
            Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x] || (x < y ? -1 : 1); })
              .forEach(function (w) { row(w, counts[w], lastTs[poll.id], HessuResults.isHiddenWord(mod, w)); });
          } else {
            values.slice().sort(function (x, y) { return x.ts - y.ts || x.id - y.id; })
              .forEach(function (it) { row(it.text, 1, it.ts, HessuResults.isHiddenAnswer(mod, it)); });
          }
          if (!values.length && (poll.type === 'words' || poll.type === 'open')) row('', 0, null);
        });
      });
      return rows;
    }

    function exportCsv(set) {
      loadAllAnswers().then(function () {
        var blob = new Blob(['\ufeff' + HessuResults.csv(csvRows(set))], { type: 'text/csv;charset=utf-8' });
        var a = h('a', { href: URL.createObjectURL(blob), download: 'hessutalks-' + getEvent().code + (set ? '-' + set.slug : '') + '-tulokset.csv' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }).catch(fail);
    }

    // ---------------------------------------------------------------- esikatselu (vaatimus 6)

    function previewParticipant(poll) {
      window.open(BASE + '/admin/esikatselu?poll=' + poll.id, 'hessutalks-esikatselu', 'popup,noopener,width=430,height=780');
    }
    function previewStage(poll) {
      var msg = pollMessage(poll.id);
      msg.results = false; msg.reveal = null; msg.bigQr = false;
      present('esikatselu', msg);
    }

    function updateResults() {
      polls.forEach(function (poll) {
        var view = views[poll.id];
        if (!view || !view.el.isConnected) return;
        var data = tallyFor(poll);
        view.count.textContent = data.voters + ' vastausta' +
          (invalid[poll.id] ? ', ' + invalid[poll.id] + ' hylätty (virheellinen tai toiselle kyselylle salattu)' : '');
        if (view.details.open) {
          // Hallinnassa luvut näkyvät aina; oikeat vastaukset korostetaan (vain luennoitsijalle).
          var opts = poll.type === 'words' ? { onWord: function (word) { hideWord(poll, word); } }
            : poll.type === 'open' ? { onAnswer: function (it) { hideAnswer(poll, it); } }
            : { reveal: Array.isArray(poll.config.correct) ? { correct: poll.config.correct, explanations: poll.config.explanations || null } : null };
          HessuResults.render(view.el, poll, data, opts);
          renderHidden(poll);
        }
      });
      renderControlCount();
      publishSummaries();
      updateScreens();
    }

    function hideWord(poll, word) {
      if (!window.confirm('Piilotetaanko "' + word + '" tuloksista ja projektorilta?')) return;
      modFor(poll).words[word] = true;
      delete modFor(poll).approvedWords[word];
      saveModeration(poll);
    }
    function hideAnswer(poll, it) {
      modFor(poll).answers[it.id] = true;
      delete modFor(poll).approved[it.id];
      saveModeration(poll);
    }

    /** Piilotetut ja suodattimen piilottamat (tarkistettavat) vastaukset ja sanat, palautus- ja hyväksyntänapein. */
    function renderHidden(poll) {
      var view = views[poll.id];
      var mod = modFor(poll);
      var map = answers[poll.id] || {};
      var all = Object.keys(map).map(function (k) { return map[k]; });
      view.hidden.replaceChildren();
      var chip = function (label, title, onclick) { return h('button.btn.ghost.small', { type: 'button', text: label, title: title, onclick: onclick }); };
      var rows = [];
      if (poll.type === 'words') {
        var uniq = {};
        all.forEach(function (w) { uniq[w] = true; });
        Object.keys(uniq).forEach(function (w) {
          if (mod.words[w]) rows.push(chip(w + ' ↺', 'Palauta näkyviin', function () { delete mod.words[w]; saveModeration(poll); }));
          else if (HessuResults.isProfane(w) && !mod.approvedWords[w]) rows.push(chip('⚠ ' + w + ' ✓', 'Kirosanasuodatin piilotti. Hyväksy näkyviin', function () { mod.approvedWords[w] = true; saveModeration(poll); }));
        });
        Object.keys(mod.words).forEach(function (w) { if (!uniq[w]) rows.push(chip(w + ' ↺', 'Palauta näkyviin', function () { delete mod.words[w]; saveModeration(poll); })); });
      } else if (poll.type === 'open') {
        all.forEach(function (it) {
          if (mod.answers[it.id]) rows.push(chip(it.text.slice(0, 60) + ' ↺', 'Palauta näkyviin', function () { delete mod.answers[it.id]; saveModeration(poll); }));
          else if (HessuResults.isProfane(it.text) && !mod.approved[it.id]) rows.push(chip('⚠ ' + it.text.slice(0, 60) + ' ✓', 'Kirosanasuodatin piilotti. Hyväksy näkyviin', function () { mod.approved[it.id] = true; saveModeration(poll); }));
        });
      }
      if (!rows.length) return;
      view.hidden.appendChild(h('span.hint', { text: 'Piilotetut (↺ palauta, ⚠ suodatin: ✓ hyväksy): ' }));
      rows.forEach(function (r) { view.hidden.appendChild(r); });
    }

    function act(poll, action, body, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      api('POST', 'polls/' + poll.id + '/' + action, body || {}).then(function () {
        if (action === 'delete') {
          var sc = screens['kysely-' + poll.id];
          if (sc) { sc.live = null; sc.msg = { type: 'blank' }; screenPost(sc, sc.msg); }
        }
        if (action === 'reset') { answers[poll.id] = {}; invalid[poll.id] = 0; }
        return load();
      }).catch(fail);
    }
    function setAct(set, action, body, confirmText) {
      if (confirmText && !window.confirm(confirmText)) return;
      api('POST', 'sets/' + set.id + '/' + action, body || {}).then(applyState).catch(fail);
    }

    // ---------------------------------------------------------------- ohjauspalkki

    var controlCount = h('span.hint');
    function renderControlCount() {
      var poll = findPoll(active);
      controlCount.textContent = poll ? tallyFor(poll).voters + ' vastausta' : '';
    }

    function renderControl() {
      var poll = findPoll(active);
      var set = poll ? findSet(poll.set_id) : null;
      var order = polls.filter(function (p) { return !p.skipped || p.id === active; });
      var index = poll ? order.indexOf(poll) + 1 : 0;
      var toggle = poll && poll.status === 'open'
        ? h('button.btn.small', { type: 'button', text: 'Sulje vastaukset', onclick: function () { act(poll, 'status', { status: 'closed' }); } })
        : poll ? h('button.btn.small', { type: 'button', text: 'Avaa vastauksille', onclick: function () { act(poll, 'status', { status: 'open' }); } }) : null;
      controlEl.replaceChildren();
      append(controlEl, [
        h('div.live-now', null,
          h('span.eyebrow', { text: 'Aktiivinen kysymys' + (poll ? ' ' + index + '/' + order.length : '') }),
          poll ? h('span.badge.' + poll.status, { text: POLL_STATUS_LABEL[poll.status] || poll.status }) : null,
          poll && set ? h('span.code', { text: set.slug }) : null,
          h('strong', { text: poll ? poll.prompt : 'Ei aktiivista: osallistujat näkevät odotusnäkymän.' }),
          controlCount),
        h('div.q-actions', null,
          h('button.btn.ghost.small', { type: 'button', text: '← Edellinen', onclick: function () { liveAct({ action: 'prev' }); } }),
          h('button.btn.small', { type: 'button', text: 'Seuraava →', onclick: function () { liveAct({ action: 'next' }); } }),
          toggle,
          poll ? h('button.btn.small' + (poll.results_visible ? '' : '.ghost'), { type: 'button', 'aria-pressed': String(poll.results_visible),
            text: poll.results_visible ? 'Piilota tulokset' : 'Näytä tulokset', title: 'Tulokset projektorille ja osallistujille (R)',
            onclick: function () { act(poll, 'results', { visible: !poll.results_visible }); } }) : null,
          poll && Array.isArray(poll.config.correct) ? h('button.btn.small' + (poll.revealed ? '' : '.ghost'), { type: 'button', 'aria-pressed': String(poll.revealed),
            text: poll.revealed ? 'Piilota oikea vastaus' : 'Paljasta oikea vastaus', title: 'Oikea vastaus ja selitykset (A)',
            onclick: function () { act(poll, 'reveal', { revealed: !poll.revealed }); } }) : null,
          poll ? h('button.btn.ghost.small', { type: 'button', text: 'Odotusnäkymä', title: 'Ei aktiivista kysymystä', onclick: function () { liveAct({ action: 'activate', poll: null }); } }) : null,
          h('button.btn.small' + (showQr ? '' : '.ghost'), { type: 'button', 'aria-pressed': String(showQr), text: showQr ? 'QR pieneksi' : 'QR isona', title: 'Iso QR-koodi projektorille (Q)',
            onclick: function () { command('qr'); } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Aktiivinen projektorille', onclick: function () {
            present('aktiivinen', liveMessage(), liveMessage);
          } })),
        h('p.hint.shortcuts', { text: 'Pikanäppäimet (myös esitysikkunassa): → / PageDown seuraava · ← / PageUp edellinen · välilyönti avaa/sulkee · R tulokset · A oikea vastaus · Q iso QR' }),
        poll && poll.status === 'draft'
          ? h('p.hint', { text: 'Luonnos: kysymys näkyy projektorilla, mutta osallistujat näkevät odotusnäkymän, kunnes avaat sen vastauksille.' })
          : null]);
      renderControlCount();
    }

    // ---------------------------------------------------------------- sarjat ja kyselyt

    /** Oikeat vastaukset hallinnalle (osallistujat eivät saa niitä ennen paljastusta). */
    function correctHint(poll) {
      var c = poll.config.correct;
      if (!Array.isArray(c) || !c.length) return null;
      var opts = poll.config.options || [];
      return h('span.hint.correct', { title: c.map(function (i) { return opts[i]; }).join(' · '),
        text: 'Oikea: ' + c.map(function (i) { return String(i + 1); }).join(', ') + (poll.config.explanations ? ' · selitykset' : '') });
    }

    function pollCard(poll, i, count) {
      var view = views[poll.id] || (views[poll.id] = { el: h('div'), count: h('span'), hidden: h('div.poll-hidden'), details: null });
      var isActive = poll.id === active;
      var details = h('details.poll-results', null, h('summary', null, 'Tulokset · ', view.count), view.el, view.hidden);
      details.open = isActive || !!expanded[poll.id];
      details.addEventListener('toggle', function () { expanded[poll.id] = details.open; updateResults(); });
      view.details = details;
      return h('article.poll-card' + (isActive ? '.active' : ''), { 'data-status': poll.status },
        h('div.poll-card-head', null,
          h('span.code', { text: String(i + 1) }),
          h('span.badge.' + poll.status, { text: POLL_STATUS_LABEL[poll.status] || poll.status }),
          isActive ? h('span.badge.live', { text: 'Aktiivinen' }) : null,
          poll.results_visible ? h('span.badge.open', { text: 'Tulokset näkyvissä' }) : null,
          poll.revealed ? h('span.badge.open', { text: 'Paljastettu' }) : null,
          h('span.hint', { text: (TYPE_LABEL[poll.type] || poll.type) + (poll.type === 'open' && HessuResults.openMax(poll) !== HessuResults.OPEN_MAX ? ' · enintään ' + HessuResults.openMax(poll) + ' merkkiä' : '') }),
          correctHint(poll)),
        h('p.poll-card-prompt', { text: poll.prompt }),
        h('div.q-actions', null,
          !isActive ? h('button.btn.small', { type: 'button', text: 'Näytä', title: 'Tee aktiiviseksi', onclick: function () { liveAct({ action: 'activate', poll: poll.id }); } }) : null,
          poll.status === 'open'
            ? h('button.btn.small', { type: 'button', text: 'Sulje', onclick: function () { act(poll, 'status', { status: 'closed' }); } })
            : h('button.btn.small', { type: 'button', text: 'Avaa', title: 'Avaa vastauksille ja tee aktiiviseksi', onclick: function () { act(poll, 'status', { status: 'open' }); } }),
          h('button.btn.ghost.small', { type: 'button', text: '↑', title: 'Siirrä ylös', disabled: i === 0, onclick: function () { act(poll, 'move', { dir: -1 }); } }),
          h('button.btn.ghost.small', { type: 'button', text: '↓', title: 'Siirrä alas', disabled: i === count - 1, onclick: function () { act(poll, 'move', { dir: 1 }); } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Tulokset projektorille', onclick: function () {
            present('kysely-' + poll.id, pollMessage(poll.id), function () { return pollMessage(poll.id); });
          } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Esikatsele', title: 'Osallistujan näkymä', onclick: function () { previewParticipant(poll); } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Esikatsele projektorilla', onclick: function () { previewStage(poll); } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Muokkaa', onclick: function () { showForm(poll, findSet(poll.set_id)); } }),
          sets.length > 1 ? (function () {
            var sel = h('select.move-set', { 'aria-label': 'Siirrä toiseen sarjaan' },
              h('option', { value: '', text: 'Siirrä sarjaan…' }),
              sets.filter(function (s) { return s.id !== poll.set_id; }).map(function (s) { return h('option', { value: String(s.id), text: s.slug + ' ' + s.title }); }));
            sel.addEventListener('change', function () { if (sel.value) act(poll, 'set', { set_id: parseInt(sel.value, 10) }); });
            return sel;
          })() : null,
          h('button.btn.ghost.small', { type: 'button', text: 'Tyhjennä vastaukset', onclick: function () {
            act(poll, 'reset', {}, 'Tyhjennetäänkö kyselyn "' + poll.prompt + '" kaikki vastaukset pysyvästi?');
          } }),
          h('button.btn.danger.small', { type: 'button', text: 'Poista', onclick: function () {
            act(poll, 'delete', {}, 'Poistetaanko kysely "' + poll.prompt + '" ja sen vastaukset pysyvästi?');
          } })),
        details);
    }

    function renderAll() {
      renderControl();
      setsEl.replaceChildren();
      if (!sets.length) {
        setsEl.appendChild(h('p.empty', { text: 'Ei kysymyssarjoja. Luo sarja kullekin luennon moduulille (esim. M1) ja lisää siihen kysymykset.' }));
      }
      sets.forEach(function (set, si) {
        var inSet = polls.filter(function (p) { return p.set_id === set.id; });
        var section = h('section.set-card' + (set.skipped ? '.skipped' : ''), null,
          h('div.set-head', null,
            h('span.code', { text: set.slug }),
            h('h3', { text: set.title }),
            set.skipped ? h('span.badge.closed', { text: 'Ohitettu' }) : null,
            h('span.hint', { text: inSet.length + ' kysymystä' }),
            h('span.spacer'),
            h('button.btn.ghost.small', { type: 'button', text: '↑', title: 'Siirrä sarja ylös', disabled: si === 0, onclick: function () { setAct(set, 'move', { dir: -1 }); } }),
            h('button.btn.ghost.small', { type: 'button', text: '↓', title: 'Siirrä sarja alas', disabled: si === sets.length - 1, onclick: function () { setAct(set, 'move', { dir: 1 }); } }),
            h('button.btn.ghost.small', { type: 'button', text: set.skipped ? 'Palauta' : 'Ohita',
              title: set.skipped ? 'Palauta sarja Seuraava/Edellinen-järjestykseen' : 'Jätä sarja pois Seuraava/Edellinen-järjestyksestä (vastaukset säilyvät)',
              onclick: function () { setAct(set, 'skip', { skipped: !set.skipped }); } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Muokkaa', onclick: function () { showSetForm(set); } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Vie', title: 'Lataa sarja JSON-tiedostona', onclick: function () { exportJson(set); } }),
            h('button.btn.ghost.small', { type: 'button', text: 'CSV', title: 'Sarjan tulokset taulukkona', onclick: function () { exportCsv(set); } }),
            h('button.btn.ghost.small', { type: 'button', text: 'Monista', title: 'Kopio sarjasta ja sen kysymyksistä ilman vastauksia', onclick: function () { setAct(set, 'duplicate'); } }),
            h('button.btn.small', { type: 'button', text: 'Uusi kysymys', onclick: function () { showForm(null, set); } }),
            h('button.btn.danger.small', { type: 'button', text: 'Poista', onclick: function () {
              setAct(set, 'delete', {}, 'Poistetaanko sarja ' + set.slug + ' "' + set.title + '", sen ' + inSet.length + ' kysymystä ja kaikki vastaukset pysyvästi?');
            } })));
        if (!inSet.length) section.appendChild(h('p.empty', { text: 'Ei kysymyksiä.' }));
        inSet.forEach(function (poll, i) { section.appendChild(pollCard(poll, i, inSet.length)); });
        setsEl.appendChild(section);
      });
      updateResults();
    }

    // ---------------------------------------------------------------- JSON-tuonti ja -vienti

    function exportJson(set) {
      api('GET', 'events/' + eventId + '/export' + (set ? '?set=' + set.id : '')).then(function (data) {
        var blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
        var a = h('a', { href: URL.createObjectURL(blob), download: 'hessutalks-' + getEvent().code + (set ? '-' + set.slug : '') + '.json' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }).catch(fail);
    }

    /** Näyttää tuonnin yhteenvedon (palvelin tarkistaa, ei kirjoita) ja tuo vasta vahvistuksesta. */
    function previewImport(text) {
      var report = function (r) {
        return [
          h('ul', null, (r.sets || []).map(function (s) {
            return h('li', null, h('span.code', { text: s.slug }), ' ', s.title + ' · ' + s.questions + ' kysymystä');
          })),
          (r.warnings || []).length ? h('div', null, h('p', { text: 'Ohitetaan:' }),
            h('ul.hint', null, r.warnings.map(function (w) { return h('li', { text: w }); }))) : null,
          (r.errors || []).length ? h('div', null, h('p', null, h('strong', { text: 'Virheet (mitään ei tuoda):' })),
            h('ul', null, r.errors.map(function (e) { return h('li', { text: e }); }))) : null
        ];
      };
      var send = function (dry) {
        return fetch(API + 'events/' + eventId + '/import', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
          body: JSON.stringify({ json: text, dry_run: dry })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.status === 401) throw new Error('Istunto on päättynyt. Kirjaudu uudelleen.');
            return { ok: res.ok, data: data };
          });
        });
      };
      outEl.replaceChildren(notice('Tarkistetaan tiedostoa…'));
      send(true).then(function (r) {
        var d = r.data;
        if (!r.ok && !d.errors) { outEl.replaceChildren(notice(d.error || 'Tarkistus epäonnistui.', 'error')); return; }
        var box = h('div.poll-form.import-preview', null,
          h('h3', { text: r.ok ? 'Tuodaan ' + d.sets.length + ' sarjaa ja ' + d.questions + ' kysymystä' : 'Tiedostoa ei voi tuoda' }),
          report(d),
          h('p.actions', null,
            r.ok ? h('button.btn.small', { type: 'button', text: 'Tuo', onclick: function () {
              send(false).then(function (res) {
                if (!res.ok) { outEl.replaceChildren(notice(res.data.error || 'Tuonti epäonnistui.', 'error')); return; }
                applyState(res.data);
                outEl.replaceChildren(notice('Tuotu ' + res.data.import.sets.length + ' sarjaa ja ' + res.data.import.questions + ' kysymystä.'
                  + (res.data.import.warnings.length ? ' Ohitettiin ' + res.data.import.warnings.length + ' kysymystä.' : ''), 'ok'));
              }).catch(fail);
            } }) : null, ' ',
            h('button.btn.ghost.small', { type: 'button', text: r.ok ? 'Peruuta' : 'Sulje', onclick: function () { outEl.replaceChildren(); } })));
        outEl.replaceChildren(box);
        box.scrollIntoView({ block: 'nearest' });
      }).catch(fail);
    }

    // ---------------------------------------------------------------- lomakkeet

    function showSetForm(set) {
      var editing = !!set;
      var slug = h('input', { type: 'text', id: 'set-slug', maxlength: 16, required: true, value: editing ? set.slug : '', placeholder: 'esim. M1', autocapitalize: 'characters' });
      var title = h('input', { type: 'text', id: 'set-title', maxlength: 120, required: true, value: editing ? set.title : '', placeholder: 'esim. M1 Cyber and society' });
      var out = h('div');
      formEl.replaceChildren(h('form.poll-form', { onsubmit: function (ev) {
        ev.preventDefault();
        var body = { slug: slug.value, title: title.value };
        (editing ? api('POST', 'sets/' + set.id + '/update', body) : api('POST', 'events/' + eventId + '/sets', body))
          .then(function (r) { formEl.replaceChildren(); applyState(r); })
          .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
      } },
        h('h3', { text: editing ? 'Muokkaa sarjaa' : 'Uusi kysymyssarja' }),
        h('label', { for: 'set-slug', text: 'Tunniste (1–16 merkkiä, A–Z, 0–9, - tai _)' }), slug,
        h('label', { for: 'set-title', text: 'Nimi' }), title,
        h('p.actions', null, h('button.btn.small', { type: 'submit', text: editing ? 'Tallenna' : 'Luo sarja' }), ' ',
          h('button.btn.ghost.small', { type: 'button', text: 'Peruuta', onclick: function () { formEl.replaceChildren(); } })),
        out));
      formEl.scrollIntoView({ block: 'nearest' });
      slug.focus();
    }

    function showForm(poll, set) {
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
          inputs.correct = h('input', { type: 'text', id: 'poll-correct', placeholder: t === 'single' ? 'esim. 2' : 'esim. 1, 3',
            value: Array.isArray(cfg.correct) ? cfg.correct.map(function (i) { return i + 1; }).join(', ') : '' });
          inputs.explanations = h('textarea', { id: 'poll-explanations', rows: 4, placeholder: 'Valinnainen: selitys kullekin vaihtoehdolle omalle rivilleen' });
          inputs.explanations.value = (cfg.explanations || []).join('\n');
          fields.append(h('label', { for: 'poll-options', text: 'Vaihtoehdot' }), inputs.options,
            h('label', { for: 'poll-correct', text: 'Oikeat vastaukset (vaihtoehtojen numerot, tyhjä = ei oikeaa vastausta)' }), inputs.correct,
            h('label', { for: 'poll-explanations', text: 'Selitykset (näytetään paljastuksessa)' }), inputs.explanations);
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
        } else if (t === 'open') {
          inputs.multiple = h('input', { type: 'checkbox', id: 'poll-multiple', checked: !!cfg.multiple });
          inputs.openMax = h('input', { type: 'number', id: 'poll-open-max', min: HessuResults.OPEN_MAX, max: HessuResults.OPEN_LIMIT, step: 10, value: HessuResults.openMax({ config: cfg }) });
          fields.append(h('label.check', null, inputs.multiple, ' Salli useita vastauksia samalta osallistujalta'),
            h('label', { for: 'poll-open-max', text: 'Enimmäispituus (merkkiä)' }), inputs.openMax,
            h('p.hint', { text: 'Oletus 280 merkkiä. Pohdintatehtäviin enintään ' + HessuResults.OPEN_LIMIT + ' (noin 500 sanaa); osallistuja näkee laskurin. Projektori näyttää pitkistä vastauksista ' + HessuResults.OPEN_CLIP + ' ensimmäistä merkkiä, hallinta ja CSV koko tekstin. Vastaukset näkyvät listana uusin ensin. Kirosanasuodatin piilottaa osumat tarkistettavaksi, ja voit piilottaa minkä tahansa vastauksen.' }));
        } else {
          fields.append(h('p.hint', { text: 'Kuulijat vastaavat 1–3 sanalla. Samat vastaukset kasvattavat sanaa pilvessä. Voit piilottaa sopimattoman sanan klikkaamalla sitä tuloksissa.' }));
        }
      }

      function config() {
        var t = type.value;
        if (t === 'single' || t === 'multi') {
          var options = inputs.options.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          var out = { options: options };
          var nums = inputs.correct.value.split(/[\s,;]+/).filter(Boolean);
          if (nums.length) {
            out.correct = nums.map(function (n) { return /^\d+$/.test(n) ? parseInt(n, 10) - 1 : -1; });
          }
          var expl = inputs.explanations.value.split('\n').map(function (x) { return x.trim(); });
          while (expl.length && expl[expl.length - 1] === '') expl.pop();
          if (expl.length) {
            while (expl.length < options.length) expl.push('');
            out.explanations = expl;
          }
          return out;
        }
        if (t === 'likert') return { points: parseInt(inputs.points.value, 10), min_label: inputs.min.value, max_label: inputs.max.value };
        if (t === 'scale') return { min_label: inputs.min.value, max_label: inputs.max.value };
        if (t === 'open') return { multiple: inputs.multiple.checked, max: parseInt(inputs.openMax.value, 10) || HessuResults.OPEN_MAX };
        return {};
      }

      type.addEventListener('change', renderFields);
      renderFields();
      var out = h('div');
      formEl.replaceChildren(h('form.poll-form', { onsubmit: function (ev) {
        ev.preventDefault();
        var req = editing
          ? api('POST', 'polls/' + poll.id + '/update', { prompt: prompt.value, config: config() })
          : api('POST', 'events/' + eventId + '/polls', { set_id: set.id, type: type.value, prompt: prompt.value, config: config() });
        req.then(function () { formEl.replaceChildren(); return load(); })
          .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
      } },
        h('h3', { text: (editing ? 'Muokkaa kysymystä' : 'Uusi kysymys') + (set ? ' · ' + set.slug : '') }),
        h('label', { for: 'poll-type', text: 'Kysymystyyppi' }), type,
        h('label', { for: 'poll-prompt', text: 'Kysymys' }), prompt,
        fields,
        h('p.actions', null, h('button.btn.small', { type: 'submit', text: editing ? 'Tallenna' : 'Luo kysymys' }), ' ',
          h('button.btn.ghost.small', { type: 'button', text: 'Peruuta', onclick: function () { formEl.replaceChildren(); } })),
        out));
      formEl.scrollIntoView({ block: 'nearest' });
      prompt.focus();
    }

    return { el: el, control: controlEl, load: load, refresh: refreshAnswers, command: command };
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
        toolbar(event.title, [
          h('button.btn.ghost.small', { type: 'button', text: 'Ohjain', title: 'Puhelinohjain: isot napit aktiivisen kysymyksen ohjaukseen', onclick: function () { showRemote(id); } }),
          h('button.btn.ghost.small', { type: 'button', text: 'Kaikki luennot', onclick: function () { loadState().then(function () { showEvents(); }); } })]),
        h('div.share', null,
          h('img', { src: qrDataUrl(url, 4), alt: 'QR-koodi luennon kysymyssivulle' }),
          h('div', null,
            h('p.big-code', { text: event.code }),
            h('p.url', null, h('a', { href: url, target: '_blank', rel: 'noopener', text: url })),
            h('p.actions', null,
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
            h('p.row-inline', null, h('label', { for: 'event-lang', text: 'Osallistujien kieli ' }), (function () {
              var sel = langSelect('event-lang', event.lang);
              sel.addEventListener('change', function () {
                api('POST', 'events/' + id + '/lang', { lang: sel.value || null }).then(function (r) { event = r.event; setScreenLang(event.lang); renderHead(); });
              });
              return sel;
            })()),
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
        type: 'list', title: event.title + ' · ' + (kind === 'feedback' ? (screenLang === 'en' ? 'Feedback' : 'Palautteet') : (screenLang === 'en' ? 'Questions' : 'Kysymykset')),
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

    // Välilehdet: kurssissa voi olla useita luentoja ja kymmeniä kysymyksiä, jolloin viestit hautautuivat
    // sarjojen alle (Hessun USTP-kurssi 29.10.). Ohjauspalkki pysyy välilehtien yläpuolella, ja
    // viestivälilehti näyttää uusien viestien määrän. Nuolinäppäimet jäävät pikanäppäimille.
    var messagesEl = h('section.messages-admin', { id: 'tab-messages', role: 'tabpanel', 'aria-labelledby': 'tab-btn-messages' },
      h('h2', { text: 'Kysymykset ja palaute' }), filtersEl, listEl);
    panel.el.id = 'tab-polls';
    panel.el.setAttribute('role', 'tabpanel');
    panel.el.setAttribute('aria-labelledby', 'tab-btn-polls');
    var tabEls = { polls: panel.el, messages: messagesEl };
    var tabButtons = {};
    ['polls', 'messages'].forEach(function (key) {
      tabButtons[key] = h('button.tab', { type: 'button', role: 'tab', id: 'tab-btn-' + key, 'aria-controls': tabEls[key].id,
        onclick: function () { selectTab(key); } });
    });
    var tabsEl = h('div.tabs', { role: 'tablist', 'aria-label': 'Luennon näkymät' }, tabButtons.polls, tabButtons.messages);

    function selectTab(key) {
      eventTab = key;
      Object.keys(tabEls).forEach(function (k) {
        tabButtons[k].setAttribute('aria-selected', String(k === key));
        tabEls[k].hidden = k !== key;
      });
    }
    function renderTabs() {
      var fresh = items.filter(function (it) { return it.status === 'new'; }).length;
      tabButtons.polls.textContent = 'Kyselyt';
      tabButtons.messages.replaceChildren();
      append(tabButtons.messages, ['Kysymykset ja palaute', fresh ? h('span.badge', { text: fresh + ' uutta' }) : null]);
    }

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
      renderTabs();
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
      var known = lastId;   // tilaluettelo kertoo vain tätä vanhemmista viesteistä
      return api('GET', 'events/' + id + '/questions?after=' + known).then(function (r) {
        var first = event === null;
        event = r.event;
        setScreenLang(event.lang);
        r.questions.forEach(function (q) {
          // Päällekkäiset haut (ajastin ja esitysikkunan tahdistus) voivat palauttaa saman viestin.
          if (q.id <= lastId) return;
          items.push({ id: q.id, status: q.status, created_at: q.created_at, nickname_id: q.nickname_id, msg: decrypt(q.ciphertext) });
          if (q.id > lastId) lastId = q.id;
        });
        var statuses = r.statuses || {};
        // Poistettu viesti puuttuu tilaluettelosta. Hitaasti palannut haku ei kuitenkaan tiedä viesteistä,
        // jotka tulivat sen jälkeen: niitä ei saa pudottaa (Hessun koeajo 28.10.: viestejä katosi).
        items = items.filter(function (it) { return it.id > known || statuses[it.id] !== undefined; });
        items.forEach(function (it) { if (statuses[it.id] !== undefined) it.status = statuses[it.id]; });
        if (first) renderHead();
        renderList();
      });
    }

    // Päivitys: kysymykset ja kyselyvastaukset. Ajastin toimii, kun välilehti on näkyvissä;
    // taustalla esitysikkunan tick-viesti kutsuu samaa funktiota (ks. esitysnäyttö).
    function refreshAll() {
      return poll().then(function () { return panel.refresh(); });
    }

    mount(headEl, panel.control, tabsEl, panel.el, messagesEl);
    filtersEl.replaceChildren.apply(filtersEl, filterButtons());
    renderTabs();
    selectTab(eventTab);
    poll().then(function () { return panel.load(); }).then(function () { return panel.refresh(); }).then(function () {
      // Yksi päivitys kerrallaan: hidas vastaus ei kasaa pyyntöjä jonoon.
      var busy = false;
      liveRefresh = function () {
        if (busy) return;
        busy = true;
        refreshAll().catch(function () {}).then(function () { busy = false; });
      };
      liveCommand = panel.command;
      pollTimer = setInterval(function () {
        if (document.hidden) return;
        liveRefresh();
      }, POLL_MS);
    }).catch(function (e) { if (e.message !== '401') root.appendChild(notice(e.message, 'error')); });
  }

  // ================================================================ näkymä: puhelinohjain
  //
  // Ohjaa aktiivista kysymystä kävellessä salissa. Ei pura viestejä eikä vastauksia, joten se toimii
  // myös avaamatta salausavainta. Projektoria ohjaava läppäri huomaa muutokset ohjaustilan versiosta.

  function showRemote(eventId) {
    var data = null;
    var out = h('div');
    var body = h('div.remote');
    function find(pid) { return (data.polls || []).filter(function (p) { return p.id === pid; })[0] || null; }
    function load() { return api('GET', 'events/' + eventId + '/polls').then(function (r) { data = r; render(); }); }
    function post(path, b) {
      return api('POST', path, b).then(function (r) { out.replaceChildren(); if (r && r.polls) { data = r; render(); } else return load(); })
        .catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
    }
    function big(text, onclick, primary) { return h('button.btn.remote-btn' + (primary ? '' : '.ghost'), { type: 'button', text: text, onclick: onclick }); }
    function render() {
      var poll = find(data.active);
      var order = data.polls.filter(function (p) { return !p.skipped || p.id === data.active; });
      var set = poll ? (data.sets || []).filter(function (s) { return s.id === poll.set_id; })[0] : null;
      body.replaceChildren();
      append(body, [
        h('div.remote-now', null,
          h('p.eyebrow', { text: poll ? 'Aktiivinen ' + (order.indexOf(poll) + 1) + '/' + order.length + (set ? ' · ' + set.slug : '') : 'Ei aktiivista kysymystä' }),
          h('p.remote-prompt', { text: poll ? poll.prompt : 'Osallistujat näkevät odotusnäkymän.' }),
          poll ? h('p.hint', { text: (POLL_STATUS_LABEL[poll.status] || poll.status) + ' · ' + poll.answer_count + ' vastausta'
            + (poll.results_visible ? ' · tulokset näkyvissä' : '') + (poll.revealed ? ' · paljastettu' : '') }) : null),
        h('div.remote-grid', null,
          big('← Edellinen', function () { post('events/' + eventId + '/live', { action: 'prev' }); }),
          big('Seuraava →', function () { post('events/' + eventId + '/live', { action: 'next' }); }, true),
          poll ? big(poll.status === 'open' ? 'Sulje vastaukset' : 'Avaa vastauksille', function () {
            post('polls/' + poll.id + '/status', { status: poll.status === 'open' ? 'closed' : 'open' });
          }, true) : null,
          poll ? big(poll.results_visible ? 'Piilota tulokset' : 'Näytä tulokset', function () {
            post('polls/' + poll.id + '/results', { visible: !poll.results_visible });
          }) : null,
          poll && Array.isArray(poll.config.correct) ? big(poll.revealed ? 'Piilota oikea vastaus' : 'Paljasta oikea vastaus', function () {
            post('polls/' + poll.id + '/reveal', { revealed: !poll.revealed });
          }) : null,
          big(data.show_qr ? 'QR pieneksi' : 'QR isona', function () { post('events/' + eventId + '/qr', { show: !data.show_qr }); }),
          poll ? big('Odotusnäkymä', function () { post('events/' + eventId + '/live', { action: 'activate', poll: null }); }) : null)
      ]);
    }
    mount(h('div.toolbar', null, h('h1', { text: 'Ohjain' }), h('span.spacer'),
      h('button.btn.ghost.small', { type: 'button', text: secretKey ? 'Luennon näkymä' : 'Takaisin', onclick: function () {
        if (secretKey) showEvent(eventId); else start();
      } })), out, body);
    load().catch(function (e) { if (e.message !== '401') out.replaceChildren(notice(e.message, 'error')); });
    pollTimer = setInterval(function () { if (!document.hidden) load().catch(function () {}); }, 2000);
  }

  function showRemotePicker() {
    mount(h('div.toolbar', null, h('h1', { text: 'Ohjain' }), h('span.spacer'),
      h('button.btn.ghost.small', { type: 'button', text: 'Takaisin', onclick: function () { start(); } })),
      h('p', { text: 'Valitse luento. Ohjain ei avaa viestejä, joten salausavainta ei tarvita.' }),
      h('ul.event-list', null, state.events.map(function (ev) {
        return h('li', null, h('span.code', { text: ev.code }), h('strong', { text: ev.title }),
          h('button.btn.small.open-btn', { type: 'button', text: 'Ohjaa', onclick: function () { showRemote(ev.id); } }));
      })));
  }

  function stopPolling() {
    liveRefresh = null;
    liveCommand = null;
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
