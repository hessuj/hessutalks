/*
 * HessuTalks – osallistujan kyselyt (monivalinta, sanapilvi, Likert, asteikko).
 *
 * Ei henkilötietoja: vastataan ilman nimimerkkiä. Selain luo satunnaisen vastaajatunnisteen
 * (localStorage), jolla saman selaimen uusi vastaus korvaa aiemman. Palvelin tallentaa siitä
 * vain kyselykohtaisen tiivisteen.
 *
 * Vastaus salataan selaimessa luennoitsijan julkisella avaimella (crypto_box_seal), joten
 * palvelin ei näe sitä. Tulokset lasketaan luennoitsijan selaimessa.
 * Teksti lisätään DOMiin vain textContentilla.
 */
(function () {
  'use strict';

  var ask = document.getElementById('ask');
  var box = document.getElementById('polls');
  if (!ask || !box) return;

  var POLL_MS = 4000;
  var VOTER_KEY = 'hessutalks.voter';
  var ANSWERS_KEY = 'hessutalks.answers';
  var WORDS_MAX_CHARS = 40;
  var WORDS_MAX_WORDS = 3;

  var code = ask.dataset.code;
  var lang = ask.dataset.lang || 'fi';
  var STRINGS = {};
  try { STRINGS = JSON.parse(ask.dataset.i18n || '{}'); } catch (e) { STRINGS = {}; }
  function t(key, params) {
    var text = typeof STRINGS[key] === 'string' ? STRINGS[key] : key;
    Object.keys(params || {}).forEach(function (k) { text = text.split('{' + k + '}').join(String(params[k])); });
    return text;
  }

  var focusId = parseInt(new URLSearchParams(window.location.search).get('p') || '', 10) || null;
  var version = null;
  var cards = {};          // pollId -> { sig, el }
  var sodium = null;
  var publicKey = null;
  var timer = null;
  var memory = {};         // jos localStorage ei ole käytettävissä

  // ---------------------------------------------------------------- tallennus

  function load(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch (e) { return memory[key] || null; }
  }
  function save(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* vain muistissa */ }
  }

  function voterId() {
    var v = load(VOTER_KEY);
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)) return v;
    v = sodium.to_base64(sodium.randombytes_buf(32), sodium.base64_variants.URLSAFE_NO_PADDING);
    save(VOTER_KEY, v);
    return v;
  }

  // Oma vastaus muistetaan vain tässä selaimessa, jotta se näytetään valittuna.
  function answerKey(poll) { return code + ':' + poll.id + ':' + poll.generation; }
  function ownAnswer(poll) {
    var all = load(ANSWERS_KEY);
    return all && typeof all === 'object' && all[answerKey(poll)] !== undefined ? all[answerKey(poll)] : null;
  }
  function saveOwnAnswer(poll, answer) {
    var all = load(ANSWERS_KEY);
    if (!all || typeof all !== 'object') all = {};
    // Siivotaan muiden luentojen vanhat vastaukset, ettei tallennus kasva rajatta.
    Object.keys(all).forEach(function (k) { if (k.split(':')[0] !== code) delete all[k]; });
    all[answerKey(poll)] = answer;
    save(ANSWERS_KEY, all);
  }

  // ---------------------------------------------------------------- DOM-apurit

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }
  function choice(type, name, value, label, checked) {
    var input = h('input');
    input.type = type;
    input.name = name;
    input.value = String(value);
    input.checked = !!checked;
    var l = h('label', 'poll-choice');
    l.appendChild(input);
    l.appendChild(h('span', null, label));
    return l;
  }

  // ---------------------------------------------------------------- kyselykortit

  function buildCard(poll) {
    var cfg = poll.config || {};
    var own = ownAnswer(poll);
    var name = 'poll-' + poll.id;
    var form = h('form', 'poll');
    form.noValidate = true;
    form.id = 'kysely-' + poll.id;
    form.appendChild(h('p', 'eyebrow', t('poll_heading')));
    form.appendChild(h('h2', 'poll-prompt', poll.prompt));
    var body = h('div', 'poll-body');
    var getAnswer;

    if (poll.type === 'single' || poll.type === 'multi') {
      var multi = poll.type === 'multi';
      if (multi) body.appendChild(h('p', 'hint', t('poll_multi_hint')));
      var list = h('div', 'poll-choices');
      (cfg.options || []).forEach(function (opt, i) {
        var checked = multi ? Array.isArray(own) && own.indexOf(i) !== -1 : own === i;
        list.appendChild(choice(multi ? 'checkbox' : 'radio', name, i, opt, checked));
      });
      body.appendChild(list);
      getAnswer = function () {
        var picked = Array.prototype.filter.call(form.querySelectorAll('input[name="' + name + '"]'), function (i) { return i.checked; })
          .map(function (i) { return parseInt(i.value, 10); });
        if (!picked.length) throw new Error(t(multi ? 'poll_choose_many' : 'poll_choose_one'));
        return multi ? picked : picked[0];
      };
    } else if (poll.type === 'likert' || poll.type === 'scale') {
      var from = poll.type === 'scale' ? 0 : 1;
      var to = poll.type === 'scale' ? 10 : (cfg.points === 7 ? 7 : 5);
      var row = h('div', 'poll-scale ' + (poll.type === 'scale' ? 'wide' : 'p' + (to - from + 1)));
      for (var v = from; v <= to; v++) row.appendChild(choice('radio', name, v, String(v), own === v));
      body.appendChild(row);
      if (cfg.min_label || cfg.max_label) {
        var ends = h('div', 'poll-ends');
        ends.appendChild(h('span', null, from + ' = ' + (cfg.min_label || '')));
        ends.appendChild(h('span', null, to + ' = ' + (cfg.max_label || '')));
        body.appendChild(ends);
      }
      getAnswer = function () {
        var sel = form.querySelector('input[name="' + name + '"]:checked');
        if (!sel) throw new Error(t('poll_choose_one'));
        return parseInt(sel.value, 10);
      };
    } else { // words
      var input = h('input');
      input.type = 'text';
      input.maxLength = WORDS_MAX_CHARS;
      input.autocomplete = 'off';
      input.placeholder = t('poll_words_placeholder');
      input.setAttribute('aria-label', poll.prompt);
      if (typeof own === 'string') input.value = own;
      body.appendChild(input);
      body.appendChild(h('p', 'hint', t('poll_words_hint')));
      getAnswer = function () {
        var text = input.value.replace(/\s+/g, ' ').trim();
        if (!text) throw new Error(t('poll_words_empty'));
        if (text.length > WORDS_MAX_CHARS || text.split(' ').length > WORDS_MAX_WORDS) throw new Error(t('poll_words_long'));
        return text;
      };
    }

    form.appendChild(body);
    var btn = h('button', 'btn', t(own !== null ? 'poll_change' : 'poll_submit'));
    btn.type = 'submit';
    var status = h('p', own !== null ? 'notice ok' : 'hint', own !== null ? t('poll_saved') : t('poll_anonymous'));
    status.setAttribute('role', 'status');
    form.appendChild(btn);
    form.appendChild(status);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var answer;
      try { answer = getAnswer(); } catch (e) { status.className = 'notice error'; status.textContent = e.message; return; }
      btn.disabled = true;
      status.className = 'notice';
      status.textContent = t('sending');
      send(poll, answer).then(function () {
        saveOwnAnswer(poll, answer);
        status.className = 'notice ok';
        status.textContent = t('poll_saved');
        btn.textContent = t('poll_change');
      }).catch(function (e) {
        status.className = 'notice error';
        status.textContent = e.message;
      }).then(function () { btn.disabled = false; });
    });
    return form;
  }

  function send(poll, answer) {
    var payload = JSON.stringify({ v: 1, e: code, p: poll.id, a: answer, ts: new Date().toISOString() });
    var ciphertext = sodium.to_base64(
      sodium.crypto_box_seal(sodium.from_string(payload), publicKey),
      sodium.base64_variants.ORIGINAL
    );
    return fetch(box.dataset.answerEndpoint, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: lang, code: code, token: ask.dataset.token, poll: poll.id, voter: voterId(), ciphertext: ciphertext })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || t('poll_failed', { status: res.status }));
      });
    });
  }

  // ---------------------------------------------------------------- päivitys

  function render(polls) {
    var seen = {};
    polls.forEach(function (poll) {
      var sig = JSON.stringify([poll.type, poll.prompt, poll.config, poll.generation]);
      seen[poll.id] = true;
      var card = cards[poll.id];
      if (card && card.sig === sig) return;   // ei muutosta: säilytetään keskeneräinen vastaus
      var el = buildCard(poll);
      if (card) card.el.replaceWith(el); else box.appendChild(el);
      cards[poll.id] = { sig: sig, el: el };
    });
    Object.keys(cards).forEach(function (id) {
      if (!seen[id]) { cards[id].el.remove(); delete cards[id]; }
    });
    // Järjestys: kalvon QR-koodilla avattu kysely ensin, muuten luontijärjestys.
    polls.slice().sort(function (a, b) { return (b.id === focusId) - (a.id === focusId) || a.id - b.id; })
      .forEach(function (poll) { box.appendChild(cards[poll.id].el); });

    var notOpen = focusId && !seen[focusId];
    var note = box.querySelector('.poll-wait');
    if (notOpen && !note) {
      note = h('p', 'notice poll-wait', t('poll_not_open'));
      box.insertBefore(note, box.firstChild);
    } else if (!notOpen && note) {
      note.remove();
    }
    box.hidden = !polls.length && !notOpen;
  }

  function refresh() {
    var url = box.dataset.endpoint + '?code=' + encodeURIComponent(code) + '&lang=' + encodeURIComponent(lang) +
      (version ? '&v=' + encodeURIComponent(version) : '');
    return fetch(url, { credentials: 'omit' }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 410) { render([]); stop(); return; }
        if (!res.ok || data.unchanged) return;
        version = typeof data.v === 'string' ? data.v : null;
        render(Array.isArray(data.polls) ? data.polls : []);
      });
    }).catch(function () { /* verkkokatko: yritetään seuraavalla kierroksella */ });
  }

  function start() {
    if (timer) return;
    timer = setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  var s = window.sodium;
  (s && s.ready ? s.ready.then(function () { return s; }) : Promise.reject(new Error('sodium')))
    .then(function (lib) {
      sodium = lib;
      publicKey = sodium.from_base64(ask.dataset.pk, sodium.base64_variants.ORIGINAL);
      if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('key');
      return refresh();
    })
    .then(function () {
      start();
      if (focusId && cards[focusId]) cards[focusId].el.scrollIntoView({ block: 'start' });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    })
    .catch(function () { /* participant.js näyttää salausvirheen */ });
})();
