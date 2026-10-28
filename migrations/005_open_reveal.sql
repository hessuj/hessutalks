-- hessutalks:foreign-keys-off
-- Avoin teksti (type 'open'), pysyvä moderointi, tulosten näyttö ja oikean vastauksen paljastus.
-- SQLite ei osaa muuttaa CHECK-ehtoa, joten polls rakennetaan uudelleen (sama id, vastaukset säilyvät).
--
-- moderation: luennoitsijan piilotukset (vastaukset, sanat, hyväksytyt) salattuna luennoitsijan
--             julkisella avaimella (sealed box). Palvelin ei näe piilotettuja sanoja.
-- results_visible / revealed: tulokset näkyvissä / oikea vastaus paljastettu (projektori ja osallistujat).
-- summary: tuloskooste osallistujille (pylväiden määrät, keskiarvo), jonka luennoitsijan selain julkaisee,
--          kun tulokset ovat näkyvissä. Vain monivalinnat ja asteikot; ei avoimia vastauksia eikä sanapilveä.
CREATE TABLE polls_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id         INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    type             TEXT    NOT NULL CHECK (type IN ('single', 'multi', 'words', 'likert', 'scale', 'open')),
    prompt           TEXT    NOT NULL,
    config           TEXT    NOT NULL DEFAULT '{}',
    status           TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    generation       INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    set_id           INTEGER NULL REFERENCES poll_sets (id) ON DELETE CASCADE,
    position         INTEGER NOT NULL DEFAULT 0,
    moderation       TEXT    NULL,
    results_visible  INTEGER NOT NULL DEFAULT 0 CHECK (results_visible IN (0, 1)),
    revealed         INTEGER NOT NULL DEFAULT 0 CHECK (revealed IN (0, 1)),
    summary          TEXT    NULL
);
INSERT INTO polls_new (id, event_id, type, prompt, config, status, generation, created_at, updated_at, set_id, position)
    SELECT id, event_id, type, prompt, config, status, generation, created_at, updated_at, set_id, position FROM polls;
DROP TABLE polls;
ALTER TABLE polls_new RENAME TO polls;
CREATE INDEX polls_event ON polls (event_id, status);
CREATE INDEX polls_set ON polls (set_id, position);

-- Projektorin iso QR-koodi (ohjattavissa myös puhelimesta).
ALTER TABLE events ADD COLUMN show_qr INTEGER NOT NULL DEFAULT 0 CHECK (show_qr IN (0, 1));
