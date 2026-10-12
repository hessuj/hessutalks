/*
 * HessuTalks – osallistujan lomake.
 *
 * Ei henkilötietoja: viesti lähetetään pakollisella, luennolla uniikilla nimimerkillä.
 * Viesti ja nimimerkki salataan selaimessa luennoitsijan julkisella avaimella
 * (libsodium crypto_box_seal), joten palvelin näkee vain salatun datan.
 *
 * Selain muistaa (localStorage):
 *   - viimeksi käytetyn nimimerkin, jotta sitä ehdotetaan seuraavalla luennolla
 *   - luentokohtaisen omistajatunnisteen, jolla vain tämä selain voi käyttää varattua nimimerkkiä
 */
(function () {
  'use strict';

  var STORE_KEY = 'hessutalks.v1';
  var CLAIM_TTL_MS = 60 * 24 * 3600 * 1000;

  var root = document.getElementById('ask');
  if (!root) return;

  var code = root.dataset.code;
  var form = document.getElementById('ask-form');
  var statusBox = document.getElementById('status');
  var text = document.getElementById('text');
  var count = document.getElementById('count');
  var sendBtn = document.getElementById('send');
  var nickInput = document.getElementById('nickname');
  var nickPick = document.getElementById('nick-pick');
  var nickOwned = document.getElementById('nick-owned');
  var nickLabel = document.getElementById('nick-label');
  var nickChange = document.getElementById('nick-change');
  var NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,23}$/u;

  // ---------------------------------------------------------------- tallennus

  var memoryStore = null; // käytetään, jos localStorage ei ole käytettävissä (esim. yksityinen selaus)

  function loadStore() {
    var data = null;
    try {
      data = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
    } catch (e) {
      data = memoryStore;
    }
    if (!data || typeof data !== 'object') data = {};
    if (!data.claims || typeof data.claims !== 'object') data.claims = {};
    var now = Date.now();
    Object.keys(data.claims).forEach(function (k) {
      var c = data.claims[k];
      if (!c || typeof c.nick !== 'string' || typeof c.secret !== 'string' || now - (c.at || 0) > CLAIM_TTL_MS) {
        delete data.claims[k];
      }
    });
    return data;
  }

  function saveStore(data) {
    memoryStore = data;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  var store = loadStore();

  function currentClaim() {
    return store.claims[code] || null;
  }

  function renderNick() {
    var claim = currentClaim();
    if (claim) {
      nickPick.hidden = true;
      nickOwned.hidden = false;
      nickLabel.textContent = claim.nick;
    } else {
      nickPick.hidden = false;
      nickOwned.hidden = true;
      if (!nickInput.value && typeof store.lastNick === 'string') nickInput.value = store.lastNick;
    }
  }

  // ---------------------------------------------------------------- apurit

  function show(msg, kind) {
    statusBox.hidden = false;
    statusBox.className = 'notice' + (kind ? ' ' + kind : '');
    statusBox.textContent = msg;
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function sodiumReady() {
    var s = window.sodium;
    if (!s) return Promise.reject(new Error('Salauskirjasto puuttuu.'));
    return s.ready ? s.ready.then(function () { return s; }) : Promise.resolve(s);
  }

  /** Varaa nimimerkin, ellei tälle luennolle ole jo varausta. */
  function ensureClaim() {
    var existing = currentClaim();
    if (existing) return Promise.resolve(existing);

    var nick = nickInput.value.replace(/\s+/g, ' ').trim();
    if (!NICK_RE.test(nick)) {
      nickInput.focus();
      return Promise.reject(new Error('Nimimerkissä pitää olla 2–24 merkkiä: kirjaimia, numeroita, välilyöntejä tai merkkejä _ . -'));
    }
    return postJson(root.dataset.nickEndpoint, { code: code, token: root.dataset.token, nickname: nick })
      .then(function (r) {
        if (!r.ok) {
          if (r.status === 409) nickInput.focus();
          throw new Error(r.data.error || 'Nimimerkin varaus epäonnistui (' + r.status + ').');
        }
        var claim = { nick: r.data.nickname, secret: r.data.secret, at: Date.now() };
        store.claims[code] = claim;
        store.lastNick = claim.nick;
        if (!saveStore(store)) {
          show('Selaimesi ei salli tietojen tallennusta, joten nimimerkki muistetaan vain tämän sivun ajan.');
        }
        renderNick();
        return claim;
      });
  }

  // ---------------------------------------------------------------- tapahtumat

  text.addEventListener('input', function () {
    count.textContent = String(text.value.length);
  });

  nickChange.addEventListener('click', function () {
    if (!window.confirm('Vaihdetaanko nimimerkki? Nykyinen nimimerkki pysyy varattuna tällä luennolla, eikä sitä voi enää käyttää.')) return;
    delete store.claims[code];
    saveStore(store);
    nickInput.value = '';
    renderNick();
    nickInput.focus();
  });

  sodiumReady().then(function (sodium) {
    var publicKey = sodium.from_base64(root.dataset.pk, sodium.base64_variants.ORIGINAL);
    if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('Virheellinen avain.');
    renderNick();
    form.hidden = false;

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var body = text.value.trim();
      var kind = form.elements.kind.value === 'feedback' ? 'feedback' : 'question';

      if (body.length < 2) { show('Kirjoita viesti ennen lähettämistä.', 'error'); text.focus(); return; }
      if (body.length > 2000) { show('Viesti on liian pitkä. Enintään 2000 merkkiä.', 'error'); return; }

      sendBtn.disabled = true;
      show('Lähetetään…');

      ensureClaim().then(function (claim) {
        var payload = JSON.stringify({
          v: 2,
          e: code,          // sidotaan viesti luentoon (tarkistetaan purettaessa)
          n: claim.nick,
          k: kind,
          t: body,
          ts: new Date().toISOString()
        });
        var ciphertext = sodium.to_base64(
          sodium.crypto_box_seal(sodium.from_string(payload), publicKey),
          sodium.base64_variants.ORIGINAL
        );
        return postJson(root.dataset.endpoint, {
          code: code,
          token: root.dataset.token,
          nickname: claim.nick,
          secret: claim.secret,
          ciphertext: ciphertext
        });
      }).then(function (r) {
        if (!r.ok) {
          if (r.data.reason === 'nickname' && currentClaim()) {
            // Varaus ei kelpaa enää (esim. luento poistettu ja luotu uudelleen): valitaan uusi.
            delete store.claims[code];
            saveStore(store);
            renderNick();
          }
          throw new Error(r.data.error || 'Lähetys epäonnistui (' + r.status + ').');
        }
        text.value = '';
        count.textContent = '0';
        show(kind === 'feedback' ? 'Palaute lähetetty. Kiitos!' : 'Kysymys lähetetty. Kiitos!', 'ok');
      }).catch(function (err) {
        show(err.message, 'error');
      }).then(function () {
        sendBtn.disabled = false;
      });
    });
  }).catch(function (err) {
    show('Salausta ei voitu alustaa: ' + err.message, 'error');
  });
})();
