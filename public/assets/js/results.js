/*
 * HessuTalks – kyselytulosten laskenta ja piirto (hallinta ja projektori-ikkuna).
 *
 * Laskentafunktiot (validAnswer, normalizeWords, tally) ovat puhtaita, ja ne testataan Nodessa
 * (tests/js/results.test.mjs). Piirto käyttää vain DOM-elementtejä ja textContentia; animaatio
 * syntyy CSS-transitioista, kun samaa näkymää päivitetään uusilla luvuilla.
 */
(function (global) {
  'use strict';

  var WORDS_MAX_CHARS = 40;   // osallistujan kenttä sallii 30; vanhat vastaukset 40 merkkiin asti kelpaavat
  var WORDS_MAX_WORDS = 3;
  var CLOUD_MAX_WORDS = 60;
  var OPEN_MAX = 280;

  // ---------------------------------------------------------------- kirosanasuodatin
  //
  // Yksinkertainen suodatin (englanti ja suomi): osumat piilotetaan automaattisesti luennoitsijan
  // tarkistettavaksi, ja luennoitsija voi hyväksyä ne näkyviin. Suomen taivutukset: sanan alku riittää.
  var BAD_EXACT = ['ass', 'dick', 'cock', 'tits', 'piss', 'kyrpä', 'pillu', 'perse'];
  var BAD_PREFIX = [
    'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'bastard', 'whore', 'slut', 'nigg', 'fag', 'retard', 'motherf', 'bullshit', 'wank', 'twat',
    'vittu', 'vitu', 'perkele', 'saatana', 'paska', 'huora', 'kusip', 'mulkku', 'runkk', 'neeker', 'ryssä', 'hintti', 'jumalauta', 'helvet', 'kyrvä', 'pillun', 'persee', 'persr'
  ];

  /** true, jos tekstissä on kirosana. Vertailu pienillä kirjaimilla sanoittain. */
  function isProfane(text) {
    if (typeof text !== 'string') return false;
    var words = text.normalize('NFC').toLocaleLowerCase('fi').split(/[^\p{L}\p{N}]+/u);
    return words.some(function (w) {
      if (!w) return false;
      if (BAD_EXACT.indexOf(w) !== -1) return true;
      return BAD_PREFIX.some(function (p) { return w.indexOf(p) === 0; });
    });
  }

  /** Moderointitila: piilotetut ja hyväksytyt (suodattimen osumat) vastaukset ja sanat. */
  function emptyModeration() {
    return { words: {}, answers: {}, approved: {}, approvedWords: {} };
  }
  function isHiddenWord(mod, w) {
    return !!(mod && mod.words[w]) || (isProfane(w) && !(mod && mod.approvedWords[w]));
  }
  function isHiddenAnswer(mod, item) {
    return !!(mod && mod.answers[item.id]) || (isProfane(item.text) && !(mod && mod.approved[item.id]));
  }

  function range(poll) {
    if (poll.type === 'scale') return [0, 10];
    if (poll.type === 'likert') return [1, poll.config && poll.config.points === 7 ? 7 : 5];
    return null;
  }

  /** Normalisoi sanapilven vastauksen: pienet kirjaimet, ylimääräiset välit ja reunojen välimerkit pois. */
  function normalizeWords(text) {
    if (typeof text !== 'string') return '';
    return text.normalize('NFC').toLocaleLowerCase('fi')
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .trim();
  }

  /** Tarkistaa puretun vastauksen kyselyn tyyppiä vasten. Palauttaa siistityn vastauksen tai null. */
  function validAnswer(poll, a) {
    var opts = poll.config && Array.isArray(poll.config.options) ? poll.config.options.length : 0;
    var isIndex = function (v, max) { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max; };
    switch (poll.type) {
      case 'single':
        return isIndex(a, opts) ? a : null;
      case 'multi':
        if (!Array.isArray(a) || !a.length || a.length > opts) return null;
        if (!a.every(function (v) { return isIndex(v, opts); })) return null;
        return a.filter(function (v, i) { return a.indexOf(v) === i; });
      case 'likert':
      case 'scale':
        var r = range(poll);
        return typeof a === 'number' && Number.isInteger(a) && a >= r[0] && a <= r[1] ? a : null;
      case 'words':
        if (typeof a !== 'string' || a.length > WORDS_MAX_CHARS) return null;
        var w = normalizeWords(a);
        return w && w.split(' ').length <= WORDS_MAX_WORDS ? w : null;
      case 'open':
        return cleanOpen(a);
    }
    return null;
  }

  /** Avoin vastaus: ohjausmerkit pois (rivinvaihdot säilyvät), reunat siistitään, 1–280 merkkiä. */
  function cleanOpen(a) {
    if (typeof a !== 'string') return null;
    var text = a.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    var len = Array.from(text).length;
    return len >= 1 && len <= OPEN_MAX ? text : null;
  }

  /**
   * Laskee jakauman kelvollisista vastauksista.
   * mod: luennoitsijan moderointi (piilotetut sanat ja vastaukset; kirosanasuodattimen osumat piilossa,
   * kunnes ne hyväksytään). Avoimessa tekstissä vastaukset ovat { id, text, ts }.
   */
  function tally(poll, answers, mod) {
    var out = { voters: answers.length };
    if (poll.type === 'open') {
      var visible = answers.filter(function (it) { return !isHiddenAnswer(mod, it); });
      out.hidden = answers.length - visible.length;
      out.items = visible.slice().sort(function (x, y) { return (y.ts || 0) - (x.ts || 0) || y.id - x.id; });
      return out;
    }
    if (poll.type === 'single' || poll.type === 'multi') {
      var counts = (poll.config.options || []).map(function () { return 0; });
      answers.forEach(function (a) { [].concat(a).forEach(function (i) { counts[i]++; }); });
      out.counts = counts;
    } else if (poll.type === 'likert' || poll.type === 'scale') {
      var r = range(poll);
      var c = [];
      for (var v = r[0]; v <= r[1]; v++) c.push(0);
      answers.forEach(function (a) { c[a - r[0]]++; });
      out.counts = c;
      out.from = r[0];
      if (answers.length) {
        var sorted = answers.slice().sort(function (x, y) { return x - y; });
        var mid = Math.floor(sorted.length / 2);
        out.mean = sorted.reduce(function (s, x) { return s + x; }, 0) / sorted.length;
        out.median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
    } else {
      var map = {};
      answers.forEach(function (a) { if (!isHiddenWord(mod, a)) map[a] = (map[a] || 0) + 1; });
      out.words = Object.keys(map).map(function (k) { return [k, map[k]]; })
        .sort(function (x, y) { return y[1] - x[1] || (x[0] < y[0] ? -1 : 1); });
    }
    return out;
  }

  /** Projektorille ja osallistujille: ilman oikeita vastauksia ja selityksiä (paljastetaan erikseen). */
  function publicConfig(config) {
    var out = {};
    Object.keys(config || {}).forEach(function (k) { if (k !== 'correct' && k !== 'explanations') out[k] = config[k]; });
    return out;
  }

  // ================================================================ piirto

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }
  function fmt(n, digits) {
    return n.toLocaleString('fi-FI', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function pct(n, total) { return total ? Math.round(100 * n / total) : 0; }

  /** Vaakapalkit monivalinnoille. Rivit säilytetään, jotta leveydet animoituvat. */
  function renderBars(el, poll, data) {
    var rows = el.querySelectorAll('.res-row');
    if (rows.length !== data.counts.length) {
      el.replaceChildren();
      data.counts.forEach(function (_, i) {
        var row = h('div', 'res-row');
        row.appendChild(h('span', 'res-label', poll.config.options[i]));
        var track = h('span', 'res-track');
        track.appendChild(h('span', 'res-bar'));
        row.appendChild(track);
        row.appendChild(h('span', 'res-value'));
        el.appendChild(row);
      });
      rows = el.querySelectorAll('.res-row');
    }
    var max = Math.max.apply(null, data.counts.concat([1]));
    data.counts.forEach(function (n, i) {
      rows[i].querySelector('.res-label').textContent = poll.config.options[i];
      rows[i].querySelector('.res-bar').style.width = (100 * n / max) + '%';
      rows[i].querySelector('.res-value').textContent = pct(n, data.voters) + ' % (' + n + ')';
    });
  }

  /** Pystypylväät Likertille ja asteikolle sekä keskiarvo ja mediaani. */
  function renderColumns(el, poll, data) {
    var cols = el.querySelectorAll('.res-col');
    if (cols.length !== data.counts.length) {
      el.replaceChildren();
      var chart = h('div', 'res-columns');
      data.counts.forEach(function (_, i) {
        var col = h('div', 'res-col');
        col.appendChild(h('span', 'res-col-value'));
        var track = h('span', 'res-col-track');
        track.appendChild(h('span', 'res-col-bar'));
        col.appendChild(track);
        col.appendChild(h('span', 'res-col-label', String(data.from + i)));
        chart.appendChild(col);
      });
      el.appendChild(chart);
      var cfg = poll.config || {};
      if (cfg.min_label || cfg.max_label) {
        var ends = h('div', 'res-ends');
        ends.appendChild(h('span', null, cfg.min_label || ''));
        ends.appendChild(h('span', null, cfg.max_label || ''));
        el.appendChild(ends);
      }
      el.appendChild(h('p', 'res-stats'));
      cols = el.querySelectorAll('.res-col');
    }
    var max = Math.max.apply(null, data.counts.concat([1]));
    data.counts.forEach(function (n, i) {
      cols[i].querySelector('.res-col-bar').style.height = (100 * n / max) + '%';
      cols[i].querySelector('.res-col-value').textContent = n ? String(n) : '';
    });
    el.querySelector('.res-stats').textContent = data.mean === undefined ? '' :
      'Keskiarvo ' + fmt(data.mean, 1) + ' · mediaani ' + fmt(data.median, data.median % 1 ? 1 : 0);
  }

  // ---------------------------------------------------------------- sanapilvi

  var measureCtx = null;
  function textWidth(text, size, family) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = '700 ' + size + 'px ' + family;
    return measureCtx.measureText(text).width;
  }
  function hashColor(text) {
    var x = 0;
    for (var i = 0; i < text.length; i++) x = (x * 31 + text.charCodeAt(i)) % 997;
    return 'res-c' + (x % 5);
  }

  /**
   * Asettelee sanat spiraalina keskeltä ulospäin niin, etteivät ne mene päällekkäin.
   * Isoin sana keskelle. Samat sanat säilyttävät elementtinsä, jolloin koko ja paikka animoituvat.
   */
  function renderCloud(el, poll, data, opts) {
    var cloud = el.querySelector('.res-cloud');
    if (!cloud) {
      el.replaceChildren();
      cloud = h('div', 'res-cloud');
      el.appendChild(cloud);
    }
    var words = data.words.slice(0, CLOUD_MAX_WORDS);
    var W = cloud.clientWidth || 600;
    var H = cloud.clientHeight || 400;
    var family = window.getComputedStyle(cloud).fontFamily || 'sans-serif';
    var existing = {};
    Array.prototype.forEach.call(cloud.children, function (s) { existing[s.dataset.word] = s; });

    var maxC = words.length ? words[0][1] : 1;
    var minC = words.length ? words[words.length - 1][1] : 1;
    var minF = Math.max(14, H * 0.045);
    var maxF = Math.max(minF, Math.min(H * 0.24, W * 0.13));
    var placed = [];
    var keep = {};

    words.forEach(function (pair) {
      var word = pair[0];
      var count = pair[1];
      var k = maxC === minC ? 1 : Math.sqrt((count - minC) / (maxC - minC));
      var size = Math.round(minF + (maxF - minF) * k);
      var w = textWidth(word, size, family);
      while (w > W * 0.95 && size > minF) { size -= 2; w = textWidth(word, size, family); }
      var hgt = size * 1.1;
      var spot = null;
      for (var i = 0; i < 1500 && !spot; i++) {
        var angle = 0.3 * i;
        var radius = 1.8 * angle;
        var x = W / 2 + radius * Math.cos(angle) * 1.6 - w / 2;
        var y = H / 2 + radius * Math.sin(angle) - hgt / 2;
        if (x < 0 || y < 0 || x + w > W || y + hgt > H) continue;
        var free = placed.every(function (p) {
          return x + w + 6 < p.x || p.x + p.w + 6 < x || y + hgt + 2 < p.y || p.y + p.h + 2 < y;
        });
        if (free) spot = { x: x, y: y, w: w, h: hgt };
      }
      if (!spot) return;
      placed.push(spot);
      var span = existing[word];
      if (!span) {
        span = h('span', 'res-word ' + hashColor(word), word);
        span.dataset.word = word;
        span.style.left = (W / 2 - w / 2) + 'px';
        span.style.top = (H / 2 - hgt / 2) + 'px';
        cloud.appendChild(span);
      }
      span.title = count + ' ×';
      span.style.fontSize = size + 'px';
      span.style.left = spot.x + 'px';
      span.style.top = spot.y + 'px';
      keep[word] = true;
      if (opts && typeof opts.onWord === 'function' && !span.dataset.bound) {
        span.dataset.bound = '1';
        span.addEventListener('click', function () { opts.onWord(word); });
      }
    });
    Object.keys(existing).forEach(function (word) { if (!keep[word]) existing[word].remove(); });
  }

  /**
   * Avoimet vastaukset listana, uusin ensin. opts.onAnswer(item): hallinnan Piilota-nappi.
   * opts.max: näytettävien enimmäismäärä (projektori).
   */
  function renderOpen(el, poll, data, opts) {
    var items = opts && opts.max ? data.items.slice(0, opts.max) : data.items;
    var list = h('ol', 'res-open');
    items.forEach(function (it) {
      var li = h('li');
      li.appendChild(h('span', 'res-open-text', typeof it === 'string' ? it : it.text));
      if (opts && typeof opts.onAnswer === 'function' && typeof it === 'object') {
        var b = h('button', 'btn ghost small', 'Piilota');
        b.type = 'button';
        b.addEventListener('click', function () { opts.onAnswer(it); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    el.replaceChildren(items.length ? list : h('p', 'res-empty', 'Ei vastauksia.'));
  }

  /**
   * Piirtää tuloksen elementtiin el. Saman kyselyn uusi piirto päivittää olemassa olevat elementit.
   * opts.onWord(word): sanapilven sanan klikkaus, opts.onAnswer(item): avoimen vastauksen piilotus (hallinta).
   */
  function render(el, poll, data, opts) {
    var key = poll.id + '|' + poll.type;
    if (el.dataset.key !== key) { el.replaceChildren(); el.dataset.key = key; }
    el.classList.add('results');
    if (poll.type === 'single' || poll.type === 'multi') renderBars(el, poll, data);
    else if (poll.type === 'likert' || poll.type === 'scale') renderColumns(el, poll, data);
    else if (poll.type === 'open') renderOpen(el, poll, data, opts);
    else renderCloud(el, poll, data, opts);
  }

  var api = {
    validAnswer: validAnswer, normalizeWords: normalizeWords, tally: tally, render: render,
    isProfane: isProfane, emptyModeration: emptyModeration, publicConfig: publicConfig, OPEN_MAX: OPEN_MAX
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.HessuResults = api;
})(this);
