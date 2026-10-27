-- Kysymyssarjat (moduulit) ja aktiivinen kysymys.
-- Luento koostuu sarjoista (esim. M1, M4), joilla on järjestys ja jotka voi ohittaa kesken luennon.
-- Kerrallaan korkeintaan yksi kysymys on aktiivinen: kaikki osallistujat näkevät sen.

CREATE TABLE IF NOT EXISTS poll_sets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    slug        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    position    INTEGER NOT NULL,
    skipped     INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
    created_at  INTEGER NOT NULL,
    UNIQUE (event_id, slug)
);
CREATE INDEX IF NOT EXISTS poll_sets_event ON poll_sets (event_id, position);

ALTER TABLE polls ADD COLUMN set_id INTEGER NULL REFERENCES poll_sets (id) ON DELETE CASCADE;
ALTER TABLE polls ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- active_poll_id: aktiivinen kysymys (NULL = odotusnäkymä). live_version kasvaa jokaisesta
-- osallistujille näkyvästä muutoksesta, jolloin osallistujan kysely voidaan vastata lyhyesti.
-- lang: osallistujan sivun oletuskieli (NULL = selaimen kieli).
ALTER TABLE events ADD COLUMN active_poll_id INTEGER NULL;
ALTER TABLE events ADD COLUMN live_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN lang TEXT NULL CHECK (lang IN ('fi', 'en'));

-- Aiemmat kyselyt siirtyvät luentokohtaiseen sarjaan luontijärjestyksessä.
-- Monta yhtä aikaa auki ollutta kyselyä ei enää sallita: auki jäävät suljetaan.
INSERT INTO poll_sets (event_id, slug, title, position, created_at)
    SELECT DISTINCT event_id, 'KYSELYT', 'Kyselyt', 1, CAST(strftime('%s', 'now') AS INTEGER) FROM polls;
UPDATE polls SET
    set_id = (SELECT s.id FROM poll_sets s WHERE s.event_id = polls.event_id AND s.slug = 'KYSELYT'),
    position = id,
    status = CASE WHEN status = 'open' THEN 'closed' ELSE status END;
CREATE INDEX IF NOT EXISTS polls_set ON polls (set_id, position);
