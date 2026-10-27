// Passkeyn PRF-tuloksen luku (public/assets/js/admin.js, prfResult). Funktio on admin.js:n sisällä,
// joten se poimitaan lähdekoodista. Testi varmistaa, että 1Passwordin laajennuksen palauttama
// tavallinen numerotaulukko kelpaa ja että väärän muotoinen tulos hylätään.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../public/assets/js/admin.js', import.meta.url), 'utf8');
const start = src.indexOf('function prfResult');
const end = src.indexOf('\n  }\n', start) + 4;
assert.ok(start > 0 && end > start, 'prfResult löytyy admin.js:stä');
const prfResult = new Function(src.slice(start, end) + '; return prfResult;')();

const bytes = Array.from({ length: 32 }, (_, i) => (i * 37) & 255);

test('hyväksyy ArrayBufferin, typed arrayn ja 1Passwordin numerotaulukon', () => {
  const big = new Uint8Array(40);
  big.set(bytes, 4);
  for (const first of [new Uint8Array(bytes).buffer, new Uint8Array(bytes), big.subarray(4, 36), bytes]) {
    const r = prfResult({ prf: { results: { first } } });
    assert.deepEqual(Array.from(r.output), bytes);
    assert.equal(r.diag, null);
  }
});

test('hylkää puuttuvan ja väärän muotoisen tuloksen ja kertoo syyn', () => {
  const bad = [
    [{}, /ei PRF-vastausta/],
    [{ prf: { enabled: false } }, /enabled: false/],
    [{ prf: { results: { first: [1, 2, 3] } } }, /väärää muotoa/],
    [{ prf: { results: { first: [256, ...bytes.slice(1)] } } }, /väärää muotoa/],
    [{ prf: { results: { first: 'merkkijono'.repeat(4) } } }, /väärää muotoa/],
  ];
  for (const [ext, why] of bad) {
    const r = prfResult(ext);
    assert.equal(r.output, null);
    assert.match(r.diag, why);
  }
});

test('syy ei paljasta PRF-arvoa', () => {
  const r = prfResult({ prf: { results: { first: bytes.slice(0, 31) } } });
  assert.doesNotMatch(r.diag, new RegExp(String(bytes[5])));
});
