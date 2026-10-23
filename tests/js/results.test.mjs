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
  assert.deepEqual(R.tally(words, ['vpn', 'mfa'], { vpn: true }).words, [['mfa', 1]]);
});
