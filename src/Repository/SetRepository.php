<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

/**
 * Luennon kysymyssarjat (moduulit, esim. M1). Sarjoilla on järjestys, ja sarjan voi ohittaa
 * kesken luennon: ohitetun sarjan kysymykset jäävät pois Seuraava/Edellinen-järjestyksestä.
 * Sarjan nimi ja tunniste ovat luennoitsijan julkista sisältöä.
 */
final class SetRepository
{
    public const MAX_PER_EVENT = 50;
    public const TITLE_MAX = 120;

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    /** Tunniste: 1–16 merkkiä A–Z, 0–9, '-' tai '_'. Pienet kirjaimet muutetaan isoiksi. */
    public static function cleanSlug(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $slug = strtoupper(trim($value));
        return preg_match('/^[A-Z0-9][A-Z0-9_-]{0,15}$/', $slug) === 1 ? $slug : null;
    }

    public static function cleanTitle(mixed $value): ?string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
            return null;
        }
        $title = trim((string) preg_replace('/[\p{Cc}\p{Cf}\s]+/u', ' ', $value));
        return $title === '' || mb_strlen($title) > self::TITLE_MAX ? null : $title;
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        $row = $this->db->one('SELECT * FROM poll_sets WHERE id = ?', [$id]);
        return $row === null ? null : self::decode($row);
    }

    /** @return array<string, mixed>|null */
    public function findBySlug(int $eventId, string $slug): ?array
    {
        $row = $this->db->one('SELECT * FROM poll_sets WHERE event_id = ? AND slug = ?', [$eventId, $slug]);
        return $row === null ? null : self::decode($row);
    }

    /** @return list<array<string, mixed>> */
    public function forEvent(int $eventId): array
    {
        return array_map(self::decode(...), $this->db->all(
            'SELECT * FROM poll_sets WHERE event_id = ? ORDER BY position ASC, id ASC',
            [$eventId],
        ));
    }

    /** @return int|string uuden sarjan id tai virheilmoitus */
    public function create(int $eventId, string $slug, string $title): int|string
    {
        if ($this->findBySlug($eventId, $slug) !== null) {
            return 'Luennolla on jo sarja tunnisteella ' . $slug . '.';
        }
        $row = $this->db->one('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxpos FROM poll_sets WHERE event_id = ?', [$eventId]);
        if ((int) ($row['n'] ?? 0) >= self::MAX_PER_EVENT) {
            return 'Luennolla on jo enimmäismäärä sarjoja (' . self::MAX_PER_EVENT . ').';
        }
        $this->db->exec(
            'INSERT INTO poll_sets (event_id, slug, title, position, created_at) VALUES (?, ?, ?, ?, ?)',
            [$eventId, $slug, $title, (int) ($row['maxpos'] ?? 0) + 1, $this->clock->now()],
        );
        return $this->db->lastId();
    }

    /** @return string|null virheilmoitus tai null */
    public function update(int $id, string $slug, string $title): ?string
    {
        $set = $this->find($id);
        if ($set === null) {
            return 'Sarjaa ei löytynyt.';
        }
        $other = $this->findBySlug((int) $set['event_id'], $slug);
        if ($other !== null && $other['id'] !== $id) {
            return 'Luennolla on jo sarja tunnisteella ' . $slug . '.';
        }
        $this->db->exec('UPDATE poll_sets SET slug = ?, title = ? WHERE id = ?', [$slug, $title, $id]);
        return null;
    }

    /**
     * Luo sarjat kysymyksineen yhdessä transaktiossa: joko kaikki tai ei mitään.
     * @param list<array{slug: string, title: string, polls: list<array{type: string, prompt: string, config: array<string, mixed>}>}> $sets
     * @throws \RuntimeException jos jokin luonti epäonnistuu (mitään ei tallennu)
     */
    public function import(int $eventId, array $sets, PollRepository $polls): void
    {
        $pdo = $this->db->pdo();
        $pdo->beginTransaction();
        try {
            foreach ($sets as $set) {
                $setId = $this->create($eventId, $set['slug'], $set['title']);
                if (is_string($setId)) {
                    throw new \RuntimeException($setId);
                }
                foreach ($set['polls'] as $p) {
                    if ($polls->create($eventId, $setId, $p['type'], $p['prompt'], $p['config']) === null) {
                        throw new \RuntimeException('Kysymysten enimmäismäärä täynnä.');
                    }
                }
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e instanceof \RuntimeException ? $e : new \RuntimeException('Tuonti epäonnistui.', 0, $e);
        }
    }

    /** Siirtää sarjaa yhden askeleen (-1 ylös, 1 alas). false = ei voi siirtää. */
    public function move(int $id, int $dir): bool
    {
        $set = $this->find($id);
        if ($set === null || ($dir !== -1 && $dir !== 1)) {
            return false;
        }
        $sets = $this->forEvent((int) $set['event_id']);
        $ids = array_column($sets, 'id');
        $i = array_search($id, $ids, true);
        $j = is_int($i) ? $i + $dir : -1;
        if (!is_int($i) || $j < 0 || $j >= count($ids)) {
            return false;
        }
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        foreach ($ids as $pos => $sid) {
            $this->db->exec('UPDATE poll_sets SET position = ? WHERE id = ?', [$pos + 1, $sid]);
        }
        return true;
    }

    public function setSkipped(int $id, bool $skipped): bool
    {
        return $this->db->exec('UPDATE poll_sets SET skipped = ? WHERE id = ?', [$skipped ? 1 : 0, $id]) === 1;
    }

    /** Poistaa sarjan, sen kysymykset ja vastaukset (ON DELETE CASCADE). */
    public function delete(int $id): bool
    {
        return $this->db->exec('DELETE FROM poll_sets WHERE id = ?', [$id]) === 1;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function decode(array $row): array
    {
        foreach (['id', 'event_id', 'position', 'created_at'] as $k) {
            $row[$k] = (int) $row[$k];
        }
        $row['skipped'] = (bool) $row['skipped'];
        return $row;
    }
}
