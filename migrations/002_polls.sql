-- Kyselyt luennoille: monivalinta, sanapilvi, Likert ja asteikko.
-- Kysymysteksti ja vaihtoehdot ovat luennoitsijan julkista sisältöä (selväkielisenä).
-- Vastaukset salataan osallistujan selaimessa (sealed box), palvelin ei näe niitä.

CREATE TABLE IF NOT EXISTS polls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    type        TEXT    NOT NULL CHECK (type IN ('single', 'multi', 'words', 'likert', 'scale')),
    prompt      TEXT    NOT NULL,
    config      TEXT    NOT NULL DEFAULT '{}',
    status      TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    generation  INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS polls_event ON polls (event_id, status);

-- Yksi vastaus vastaajaa kohden: voter_hash = HMAC(app_secret, kysely + selaimen satunnainen tunniste).
-- Uusi vastaus korvaa vanhan (rivi poistetaan ja lisätään uudella id:llä).
CREATE TABLE IF NOT EXISTS poll_answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id     INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
    voter_hash  TEXT    NOT NULL,
    ciphertext  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    UNIQUE (poll_id, voter_hash)
);
CREATE INDEX IF NOT EXISTS poll_answers_poll ON poll_answers (poll_id, id);
