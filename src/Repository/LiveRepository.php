<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;

/**
 * Näytöllä olevat kysymykset (projektori ja osallistujat) ja niistä aktiivinen.
 *
 * - Näytöllä voi olla useita kysymyksiä yhtä aikaa (Hessun koeajo 13.11.). Vain näytöllä oleva voi olla auki.
 *   Näytöltä poistettu kysymys suljetaan, jos se oli auki. Vastaukset säilyvät aina.
 * - Aktiivinen kysymys on näytöllä olevista se, jota pikanäppäimet ja puhelinohjain ohjaavat.
 * - Seuraava/Edellinen ja aktivointi vaihtavat näytölle yhden kysymyksen: muut poistetaan näytöltä.
 * - Luonnos-tilainen kysymys näkyy esittäjälle, mutta osallistujat eivät näe sitä ennen avaamista.
 * - Seuraava/Edellinen kulkee sarjojen ja kysymysten järjestyksessä ja ohittaa ohitetut sarjat.
 * - live_version kasvaa jokaisesta osallistujille näkyvästä muutoksesta. Osallistujan selain
 *   kysyy tilaa sekunnin välein ja saa lyhyen vastauksen, kun mikään ei ole muuttunut.
 * - Jokainen muutos kirjoittaa osallistujan tilan myös staattiseen tiedostoon (LiveFile), jota selain
 *   lukee ilman PHP:tä. Siksi kaikki osallistujille näkyvät muutokset kulkevat bump()-metodin kautta.
 */
final class LiveRepository
{
    public function __construct(
        private readonly Database $db,
        private readonly ?LiveFile $file = null,
    ) {
    }

    /** Merkitsee, että osallistujien näkymä on muuttunut. */
    public function bump(int $eventId): void
    {
        $this->db->exec('UPDATE events SET live_version = live_version + 1 WHERE id = ?', [$eventId]);
        $this->publish($eventId);
    }

    /**
     * Kirjoittaa osallistujan tilan staattiseen tiedostoon. Suljetun luennon tiedostossa ei ole kysymystä:
     * selain kysyy silloin PHP:ltä, joka vastaa 410 ja kertoo syyn osallistujan kielellä.
     */
    public function publish(int $eventId): void
    {
        if ($this->file === null) {
            return;
        }
        $event = $this->db->one('SELECT id, live_version, active_poll_id, status, closes_at FROM events WHERE id = ?', [$eventId]);
        if ($event === null) {
            $this->file->remove($eventId);
            return;
        }
        $closed = $event['status'] !== 'open';
        $ok = $this->file->write($eventId, [
            'v' => (int) $event['live_version'],
            'poll' => $closed ? null : $this->participantPoll($event),
            'polls' => $closed ? [] : $this->participantPolls($eventId),
            'closed' => $closed,
            'closes_at' => isset($event['closes_at']) ? (int) $event['closes_at'] : null,
        ]);
        if (!$ok) {
            // Selain käyttää silloin /api/live-reittiä: palvelu toimii, mutta kuormittaa PHP:tä.
            error_log('[hessutalks] tilatiedoston kirjoitus epäonnistui (luento ' . $eventId . ')');
        }
    }

    /**
     * Tilatiedoston nimi luennon sivua varten. Sivu kirjoittaa tiedoston aina uudelleen: jos tietokanta on
     * palautettu tai luennon id käytetty uudelleen, samannimisessä tiedostossa voi olla vanha tila.
     * null = ei käytössä tai kirjoitus epäonnistui: selain käyttää silloin suoraan /api/live-reittiä.
     */
    public function fileName(int $eventId): ?string
    {
        if ($this->file === null) {
            return null;
        }
        $this->publish($eventId);
        return $this->file->exists($eventId) ? $this->file->name($eventId) : null;
    }

    /** Kirjoittaa tilatiedoston, jos se puuttuu (/api/live: seuraavat kyselyt menevät taas tiedostoon). */
    public function ensureFile(int $eventId): void
    {
        if ($this->file !== null && !$this->file->exists($eventId)) {
            $this->publish($eventId);
        }
    }

    /** Poistetun luennon tilatiedosto pois (vaatimus 7.8: kaikki tiedot poistuvat). */
    public function forget(int $eventId): void
    {
        $this->file?->remove($eventId);
    }

    public function activeId(int $eventId): ?int
    {
        $row = $this->db->one(
            'SELECT p.id FROM events e JOIN polls p ON p.id = e.active_poll_id AND p.event_id = e.id WHERE e.id = ?',
            [$eventId],
        );
        return $row === null ? null : (int) $row['id'];
    }

    /**
     * Näytöllä olevien kysymysten id:t sarjojen ja kysymysten järjestyksessä.
     * @return list<int>
     */
    public function stageIds(int $eventId): array
    {
        $rows = $this->db->all(
            'SELECT p.id FROM polls p JOIN poll_sets s ON s.id = p.set_id
             WHERE p.event_id = ? AND p.on_stage = 1 ORDER BY s.position ASC, s.id ASC, p.position ASC, p.id ASC',
            [$eventId],
        );
        return array_map(static fn (array $r): int => (int) $r['id'], $rows);
    }

    /**
     * Vaihtaa näytölle vain tämän kysymyksen ja tekee siitä aktiivisen (null = odotusnäkymä).
     * Muut näytöltä poistuvat suljetaan, jos ne olivat auki. false = kysely ei kuulu luennolle.
     */
    public function activate(int $eventId, ?int $pollId): bool
    {
        if ($pollId !== null && !$this->belongs($eventId, $pollId)) {
            return false;
        }
        $this->db->exec(
            "UPDATE polls SET status = 'closed' WHERE event_id = ? AND on_stage = 1 AND status = 'open' AND id IS NOT ?",
            [$eventId, $pollId],
        );
        $this->db->exec('UPDATE polls SET on_stage = CASE WHEN id IS ? THEN 1 ELSE 0 END WHERE event_id = ?', [$pollId, $eventId]);
        $this->db->exec('UPDATE events SET active_poll_id = ? WHERE id = ?', [$pollId, $eventId]);
        if ($pollId !== null) {
            $this->hideBigQr($eventId);
        }
        $this->bump($eventId);
        return true;
    }

    /**
     * Lisää kysymyksen näytölle muiden rinnalle (ja tekee siitä aktiivisen) tai poistaa sen näytöltä.
     * Poistettu suljetaan, jos se oli auki; aktiiviseksi tulee viimeinen näytölle jäävä.
     */
    public function stage(int $eventId, int $pollId, bool $on): bool
    {
        if (!$this->belongs($eventId, $pollId)) {
            return false;
        }
        if ($on) {
            $this->db->exec('UPDATE polls SET on_stage = 1 WHERE id = ?', [$pollId]);
            $this->db->exec('UPDATE events SET active_poll_id = ? WHERE id = ?', [$pollId, $eventId]);
            $this->hideBigQr($eventId);
        } else {
            $this->db->exec("UPDATE polls SET on_stage = 0, status = CASE WHEN status = 'open' THEN 'closed' ELSE status END WHERE id = ?", [$pollId]);
            $this->refocus($eventId, $pollId);
        }
        $this->bump($eventId);
        return true;
    }

    /**
     * Näytölle tuotu kysymys tulee näkyviin: iso QR-koodi peittäisi sen (Hessun koeajo 13.11.: QR jäi päälle
     * edellisestä päivästä, ja näyttö näytti vain koodia). QR:n saa takaisin Q:lla tai napista.
     */
    private function hideBigQr(int $eventId): void
    {
        $this->db->exec('UPDATE events SET show_qr = 0 WHERE id = ?', [$eventId]);
    }

    /** Jos aktiivinen poistui näytöltä, aktiiviseksi tulee viimeinen näytölle jäänyt (tai ei mikään). */
    private function refocus(int $eventId, int $removed): void
    {
        $left = $this->stageIds($eventId);
        $this->db->exec(
            'UPDATE events SET active_poll_id = ? WHERE id = ? AND active_poll_id = ?',
            [$left === [] ? null : $left[count($left) - 1], $eventId, $removed],
        );
    }

    private function belongs(int $eventId, int $pollId): bool
    {
        return $this->db->one('SELECT id FROM polls WHERE id = ? AND event_id = ?', [$pollId, $eventId]) !== null;
    }

    /** Voiko kysymykseen vastata: auki ja näytöllä. */
    public function answerable(int $eventId, int $pollId): bool
    {
        return $this->db->one(
            "SELECT id FROM polls WHERE id = ? AND event_id = ? AND on_stage = 1 AND status = 'open'",
            [$pollId, $eventId],
        ) !== null;
    }

    /**
     * Siirtyy seuraavaan (1) tai edelliseen (-1) kysymykseen, jonka sarjaa ei ole ohitettu.
     * Jos aktiivista ei ole, Seuraava aloittaa ensimmäisestä ja Edellinen viimeisestä.
     * Palauttaa uuden aktiivisen id:n tai null, jos suunnassa ei ole enää kysymyksiä.
     */
    public function step(int $eventId, int $dir): ?int
    {
        $rows = $this->db->all(
            'SELECT p.id, s.skipped FROM polls p JOIN poll_sets s ON s.id = p.set_id
             WHERE p.event_id = ? ORDER BY s.position ASC, s.id ASC, p.position ASC, p.id ASC',
            [$eventId],
        );
        $ids = array_map(static fn (array $r): int => (int) $r['id'], $rows);
        $current = $this->activeId($eventId);
        $i = $current === null ? false : array_search($current, $ids, true);
        $i = is_int($i) ? $i + $dir : ($dir > 0 ? 0 : count($ids) - 1);
        for (; $i >= 0 && $i < count($ids); $i += $dir) {
            if ((int) $rows[$i]['skipped'] === 0) {
                $this->activate($eventId, $ids[$i]);
                return $ids[$i];
            }
        }
        return null;
    }

    /** Avaa kyselyn vastauksille: se tulee näytölle muiden rinnalle ja aktiiviseksi. */
    public function open(int $eventId, int $pollId): bool
    {
        if (!$this->stage($eventId, $pollId, true)) {
            return false;
        }
        $this->db->exec("UPDATE polls SET status = 'open' WHERE id = ?", [$pollId]);
        $this->bump($eventId);
        return true;
    }

    /** Poistaa aktiivisuuden, jos aktiivinen kysymys on poistumassa (kysely tai sen sarja poistetaan). */
    public function forgetPoll(int $eventId, int $pollId): void
    {
        $this->db->exec('UPDATE polls SET on_stage = 0 WHERE id = ? AND event_id = ?', [$pollId, $eventId]);
        $this->refocus($eventId, $pollId);
        $this->bump($eventId);
    }

    public function forgetSet(int $eventId, int $setId): void
    {
        $ids = $this->db->all('SELECT id FROM polls WHERE set_id = ? AND event_id = ?', [$setId, $eventId]);
        $this->db->exec('UPDATE polls SET on_stage = 0 WHERE set_id = ? AND event_id = ?', [$setId, $eventId]);
        foreach ($ids as $r) {
            $this->refocus($eventId, (int) $r['id']);
        }
        $this->bump($eventId);
    }

    /**
     * Osallistujalle näytettävä aktiivinen kysymys: vain julkiset kentät. Luonnos ei näy (odotusnäkymä).
     * Vanhojen osallistujasivujen yhteensopivuus; uudet sivut käyttävät participantPolls()-listaa.
     * @param array<string, mixed> $event
     * @return array<string, mixed>|null
     */
    public function participantPoll(array $event): ?array
    {
        if (!isset($event['active_poll_id'])) {
            return null;
        }
        $row = $this->db->one(
            "SELECT id, type, prompt, config, generation, status, results_visible, revealed, summary FROM polls
             WHERE id = ? AND event_id = ? AND on_stage = 1 AND status IN ('open', 'closed')",
            [(int) $event['active_poll_id'], (int) $event['id']],
        );
        return $row === null ? null : self::publicPoll($row);
    }

    /**
     * Osallistujille näytettävät kysymykset (näytöllä, ei luonnokset) näytön järjestyksessä.
     * @return list<array<string, mixed>>
     */
    public function participantPolls(int $eventId): array
    {
        $rows = $this->db->all(
            "SELECT p.id, p.type, p.prompt, p.config, p.generation, p.status, p.results_visible, p.revealed, p.summary
             FROM polls p JOIN poll_sets s ON s.id = p.set_id
             WHERE p.event_id = ? AND p.on_stage = 1 AND p.status IN ('open', 'closed')
             ORDER BY s.position ASC, s.id ASC, p.position ASC, p.id ASC",
            [$eventId],
        );
        return array_map(self::publicPoll(...), $rows);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function publicPoll(array $row): array
    {
        $config = json_decode((string) $row['config'], true);
        $config = is_array($config) ? $config : [];
        $summary = (int) $row['results_visible'] === 1 && is_string($row['summary']) ? json_decode($row['summary'], true) : null;
        $revealed = (int) $row['revealed'] === 1 && isset($config['correct']);
        return [
            'id' => (int) $row['id'],
            'type' => (string) $row['type'],
            'prompt' => (string) $row['prompt'],
            // Oikeat vastaukset ja selitykset eivät lähde osallistujalle ennen paljastusta.
            'config' => (object) PollRepository::publicConfig($config),
            'generation' => (int) $row['generation'],
            'status' => (string) $row['status'],
            'results' => is_array($summary) ? $summary : null,
            'reveal' => $revealed ? ['correct' => $config['correct'], 'explanations' => $config['explanations'] ?? null] : null,
        ];
    }
}
