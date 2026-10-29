// Kyselytulosten laskenta (public/assets/js/results.js): vastausten tarkistus ja jakaumat.
// Vastaukset puretaan luennoitsijan selaimessa, joten tarkistus on ainoa suoja muokattuja
// asiakasohjelmia vastaan: väärän muotoinen vastaus ei saa vääristää tuloksia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../public/assets/js/results.js');

const single = { id: 1, type: 'single', config: { options: ['A', 'B', 'C'] } };
const multi = { id: 2, type: 'multi', config: { options: ['A', 'B', 'C'] } };
const likert = { id: 3, type: 'likert', config: { points: 5 } };
const likert7 = { id: 4, type: 'likert', config: { points: 7 } };
const scale = { id: 5, type: 'scale', config: {} };
const words = { id: 6, type: 'words', config: {} };

test('monivalinta hyväksyy vain olemassa olevan vaihtoehdon', () => {
  assert.equal(R.validAnswer(single, 2), 2);
  for (const bad of [3, -1, 1.5, '1', null, [1], true]) assert.equal(R.validAnswer(single, bad), null, String(bad));
});

test('useita vastauksia: kelvolliset indeksit, kaksoiskappaleet poistetaan', () => {
  assert.deepEqual(R.validAnswer(multi, [0, 2, 0]), [0, 2]);
  assert.equal(R.validAnswer(multi, []), null);
  assert.equal(R.validAnswer(multi, [0, 3]), null);
  assert.equal(R.validAnswer(multi, [0, 1, 2, 0]), null, 'enemmän valintoja kuin vaihtoehtoja');
  assert.equal(R.validAnswer(multi, 1), null);
});

test('Likert ja asteikko: vain asteikon kokonaisluvut', () => {
  assert.equal(R.validAnswer(likert, 5), 5);
  assert.equal(R.validAnswer(likert, 6), null);
  assert.equal(R.validAnswer(likert, 0), null);
  assert.equal(R.validAnswer(likert7, 7), 7);
  assert.equal(R.validAnswer(scale, 0), 0);
  assert.equal(R.validAnswer(scale, 10), 10);
  assert.equal(R.validAnswer(scale, 11), null);
  assert.equal(R.validAnswer(scale, 2.5), null);
});

test('sanapilvi: normalisointi ja pituusrajat', () => {
  assert.equal(R.normalizeWords('  Zero   TRUST! '), 'zero trust');
  assert.equal(R.normalizeWords('"Ääkköset?"'), 'ääkköset');
  assert.equal(R.validAnswer(words, 'Palomuuri'), 'palomuuri');
  assert.equal(R.validAnswer(words, 'yksi kaksi kolme neljä'), null);
  assert.equal(R.validAnswer(words, 'x'.repeat(41)), null);
  assert.equal(R.validAnswer(words, '!!!'), null);
  assert.equal(R.validAnswer(words, 42), null);
});

test('jakaumat ja tunnusluvut', () => {
  assert.deepEqual(R.tally(single, [0, 2, 2]), { voters: 3, counts: [1, 0, 2] });
  assert.deepEqual(R.tally(multi, [[0, 1], [1]]), { voters: 2, counts: [1, 2, 0] });
  const l = R.tally(likert, [1, 2, 2, 5]);
  assert.deepEqual(l.counts, [1, 2, 0, 0, 1]);
  assert.equal(l.from, 1);
  assert.equal(l.mean, 2.5);
  assert.equal(l.median, 2);
  const s = R.tally(scale, [0, 10, 7]);
  assert.equal(s.counts.length, 11);
  assert.equal(s.median, 7);
  assert.equal(R.tally(scale, []).mean, undefined);
});

test('sanapilvi: yleisimmät ensin, piilotetut pois', () => {
  const t = R.tally(words, ['vpn', 'mfa', 'vpn', 'salasana', 'mfa', 'vpn']);
  assert.deepEqual(t.words, [['vpn', 3], ['mfa', 2], ['salasana', 1]]);
  const mod = R.emptyModeration();
  mod.words.vpn = true;
  assert.deepEqual(R.tally(words, ['vpn', 'mfa'], mod).words, [['mfa', 1]]);
});

const open = { id: 7, type: 'open', config: { multiple: true } };

test('avoin teksti: 1–280 merkkiä, ohjausmerkit pois, rivinvaihdot säilyvät', () => {
  assert.equal(R.validAnswer(open, '  Hei\r\nmaailma\u0007  '), 'Hei\nmaailma');
  assert.equal(R.validAnswer(open, '<script>alert(1)</script>'), '<script>alert(1)</script>', 'Teksti säilyy tekstinä; DOMiin vain textContentilla');
  assert.equal(R.validAnswer(open, 'ä'.repeat(280)), 'ä'.repeat(280));
  assert.equal(R.validAnswer(open, '😀'.repeat(280)), '😀'.repeat(280), 'Merkit lasketaan, ei UTF-16-yksiköitä');
  for (const bad of ['x'.repeat(281), '   ', '', 5, null, ['a']]) assert.equal(R.validAnswer(open, bad), null, String(bad));
  assert.equal(R.validAnswer(open, 'a\u202Eb'), 'ab', 'Tekstin suunnan ohjausmerkit pois');
});

test('avoin teksti: kysymyskohtainen enimmäispituus 280–3500 merkkiä (noin 500 sanaa)', () => {
  const essay = { id: 40, type: 'open', config: { multiple: false, max: 3500 } };
  assert.equal(R.openMax(essay), 3500);
  assert.equal(R.validAnswer(essay, 'ä'.repeat(3500)), 'ä'.repeat(3500));
  assert.equal(R.validAnswer(essay, 'x'.repeat(3501)), null);
  assert.equal(R.validAnswer(open, 'x'.repeat(281)), null, 'Ilman asetusta oletus 280');
  // Muokattu asetus ei avaa rajaa: vain 280–3500 kelpaa, muuten oletus.
  assert.equal(R.clip('x'.repeat(280)), 'x'.repeat(280), 'Lyhyt vastaus ennallaan');
  assert.equal(R.clip('x'.repeat(279) + '  yz'), 'x'.repeat(279) + '…', 'Projektorille alku ja "…"');
  assert.equal([...R.clip('😀'.repeat(400))].length, 281, 'Merkit, ei UTF-16-yksiköitä');
  for (const max of [100000, 100, '3500', 3500.5, null]) {
    assert.equal(R.openMax({ type: 'open', config: { max } }), 280, String(max));
  }
});

test('avoin teksti: uusin ensin, piilotetut ja suodattimen osumat pois', () => {
  const items = [
    { id: 1, text: 'Ensimmäinen', ts: 100 },
    { id: 2, text: 'Toinen', ts: 200 },
    { id: 3, text: 'Paskaa koko luento', ts: 300 },
    { id: 4, text: 'Kolmas', ts: 300 },
  ];
  const mod = R.emptyModeration();
  let t = R.tally(open, items, mod);
  assert.deepEqual(t.items.map((i) => i.id), [4, 2, 1], 'Kirosana piilossa automaattisesti');
  assert.equal(t.voters, 4);
  assert.equal(t.hidden, 1);
  mod.answers[2] = true;
  mod.approved[3] = true;
  t = R.tally(open, items, mod);
  assert.deepEqual(t.items.map((i) => i.id), [4, 3, 1], 'Piilotettu pois, hyväksytty näkyviin');
});

test('kirosanasuodatin: englanti ja suomi, taivutukset, ei vääriä osumia', () => {
  for (const bad of ['fuck this', 'Bullshit!', 'vittu', 'Vittujen kevät', 'perkeleen hyvä', 'saatanan', 'PASKA']) assert.equal(R.isProfane(bad), true, bad);
  for (const ok of ['assessment', 'class assignment', 'summa cum laude', 'Scunthorpe', 'Cocktail', 'perseverance', 'tit for tat', 'security', '']) {
    assert.equal(R.isProfane(ok), false, ok);
  }
  const mod = R.emptyModeration();
  assert.deepEqual(R.tally(words, ['vittu', 'mfa'], mod).words, [['mfa', 1]]);
  mod.approvedWords.vittu = true;
  assert.deepEqual(R.tally(words, ['vittu', 'mfa'], mod).words.map((w) => w[0]).sort(), ['mfa', 'vittu']);
});

test('CSV: puolipiste-erotin, lainausmerkit ja kaavainjektion esto', () => {
  assert.equal(R.csvCell('Hacktivist'), 'Hacktivist');
  assert.equal(R.csvCell('a;b'), '"a;b"');
  assert.equal(R.csvCell('sanoi "hei"'), '"sanoi ""hei"""');
  assert.equal(R.csvCell('rivi1\nrivi2'), '"rivi1\nrivi2"');
  for (const evil of ['=HYPERLINK("http://evil","klik")', '+1+1', '-2+3', '@SUM(A1)', '\t=1']) {
    assert.ok(R.csvCell(evil).replace(/^"/, '').startsWith("'"), evil);
  }
  assert.equal(R.csvCell(5), '5');
  assert.equal(R.csvCell(null), '');
  assert.equal(R.csv([['a', 'b'], ['=1', 'x;y']]), "a;b\r\n'=1;\"x;y\"\r\n");
});
