-- Puhelinohjain (issue #63).
-- board_clears kasvaa jokaisesta taulun tyhjennyksestä: läppärin hallinta poistaa silloin taululta myös viestit,
-- jotka se itse sinne nosti (viestit puretaan vain läppärissä, joten palvelin ei tiedä niistä).
-- screen_seen_at = milloin läppärin hallinta viimeksi ilmoitti esitysnäytön olevan yhteydessä (Unix-aika).
ALTER TABLE events ADD COLUMN board_clears INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN screen_seen_at INTEGER;
