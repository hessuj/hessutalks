// Kryptografian yhteentoimivuustesti (node --test tests/js/).
// Varmistaa, että vendoroitu libsodium toimii ja että selaimen salausformaatti
// (sealed box + Argon2id-suojattu yksityinen avain) avautuu kuten admin.js olettaa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function load(file) {
  const s = require(`../../public/assets/vendor/${file}`);
  await s.ready;
  return s;
}

test('osallistujan sealed box avautuu ylläpitäjän avaimella', async () => {
  const lite = await load('sodium.js');        // osallistujan sivun kirjasto
  const sumo = await load('sodium-sumo.js');   // ylläpitäjän sivun kirjasto
  const kp = sumo.crypto_box_keypair();
  const payload = JSON.stringify({ v: 2, e: 'ABC234', n: 'Äijä_7', k: 'question', t: 'Mitä on zero trust? 🔐' });
  const ct = lite.to_base64(lite.crypto_box_seal(lite.from_string(payload), kp.publicKey), lite.base64_variants.ORIGINAL);
  const opened = sumo.crypto_box_seal_open(sumo.from_base64(ct, sumo.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey);
  assert.equal(sumo.to_string(opened), payload);
});

test('väärä avain ei avaa viestiä', async () => {
  const s = await load('sodium-sumo.js');
  const a = s.crypto_box_keypair();
  const b = s.crypto_box_keypair();
  const ct = s.crypto_box_seal(s.from_string('salainen'), a.publicKey);
  assert.throws(() => s.crypto_box_seal_open(ct, b.publicKey, b.privateKey));
});

test('tunnuslauseella suojattu yksityinen avain: oikea avaa, väärä ei', async () => {
  const s = await load('sodium-sumo.js');
  const kp = s.crypto_box_keypair();
  const salt = s.randombytes_buf(s.crypto_pwhash_SALTBYTES);
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const derive = (pw) => s.crypto_pwhash(s.crypto_secretbox_KEYBYTES, pw, salt, 3, 64 * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13);
  const enc = s.crypto_secretbox_easy(kp.privateKey, nonce, derive('oikein-pitka-tunnuslause'));
  assert.equal(enc.length, 48, 'palvelin odottaa 32 + 16 tavua');
  const sk = s.crypto_secretbox_open_easy(enc, nonce, derive('oikein-pitka-tunnuslause'));
  assert.equal(s.compare(s.crypto_scalarmult_base(sk), kp.publicKey), 0);
  assert.throws(() => s.crypto_secretbox_open_easy(enc, nonce, derive('väärä tunnuslause')));
});
