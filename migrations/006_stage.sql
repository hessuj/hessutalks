-- Näyttö: useita kysymyksiä yhtä aikaa projektorilla ja osallistujilla (Hessun koeajo 13.11.).
-- on_stage = kysymys on näytöllä. Aktiivinen kysymys (events.active_poll_id) on näytöllä olevista se,
-- jota pikanäppäimet ja puhelinohjain ohjaavat. Vastaukset säilyvät: taulua ei rakenneta uudelleen.
ALTER TABLE polls ADD COLUMN on_stage INTEGER NOT NULL DEFAULT 0 CHECK (on_stage IN (0, 1));
UPDATE polls SET on_stage = 1 WHERE id IN (SELECT active_poll_id FROM events WHERE active_poll_id IS NOT NULL);
