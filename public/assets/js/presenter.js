/*
 * HessuTalks – esitysikkuna projektorille (jatkettu näyttö).
 *
 * Turvallisuusperiaatteet:
 *  - Ikkunassa ei ole salausavainta eikä salauskirjastoa. Se näyttää vain sen, minkä
 *    hallintanäkymä (window.opener) lähettää postMessagella.
 *  - Viestit hyväksytään vain avaajaikkunalta ja samasta originista. Sisältö tarkistetaan.
 *  - Teksti lisätään DOMiin vain textContentilla (ei innerHTML:ää) -> ei XSS:ää.
 */
(function () {
  'use strict';

  var root = document.getElementById('presenter');
  var hint = document.getElementById('presenter-hint');
  if (!root) return;

  var MAX_TEXT = 4000;
  var MAX_ITEMS = 20;

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
    root.classList.remove('poll-stage');
    pollView = null;
    root.replaceChildren.apply(root, arguments);
  }
  function waiting(msg) {
    show(h('p', 'stage-url', msg));
  }

  function renderQr(code, url) {
    var qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    var img = h('img');
    img.src = qr.createDataURL(10, 4);
    img.alt = 'QR-koodi';
    show(h('p', 'stage-code', code), img, h('p', 'stage-url', url));
  }

  // ---------------------------------------------------------------- kyselyn tulokset

  var POLL_TYPES = ['single', 'multi', 'words', 'likert', 'scale'];
  var pollView = null;   // { id, prompt, results, count } – sama näkymä päivitetään, jotta kaaviot animoituvat
  var lastPoll = null;

  function isCount(n) { return typeof n === 'number' && Number.isInteger(n) && n >= 0; }
  function validPoll(m) {
    var p = m.poll;
    var d = m.data;
    if (!p || typeof p !== 'object' || !isCount(p.id) || POLL_TYPES.indexOf(p.type) === -1 || str(p.prompt, 300) === null) return false;
    if (!p.config || typeof p.config !== 'object' || str(m.url, 500) === null || !d || typeof d !== 'object' || !isCount(d.voters)) return false;
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
    return Array.isArray(d.words) && d.words.length <= 500 && d.words.every(function (w) {
      return Array.isArray(w) && w.length === 2 && str(w[0], 40) !== null && isCount(w[1]);
    });
  }

  function renderPoll(m) {
    var p = m.poll;
    lastPoll = m;
    if (!pollView || pollView.id !== p.id) {
      var prompt = h('p', 'poll-stage-prompt');
      var results = h('div', 'poll-stage-results');
      var qr = window.qrcode(0, 'M');
      qr.addData(m.url);
      qr.make();
      var img = h('img');
      img.src = qr.createDataURL(6, 2);
      img.alt = 'QR-koodi';
      var count = h('p', 'poll-stage-count');
      var info = h('div', 'poll-stage-info');
      info.appendChild(h('p', 'poll-stage-url', m.url.replace(/^https?:\/\//, '')));
      info.appendChild(count);
      var foot = h('div', 'poll-stage-foot');
      foot.appendChild(img);
      foot.appendChild(info);
      show(prompt, results, foot);
      root.classList.add('poll-stage');
      pollView = { id: p.id, prompt: prompt, results: results, count: count };
    }
    pollView.prompt.textContent = p.prompt;
    pollView.count.textContent = m.data.voters + ' vastausta' + (m.status === 'closed' ? ' · kysely on suljettu' : '');
    window.HessuResults.render(pollView.results, p, m.data);
  }

  // Sanapilvi asetellaan ikkunan koon mukaan: piirretään uudelleen, kun koko muuttuu.
  window.addEventListener('resize', function () { if (pollView && lastPoll) renderPoll(lastPoll); });

  function renderList(title, items) {
    var ol = h('ol', 'stage-list');
    items.forEach(function (it) {
      var li = h('li');
      li.appendChild(h('span', 'stage-nick', it.nick));
      li.appendChild(h('span', 'stage-list-text', it.text));
      ol.appendChild(li);
    });
    show(h('p', 'stage-url', title), items.length ? ol : h('p', 'stage-q', 'Ei kysymyksiä.'));
    trimList();
  }

  // Piilottaa listan lopusta kohdat, jotka eivät mahdu kokonaan näkyviin (ei puoliksi leikattuja rivejä).
  function trimList() {
    var ol = root.querySelector('.stage-list');
    if (!ol) return;
    var li = ol.children;
    for (var i = 0; i < li.length; i++) li[i].hidden = false;
    var bottom = ol.getBoundingClientRect().bottom;
    var full = false;
    for (i = 0; i < li.length; i++) {
      if (!full && i > 0 && li[i].getBoundingClientRect().bottom > bottom + 1) full = true;
      li[i].hidden = full;
    }
  }
  window.addEventListener('resize', trimList);

  function onMessage(ev) {
    if (ev.origin !== window.location.origin || !window.opener || ev.source !== window.opener) return;
    var m = ev.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'qr':
        if (str(m.code, 20) && str(m.url, 500)) renderQr(m.code, m.url);
        break;
      case 'question':
        if (str(m.nick, 100) !== null && str(m.text) !== null) show(h('p', 'stage-url', m.nick), h('p', 'stage-q', m.text));
        break;
      case 'list':
        if (str(m.title, 200) === null || !Array.isArray(m.items)) return;
        renderList(m.title, m.items.slice(0, MAX_ITEMS).filter(function (it) {
          return it && str(it.nick, 100) !== null && str(it.text) !== null;
        }));
        break;
      case 'poll':
        if (validPoll(m)) renderPoll(m);
        break;
      case 'blank':
        show();
        break;
      case 'end':
        waiting('Hallintanäkymä suljettiin.');
        break;
    }
  }

  // ---------------------------------------------------------------- koko näyttö

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }
  document.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', function () {
    if (hint) hint.hidden = !!document.fullscreenElement;
  });

  // ---------------------------------------------------------------- yhteys hallintaan

  window.addEventListener('message', onMessage);

  if (!window.opener) {
    waiting('Avaa esitysnäyttö hallintanäkymän napista.');
    return;
  }
  window.opener.postMessage({ type: 'ready' }, window.location.origin);

  // Tahdistus: hallintanäkymä päivittää tulokset näiden viestien tahdissa, vaikka sen välilehti olisi
  // taustalla (selain hidastaa taustan ajastimia, mutta ei viestien käsittelyä).
  setInterval(function () {
    if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'tick' }, window.location.origin);
  }, 2000);

  // Jos hallintaikkuna suljetaan, tyhjennä näyttö, ettei sisältö jää näkyviin.
  var watch = setInterval(function () {
    if (window.opener && !window.opener.closed) return;
    clearInterval(watch);
    waiting('Hallintanäkymä suljettiin.');
  }, 2000);
})();
