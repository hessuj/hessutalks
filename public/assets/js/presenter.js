/*
 * HessuTalks – esitysikkuna projektorille (jatkettu näyttö).
 *
 * Yksi ikkuna näyttää kaiken, mitä luennoitsija on valinnut näytölle: kyselyt tuloksineen, kysymys- ja
 * palautelistan ja yksittäisen viestin. Ruudukko jaetaan niin, että kaikki mahtuvat (Hessun koeajo 13.11.:
 * jokainen näkymä avautui omaan ikkunaansa, ja ikkunat jäivät toistensa taakse).
 *
 * Turvallisuusperiaatteet:
 *  - Ikkunassa ei ole salausavainta eikä salauskirjastoa. Se näyttää vain sen, minkä hallintanäkymä lähettää.
 *  - Viestit kulkevat BroadcastChannelilla (vain sama origin), jonka nimessä on hallinnan arpoma
 *    satunnainen tunniste (URL:n #-osa, ei lähde palvelimelle). Muut saman originin sivut eivät tiedä kanavaa.
 *    Yhteys palautuu itsestään, jos jompikumpi ikkuna ladataan uudelleen. Sisältö tarkistetaan.
 *  - Teksti lisätään DOMiin vain textContentilla (ei innerHTML:ää) -> ei XSS:ää.
 */
(function () {
  'use strict';

  var root = document.getElementById('presenter');
  var hint = document.getElementById('presenter-hint');
  if (!root) return;

  var MAX_TEXT = 4000;
  var MAX_ITEMS = 20;
  var MAX_TILES = 12;

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function str(v, max) {
    return typeof v === 'string' && v.length <= (max || MAX_TEXT) ? v : null;
  }
  function show() {
    root.className = 'stage';
    board = null;
    root.replaceChildren.apply(root, arguments);
  }
  function waiting(msg) {
    have = null;
    show(h('p', 'stage-url', msg));
  }

  // Kieli tulee hallinnan viestistä (luennon osallistujien kieli). Vain fi ja en.
  var lang = 'fi';
  var TEXT = {
    fi: {
      answers: function (n) { return n === 1 ? '1 vastaus' : n + ' vastausta'; }, closed: ' · suljettu', draft: ' · ei vielä auki',
      later: 'Tulokset näytetään myöhemmin.', none: 'Ei vastauksia.', noMessages: 'Ei vielä viestejä.',
      mean: 'Keskiarvo', median: 'mediaani', locale: 'fi-FI', ended: 'Hallintanäkymä suljettiin.',
      more: function (n) { return '+' + n + ' muuta näytöllä'; }
    },
    en: {
      answers: function (n) { return n === 1 ? '1 answer' : n + ' answers'; }, closed: ' · closed', draft: ' · not open yet',
      later: 'Results will be shown later.', none: 'No answers yet.', noMessages: 'No messages yet.',
      mean: 'Average', median: 'median', locale: 'en-GB', ended: 'The admin view was closed.',
      more: function (n) { return '+' + n + ' more'; }
    }
  };
  function tx() { return TEXT[lang]; }

  function qrImg(url, cell, margin) {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var img = h('img');
    img.src = qr.createDataURL(cell, margin);
    img.alt = 'QR-koodi';
    return img;
  }

  function renderQr(code, url) {
    show(h('p', 'stage-code', code), qrImg(url, 10, 4), h('p', 'stage-url', url));
  }

  // ---------------------------------------------------------------- sisällön tarkistus

  var POLL_TYPES = ['single', 'multi', 'words', 'likert', 'scale', 'open'];
  var STATUSES = ['draft', 'open', 'closed'];
  var OPEN_ON_STAGE = 10;

  function isCount(n) { return typeof n === 'number' && Number.isInteger(n) && n >= 0; }
  function validPoll(m) {
    var p = m.poll;
    var d = m.data;
    if (!p || typeof p !== 'object' || !isCount(p.id) || POLL_TYPES.indexOf(p.type) === -1 || str(p.prompt, 300) === null) return false;
    if (!p.config || typeof p.config !== 'object' || STATUSES.indexOf(m.status) === -1 || !d || typeof d !== 'object' || !isCount(d.voters)) return false;
    if (p.type === 'single' || p.type === 'multi') {
      var opts = p.config.options;
      if (!Array.isArray(opts) || opts.length > 10 || !opts.every(function (o) { return str(o, 120) !== null; })) return false;
      return Array.isArray(d.counts) && d.counts.length === opts.length && d.counts.every(isCount);
    }
    if (p.type === 'likert' || p.type === 'scale') {
      if ((p.config.min_label !== undefined && str(p.config.min_label, 40) === null) ||
          (p.config.max_label !== undefined && str(p.config.max_label, 40) === null)) return false;
      return Array.isArray(d.counts) && d.counts.length <= 11 && d.counts.every(isCount) && isCount(d.from) &&
        (d.mean === undefined || typeof d.mean === 'number') && (d.median === undefined || typeof d.median === 'number');
    }
    if (p.type === 'open') {
      return Array.isArray(d.items) && d.items.length <= 50 && d.items.every(function (t) { return str(t, 600) !== null; });
    }
    return Array.isArray(d.words) && d.words.length <= 500 && d.words.every(function (w) {
      return Array.isArray(w) && w.length === 2 && str(w[0], 40) !== null && isCount(w[1]);
    });
  }

  /** Paljastus: oikeiden vaihtoehtojen indeksit ja valinnaiset selitykset (tarkistetaan kuten muukin sisältö). */
  function validReveal(m) {
    var r = m.reveal;
    var n = m.poll.config && Array.isArray(m.poll.config.options) ? m.poll.config.options.length : 0;
    if (!r || typeof r !== 'object' || !Array.isArray(r.correct) || !r.correct.every(function (i) { return isCount(i) && i < n; })) return null;
    var ex = r.explanations;
    if (ex !== null && ex !== undefined && (!Array.isArray(ex) || ex.length !== n || !ex.every(function (e) { return str(e, 300) !== null; }))) return null;
    return { correct: r.correct, explanations: ex || null };
  }

  function validItems(items) {
    return Array.isArray(items) ? items.slice(0, MAX_ITEMS).filter(function (it) {
      return it && str(it.nick, 100) !== null && str(it.text) !== null;
    }) : null;
  }

  /** Ruutu: { key, kind, ... } tai null, jos sisältö ei kelpaa. */
  function validTile(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.kind === 'poll') return validPoll(t) ? { key: 'poll-' + t.poll.id, kind: 'poll', m: t } : null;
    if (t.kind === 'list') {
      var items = validItems(t.items);
      return str(t.title, 200) !== null && (t.list === 'question' || t.list === 'feedback') && items
        ? { key: 'list-' + t.list, kind: 'list', title: t.title, items: items } : null;
    }
    if (t.kind === 'question') {
      return str(t.nick, 100) !== null && str(t.text) !== null ? { key: 'question', kind: 'question', nick: t.nick, text: t.text } : null;
    }
    return null;
  }

  // ---------------------------------------------------------------- ruudukko

  var board = null;   // { keys, grid, tiles: { key -> { el, kind, ... } }, foot }
  var lastBoard = null;

  /** Sarakkeet ruutujen määrän mukaan (16:9-näyttö): 1, 2, 2×2, 3×2, 3×3, 4×3. */
  function columns(n) { return n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4; }

  function pollTile() {
    var el = h('section', 'tile tile-poll');
    var prompt = h('p', 'poll-stage-prompt');
    var results = h('div', 'poll-stage-results');
    var count = h('p', 'poll-stage-count');
    el.appendChild(prompt);
    el.appendChild(results);
    el.appendChild(count);
    return { el: el, prompt: prompt, results: results, count: count };
  }

  function updatePoll(tile, m) {
    tile.prompt.textContent = m.poll.prompt;
    tile.count.textContent = tx().answers(m.data.voters) + (m.status === 'closed' ? tx().closed : m.status === 'draft' ? tx().draft : '');
    window.HessuResults.render(tile.results, m.poll, m.data, {
      max: OPEN_ON_STAGE, clip: window.HessuResults.OPEN_CLIP, hidden: m.results !== true, reveal: validReveal(m),
      hiddenText: tx().later, emptyText: tx().none, labels: { mean: tx().mean, median: tx().median }, locale: tx().locale
    });
  }

  function listTile(t) {
    var el = h('section', 'tile tile-list');
    el.appendChild(h('p', 'stage-url', t.title));
    if (!t.items.length) {
      el.appendChild(h('p', 'stage-empty', tx().noMessages));
      return { el: el };
    }
    var ol = h('ol', 'stage-list');
    t.items.forEach(function (it) {
      var li = h('li');
      li.appendChild(h('span', 'stage-nick', it.nick));
      li.appendChild(h('span', 'stage-list-text', it.text));
      ol.appendChild(li);
    });
    el.appendChild(ol);
    return { el: el };
  }

  function questionTile(t) {
    var el = h('section', 'tile tile-question');
    el.appendChild(h('p', 'stage-url', t.nick));
    el.appendChild(h('p', 'stage-q', t.text));
    return { el: el };
  }

  function renderBoard(m, tiles) {
    var shown = tiles.slice(0, MAX_TILES);
    var keys = shown.map(function (t) { return t.key; }).join('|');
    if (!board || board.keys !== keys) {
      var old = board ? board.tiles : {};
      var grid = h('div', 'board-grid');
      var cols = columns(shown.length);
      grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
      grid.style.gridTemplateRows = 'repeat(' + Math.ceil(shown.length / cols) + ', minmax(0, 1fr))';
      var map = {};
      shown.forEach(function (t) {
        // Kyselyruutu säilyy, jotta kaaviot animoituvat; listat ja viesti piirretään aina uudelleen.
        map[t.key] = t.kind === 'poll' && old[t.key] ? old[t.key] : t.kind === 'poll' ? pollTile() : null;
        if (map[t.key]) grid.appendChild(map[t.key].el);
        else grid.appendChild(h('section', 'tile'));
      });
      var info = h('div', 'poll-stage-info');
      var code = h('p', 'poll-stage-code');
      var url = h('p', 'poll-stage-url');
      var more = h('p', 'poll-stage-count');
      info.appendChild(code);
      info.appendChild(url);
      info.appendChild(more);
      var foot = h('div', 'poll-stage-foot');
      foot.appendChild(h('span', 'foot-qr'));
      foot.appendChild(info);
      root.className = 'stage board' + (shown.length > 1 ? ' multi' : '');
      root.replaceChildren(grid, foot);
      board = { keys: keys, grid: grid, tiles: map, foot: foot, code: code, url: url, more: more, qrFor: null };
    }
    // Liittymiskoodi ja osoite aina alareunassa (myöhässä tulevat ja Teams-osallistujat).
    if (board.qrFor !== m.url) { board.foot.firstChild.replaceChildren(qrImg(m.url, 6, 2)); board.qrFor = m.url; }
    board.code.textContent = m.code;
    board.url.textContent = m.url.replace(/^https?:\/\//, '');
    board.more.textContent = tiles.length > shown.length ? tx().more(tiles.length - shown.length) : '';
    shown.forEach(function (t, i) {
      if (t.kind === 'poll') { updatePoll(board.tiles[t.key], t.m); return; }
      var tile = t.kind === 'list' ? listTile(t) : questionTile(t);
      var slot = board.grid.children[i];
      if (slot) slot.replaceWith(tile.el);
      board.tiles[t.key] = tile;
    });
    refit();
  }

  // Sanapilvi asetellaan ruudun koon mukaan: piirretään uudelleen, kun koko muuttuu.
  function redrawPolls() {
    if (!board || !lastBoard) return;
    lastBoard.tiles.forEach(function (t) { if (t.kind === 'poll' && board.tiles[t.key]) updatePoll(board.tiles[t.key], t.m); });
  }

  // Piilottaa listan lopusta kohdat, jotka eivät mahdu kokonaan näkyviin (ei puoliksi leikattuja rivejä).
  function trimList(ol) {
    var li = ol.children;
    for (var i = 0; i < li.length; i++) li[i].hidden = false;
    var bottom = ol.getBoundingClientRect().bottom;
    var full = false;
    for (i = 0; i < li.length; i++) {
      if (!full && i > 0 && li[i].getBoundingClientRect().bottom > bottom + 1) full = true;
      li[i].hidden = full;
    }
  }
  // Yksittäinen viesti (enintään 2000 merkkiä): fonttia pienennetään, kunnes teksti mahtuu ruutuun otsikon alle.
  function fitQuestion(tile) {
    var q = tile.querySelector('.stage-q');
    if (!q) return;
    q.style.fontSize = '';
    var size = parseFloat(getComputedStyle(q).fontSize);
    var min = Math.max(12, window.innerHeight * 0.016);
    while (size > min && tile.scrollHeight > tile.clientHeight + 1) {
      size = Math.max(min, size * 0.9);
      q.style.fontSize = size + 'px';
    }
  }

  // Koon muutos: ikkunan siirto projektorille, koko näyttö (Safari ei aina laukaise resize-tapahtumaa ajoissa) ja fontit.
  function refit() {
    Array.prototype.forEach.call(root.querySelectorAll('.stage-list'), trimList);
    Array.prototype.forEach.call(root.querySelectorAll('.tile-question'), fitQuestion);
  }
  var resizeFrame = 0;
  function onResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(function () { redrawPolls(); refit(); });
  }
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);
  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(root);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);

  // ---------------------------------------------------------------- iso QR-koodi (Q)

  var bigQr = null;
  function setBigQr(code, url) {
    if (bigQr) { bigQr.remove(); bigQr = null; }
    if (!code) return;
    bigQr = h('div', 'stage-bigqr');
    bigQr.appendChild(h('p', 'stage-code', code));
    bigQr.appendChild(qrImg(url, 12, 4));
    bigQr.appendChild(h('p', 'stage-url', url));
    document.body.appendChild(bigQr);
  }

  // ---------------------------------------------------------------- viestit hallinnalta

  var have = null;    // viimeksi näytetyn sisällön tunniste (hallinta lähettää uudelleen, jos se ei täsmää)

  function onBoard(m) {
    if (str(m.code, 20) === null || str(m.url, 500) === null || !Array.isArray(m.tiles)) return;
    // Iso QR-koodi kulkee jokaisen viestin mukana (tila on hallinnassa ja palvelimella).
    setBigQr(m.bigQr === true ? m.code : null, m.url);
    var tiles = m.tiles.map(validTile).filter(Boolean);
    lastBoard = { tiles: tiles };
    if (!tiles.length) { renderQr(m.code, m.url); return; }
    renderBoard(m, tiles);
  }

  function onMessage(ev) {
    var m = ev.data;
    if (!m || typeof m !== 'object') return;
    lang = m.lang === 'en' ? 'en' : 'fi';
    switch (m.type) {
      case 'board':
        onBoard(m);
        have = str(m.key, 40);
        break;
      case 'blank':
        setBigQr(null);
        lastBoard = null;
        show();
        have = str(m.key, 40);
        break;
      case 'end':
        setBigQr(null);
        lastBoard = null;
        waiting(tx().ended);
        break;
    }
  }

  // ---------------------------------------------------------------- koko näyttö

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }
  document.addEventListener('dblclick', toggleFullscreen);

  // ---------------------------------------------------------------- teema (T)

  var THEME_KEY = 'hessutalks.stage-theme';
  function applyTheme(light) {
    document.body.classList.toggle('light', light);
    try { window.localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (e) { /* ei tallennusta */ }
  }
  try { applyTheme(window.localStorage.getItem(THEME_KEY) === 'light'); } catch (e) { /* oletus tumma */ }

  document.addEventListener('fullscreenchange', function () {
    if (hint) hint.hidden = !!document.fullscreenElement;
  });

  // ---------------------------------------------------------------- yhteys hallintaan

  // Kanavan tunniste: hallinnan arpoma (22 merkkiä), esikatselulla pääte ".p".
  var id = window.location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{22}(\.p)?$/.test(id) || typeof BroadcastChannel !== 'function') {
    waiting('Avaa esitysnäyttö hallintanäkymän napista.');
    return;
  }
  var channel = new BroadcastChannel('hessutalks-esitys-' + id);
  channel.onmessage = onMessage;

  // ---------------------------------------------------------------- pikanäppäimet
  //
  // Esitysikkunalla ei ole pääsyä rajapintaan: komento lähetetään hallinnalle, joka tekee toiminnon.
  // Langattomat esitysohjaimet lähettävät yleensä PageUp/PageDown tai nuolinäppäimiä.
  var KEYS = {
    ArrowRight: 'next', PageDown: 'next', ArrowDown: 'next',
    ArrowLeft: 'prev', PageUp: 'prev', ArrowUp: 'prev',
    ' ': 'toggle', r: 'results', R: 'results', a: 'reveal', A: 'reveal', q: 'qr', Q: 'qr'
  };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); return; }
    if (e.key === 't' || e.key === 'T') { applyTheme(!document.body.classList.contains('light')); return; }
    var cmd = KEYS[e.key];
    if (!cmd) return;
    e.preventDefault();
    channel.postMessage({ type: 'command', cmd: cmd });
  });

  // Tahdistus sekunnin välein: hallinta lähettää sisällön uudelleen, jos tämä ikkuna ei ole ajan tasalla
  // (esim. jompikumpi ladattiin uudelleen), ja päivittää tulokset, vaikka sen välilehti olisi taustalla
  // (selain hidastaa taustan ajastimia, mutta ei viestien käsittelyä).
  function hello() { channel.postMessage({ type: 'hello', have: have }); }
  hello();
  setInterval(hello, 1000);
})();
