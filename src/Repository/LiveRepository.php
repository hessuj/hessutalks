<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;

/**
 * Luennon aktiivinen kysymys: kerrallaan korkeintaan yksi, ja kaikki osallistujat näkevät sen.
 *
 * - Vain aktiivinen kysymys voi olla auki. Kun aktiivinen vaihtuu, edellinen suljetaan, jos se oli auki.
 * - Luonnos-tilainen aktiivinen kysymys näkyy esittäjälle, mutta osallistujat näkevät odotusnäkymän.
 * - Seuraava/Edellinen kulkee sarjojen ja kysymysten järjestyksessä ja ohittaa ohitetut sarjat.
 * - live_version kasvaa jokaisesta osallistujille näkyvästä muutoksesta. Osallistujan selain
 *   kysyy tilaa sekunnin välein ja saa lyhyen vastauksen, kun mikään ei ole muuttunut.
 */
final class LiveRepository
{
    public function __construct(
        private readonly Database $db,
    ) {
    }

    /** Merkitsee, että osallistujien näkymä on muuttunut. */
    public function bump(int $eventId): void
    {
        $this->db->exec('UPDATE events SET live_version = live_version + 1 WHERE id = ?', [$eventId]);
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
     * Asettaa aktiivisen kysymyksen (null = odotusnäkymä). Edellinen aktiivinen suljetaan, jos se oli auki.
     * false = kysely ei kuulu luennolle.
     */
    public function activate(int $eventId, ?int $pollId): bool
    {
        if ($pollId !== null && $this->db->one('SELECT id FROM polls WHERE id = ? AND event_id = ?', [$pollId, $eventId]) === null) {
            return false;
        }
        $current = $this->activeId($eventId);
        if ($current !== null && $current !== $pollId) {
            $this->db->exec("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'open'", [$current]);
        }
        $this->db->exec('UPDATE events SET active_poll_id = ? WHERE id = ?', [$pollId, $eventId]);
        $this->bump($eventId);
        return true;
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

    /** Avaa kyselyn vastauksille ja tekee siitä aktiivisen. */
    public function open(int $eventId, int $pollId): bool
    {
        if (!$this->activate($eventId, $pollId)) {
            return false;
        }
        $this->db->exec("UPDATE polls SET status = 'open' WHERE id = ?", [$pollId]);
        $this->bump($eventId);
        return true;
    }

    /** Poistaa aktiivisuuden, jos aktiivinen kysymys on poistumassa (kysely tai sen sarja poistetaan). */
    public function forgetPoll(int $eventId, int $pollId): void
    {
        $this->db->exec('UPDATE events SET active_poll_id = NULL WHERE id = ? AND active_poll_id = ?', [$eventId, $pollId]);
        $this->bump($eventId);
    }

    public function forgetSet(int $eventId, int $setId): void
    {
        $this->db->exec(
            'UPDATE events SET active_poll_id = NULL WHERE id = ? AND active_poll_id IN (SELECT id FROM polls WHERE set_id = ?)',
            [$eventId, $setId],
        );
        $this->bump($eventId);
    }

    /**
     * Osallistujalle näytettävä aktiivinen kysymys: vain julkiset kentät. Luonnos ei näy (odotusnäkymä).
     * @param array<string, mixed> $event
     * @return array<string, mixed>|null
     */
    public function participantPoll(array $event): ?array
    {
        if (!isset($event['active_poll_id'])) {
            return null;
        }
        $row = $this->db->one(
            "SELECT id, type, prompt, config, generation, status FROM polls
             WHERE id = ? AND event_id = ? AND status IN ('open', 'closed')",
            [(int) $event['active_poll_id'], (int) $event['id']],
        );
        if ($row === null) {
            return null;
        }
        $config = json_decode((string) $row['config'], true);
        return [
            'id' => (int) $row['id'],
            'type' => (string) $row['type'],
            'prompt' => (string) $row['prompt'],
            // Oikeat vastaukset ja selitykset eivät lähde osallistujalle.
            'config' => (object) PollRepository::publicConfig(is_array($config) ? $config : []),
            'generation' => (int) $row['generation'],
            'status' => (string) $row['status'],
        ];
    }
}
