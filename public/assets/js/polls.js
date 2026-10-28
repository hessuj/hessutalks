/*
 * HessuTalks – osallistujan kyselyt (monivalinta, sanapilvi, Likert, asteikko).
 *
 * Näkyvissä on aina luennon aktiivinen kysymys tai odotusnäkymä. Selain kysyy tilaa noin sekunnin
 * välein (lyhyt pollaus HTTPS:n yli, ei WebSocketia: toimii kaikissa verkoissa). Yhteyskatkon jälkeen
 * yritetään uudelleen kasvavalla viiveellä, ja oma vastaus palautetaan selaimen muistista.
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

  var POLL_MS = 1200;        // vaatimus: näkymä vaihtuu alle 2 s:ssa
  var HIDDEN_MS = 4000;      // taustalla (esim. puhelimen näyttö lukittu) harvemmin
  var MAX_BACKOFF_MS = 8000;
  var REQUEST_TIMEOUT_MS = 5000; // roikkuva pyyntö (esim. heikko mobiiliverkko) katkaistaan ja yritetään uudelleen
  var VOTER_KEY = 'hessutalks.voter';
  var ANSWERS_KEY = 'hessutalks.answers';
  var WORDS_MAX_CHARS = 30;
  var OPEN_MAX = 280;
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

  var version = null;
  var current = null;      // { sig, el } näkyvissä oleva kysymys tai odotusnäkymä
  var sodium = null;
  var publicKey = null;
  var timer = null;
  var failures = 0;
  var stopped = false;
  var memory = {};         // jos localStorage ei ole käytettävissä
  var reconnect = h('p', 'notice poll-reconnect', null);
  reconnect.setAttribute('role', 'status');
  reconnect.hidden = true;

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
      form.choiceLabels = [];
      (cfg.options || []).forEach(function (opt, i) {
        var checked = multi ? Array.isArray(own) && own.indexOf(i) !== -1 : own === i;
        var label = choice(multi ? 'checkbox' : 'radio', name, i, opt, checked);
        form.choiceLabels.push(label);
        list.appendChild(label);
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
    } else if (poll.type === 'open') {
      var many = !!cfg.multiple;
      var area = h('textarea');
      area.rows = 4;
      area.maxLength = OPEN_MAX * 2;   // merkit lasketaan alla (emoji = 2 UTF-16-yksikköä)
      area.placeholder = t('poll_open_placeholder');
      area.setAttribute('aria-label', poll.prompt);
      if (!many && typeof own === 'string') area.value = own;
      var counter = h('p', 'counter', '');
      var count = function () { counter.textContent = Array.from(area.value).length + '/' + OPEN_MAX; };
      area.addEventListener('input', count);
      count();
      body.appendChild(area);
      body.appendChild(counter);
      body.appendChild(h('p', 'hint', t('poll_open_hint')));
      if (many && Array.isArray(own) && own.length) body.appendChild(h('p', 'hint', t('poll_sent_count', { n: own.length })));
      getAnswer = function () {
        var text = area.value.trim();
        if (!text) throw new Error(t('poll_open_empty'));
        if (Array.from(text).length > OPEN_MAX) throw new Error(t('poll_open_long'));
        return text;
      };
      if (many) {
        form.dataset.multiple = '1';
        form.resetAfterSend = function () { area.value = ''; count(); };
      }
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
    // Paljastus ja tuloskooste päivitetään erikseen (updateExtras), jotta keskeneräinen valinta säilyy.
    form.resultsBox = h('div', 'poll-results-box');
    form.resultsBox.hidden = true;
    form.resultsBox.appendChild(h('p', 'eyebrow', t('poll_results')));
    form.resultsEl = h('div');
    form.resultsBox.appendChild(form.resultsEl);
    form.appendChild(form.resultsBox);
    var manyOpen = poll.type === 'open' && !!cfg.multiple;
    var btn = h('button', 'btn', t(own !== null && !manyOpen ? 'poll_change' : 'poll_submit'));
    btn.type = 'submit';
    var status = h('p', own !== null && !manyOpen ? 'notice ok' : 'hint', own !== null && !manyOpen ? t('poll_saved') : t('poll_anonymous'));
    status.setAttribute('role', 'status');
    form.appendChild(btn);
    form.appendChild(status);

    // Suljettu kysely: vastaus näkyy, mutta sitä ei voi enää muuttaa.
    if (poll.status === 'closed') {
      form.classList.add('closed');
      Array.prototype.forEach.call(form.querySelectorAll('input, textarea'), function (i) { i.disabled = true; });
      btn.hidden = true;
      status.className = 'notice';
      status.textContent = t('poll_closed_state') + (own !== null ? ' ' + t('poll_your_answer') : '');
      return form;
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var answer;
      try { answer = getAnswer(); } catch (e) { status.className = 'notice error'; status.textContent = e.message; return; }
      btn.disabled = true;
      status.className = 'notice';
      status.textContent = t('sending');
      send(poll, answer).then(function () {
        status.className = 'notice ok';
        if (form.resetAfterSend) {
          // Useita vastauksia: kenttä tyhjenee seuraavaa vastausta varten.
          var sent = ownAnswer(poll);
          saveOwnAnswer(poll, (Array.isArray(sent) ? sent : []).concat([answer]).slice(-50));
          form.resetAfterSend();
          status.textContent = t('poll_saved_more') + ' ' + t('poll_sent_count', { n: ownAnswer(poll).length });
          return;
        }
        saveOwnAnswer(poll, answer);
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

  function waitingView() {
    var el = h('div', 'poll-waiting');
    el.appendChild(h('span', 'poll-waiting-dot', ''));
    el.appendChild(h('p', null, t('poll_waiting')));
    return el;
  }

  /** Oikean vastauksen paljastus ja tuloskooste (kun luennoitsija näyttää ne). */
  function updateExtras(form, poll) {
    var reveal = poll.reveal && Array.isArray(poll.reveal.correct) ? poll.reveal : null;
    (form.choiceLabels || []).forEach(function (label, i) {
      var correct = !!reveal && reveal.correct.indexOf(i) !== -1;
      label.classList.toggle('correct', correct);
      label.classList.toggle('wrong', !!reveal && !correct);
      var old = label.querySelector('.poll-explanation');
      if (old) old.remove();
      var expl = reveal && Array.isArray(reveal.explanations) ? reveal.explanations[i] : '';
      if (typeof expl === 'string' && expl) label.appendChild(h('span', 'poll-explanation', expl));
    });
    var res = poll.results && typeof poll.results === 'object' && Array.isArray(poll.results.counts) ? poll.results : null;
    form.resultsBox.hidden = !res || !window.HessuResults;
    if (res && window.HessuResults) {
      window.HessuResults.render(form.resultsEl, poll, res, {
        reveal: reveal, labels: { mean: t('poll_mean'), median: t('poll_median') }
      });
    }
  }

  /** Näyttää aktiivisen kysymyksen tai odotusnäkymän. Keskeneräinen vastaus säilyy, jos mikään ei muuttunut. */
  function render(poll) {
    var sig = poll ? JSON.stringify([poll.id, poll.type, poll.prompt, poll.config, poll.generation, poll.status]) : 'waiting';
    if (!current || current.sig !== sig) {
      var el = poll ? buildCard(poll) : waitingView();
      if (current) current.el.replaceWith(el); else box.appendChild(el);
      current = { sig: sig, el: el };
    }
    if (poll && current.el.resultsBox) updateExtras(current.el, poll);
    box.hidden = false;
  }

  function schedule(ms) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  function refresh() {
    clearTimeout(timer);
    if (stopped) return;
    if (document.hidden) { schedule(HIDDEN_MS); return; }
    var url = box.dataset.endpoint + '?code=' + encodeURIComponent(code) + '&lang=' + encodeURIComponent(lang) +
      (version !== null ? '&v=' + encodeURIComponent(version) : '');
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var abort = ctrl ? setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS) : null;
    fetch(url, { credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
      clearTimeout(abort);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 410) {
          stopped = true;
          render(null);
          current.el.replaceChildren(h('p', 'notice', data.error || ''));
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        failures = 0;
        reconnect.hidden = true;
        if (!data.unchanged) {
          version = typeof data.v === 'number' ? data.v : null;
          render(data.poll && typeof data.poll === 'object' ? data.poll : null);
        }
        schedule(POLL_MS);
      });
    }).catch(function () {
      clearTimeout(abort);
      // Verkkokatko, aikakatkaisu tai palvelinvirhe: yritetään uudelleen kasvavalla viiveellä.
      failures++;
      if (failures >= 2) { reconnect.textContent = t('reconnecting'); reconnect.hidden = false; }
      schedule(Math.min(POLL_MS * Math.pow(2, failures - 1), MAX_BACKOFF_MS));
    });
  }

  var s = window.sodium;
  (s && s.ready ? s.ready.then(function () { return s; }) : Promise.reject(new Error('sodium')))
    .then(function (lib) {
      sodium = lib;
      publicKey = sodium.from_base64(ask.dataset.pk, sodium.base64_variants.ORIGINAL);
      if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) throw new Error('key');
      box.parentNode.insertBefore(reconnect, box);
      render(null);
      refresh();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { failures = 0; refresh(); } });
      window.addEventListener('online', function () { failures = 0; refresh(); });
      window.addEventListener('pageshow', function (ev) { if (ev.persisted) { failures = 0; refresh(); } });
    })
    .catch(function () { /* participant.js näyttää salausvirheen */ });
})();
