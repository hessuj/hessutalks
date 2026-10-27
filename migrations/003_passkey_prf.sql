-- Avaimen avaus passkeylla (WebAuthn PRF -laajennus).
-- Passkey tuottaa autentikaattorin sisällä salaisen arvon suolasta prf_salt. Arvo ei koskaan
-- lähde selaimesta: selain johtaa siitä avaimen ja salaa sillä ylläpitäjän yksityisestä avaimesta
-- passkey-kohtaisen kopion. Palvelin tallentaa vain suolan (ei salainen) ja salatun kopion.
ALTER TABLE passkeys ADD COLUMN prf_salt TEXT NULL;
ALTER TABLE passkeys ADD COLUMN prf_enc_secret_key TEXT NULL;
ALTER TABLE passkeys ADD COLUMN prf_nonce TEXT NULL;
