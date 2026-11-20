-- hessutalks:foreign-keys-off
-- Pidetyt luennot säilytetään kokonaisina, mutta erotellaan aktiivisesta luettelosta.
ALTER TABLE events ADD COLUMN archived_at INTEGER NULL;

CREATE TABLE events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
    created_at INTEGER NOT NULL,
    closes_at INTEGER NULL,
    lang TEXT NULL CHECK (lang IN ('fi', 'en')),
    live_version INTEGER NOT NULL DEFAULT 0,
    active_poll_id INTEGER NULL,
    show_qr INTEGER NOT NULL DEFAULT 0 CHECK (show_qr IN (0, 1)),
    board_clears INTEGER NOT NULL DEFAULT 0,
    screen_seen_at INTEGER NULL,
    archived_at INTEGER NULL
);

INSERT INTO events_new (
    id, code, title, status, created_at, closes_at, lang, live_version,
    active_poll_id, show_qr, board_clears, screen_seen_at, archived_at
)
SELECT
    id, code, title, status, created_at, closes_at, lang,
    COALESCE(live_version, 0),
    active_poll_id,
    COALESCE(show_qr, 0),
    COALESCE(board_clears, 0),
    screen_seen_at,
    archived_at
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
