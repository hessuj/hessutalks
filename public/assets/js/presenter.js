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

  // Jos hallintaikkuna suljetaan, tyhjennä näyttö, ettei sisältö jää näkyviin.
  var watch = setInterval(function () {
    if (window.opener && !window.opener.closed) return;
    clearInterval(watch);
    waiting('Hallintanäkymä suljettiin.');
  }, 2000);
})();
