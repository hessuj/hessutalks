-- HessuTalks: perusskeema
-- Sovellus ei kerää osallistujista henkilötietoja. Viestin sisältö ja nimimerkki
-- tallennetaan VAIN salattuna (libsodium sealed box). Nimimerkin uniikkiutta varten
-- tallennetaan ainoastaan avaimellinen tiiviste (HMAC), ei itse nimimerkkiä.

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    title       TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    created_at  INTEGER NOT NULL,
    closes_at   INTEGER NULL
);

-- Luentokohtaiset nimimerkit. nick_hash = HMAC(app_secret, event_id | normalisoitu nimimerkki).
-- owner_hash = SHA-256 selaimeen annetusta satunnaisesta omistajatunnisteesta.
CREATE TABLE IF NOT EXISTS nicknames (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    nick_hash   TEXT    NOT NULL,
    owner_hash  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (event_id, nick_hash)
);

CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    nickname_id INTEGER NOT NULL REFERENCES nicknames (id) ON DELETE CASCADE,
    ciphertext  TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'answered', 'archived')),
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_event ON questions (event_id, id);
CREATE INDEX IF NOT EXISTS idx_questions_nickname ON questions (nickname_id);

-- Ylläpitäjän salausavainpari. Yksityinen avain on salattu selaimessa
-- tunnuslauseesta johdetulla avaimella (Argon2id + XSalsa20-Poly1305).
CREATE TABLE IF NOT EXISTS admin_keys (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    public_key      TEXT    NOT NULL,
    enc_secret_key  TEXT    NOT NULL,
    nonce           TEXT    NOT NULL,
    salt            TEXT    NOT NULL,
    opslimit        INTEGER NOT NULL,
    memlimit        INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passkeys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    credential_id   TEXT    NOT NULL UNIQUE,
    public_key_pem  TEXT    NOT NULL,
    sign_count      INTEGER NOT NULL DEFAULT 0,
    name            TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    last_used_at    INTEGER NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    bucket  TEXT    NOT NULL,
    ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits ON rate_limits (bucket, ts);

-- Ylläpitäjän tietoturvaloki (vain ylläpitäjän omat kirjautumiset ja toimet).
-- Ei IP-osoitteita selväkielisenä, vain HMAC-tunniste. Osallistujista ei kirjata mitään.
CREATE TABLE IF NOT EXISTS audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    action  TEXT    NOT NULL,
    client  TEXT    NOT NULL,
    detail  TEXT    NOT NULL DEFAULT ''
);
