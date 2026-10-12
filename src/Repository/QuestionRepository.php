<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

final class QuestionRepository
{
    public const STATUSES = ['new', 'answered', 'archived'];

    /** Sealed box -yläraja: 2000 merkkiä (UTF-8 enintään 4 tavua/merkki) + metatiedot + 48 tavun ylijäämä. */
    public const CIPHERTEXT_MIN_BYTES = 49;
    public const CIPHERTEXT_MAX_BYTES = 16384;

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    /**
     * Tarkistaa, että arvo on kelvollinen base64-koodattu sealed box.
     * Palvelin ei voi (eikä sen pidä) tarkistaa sisältöä, koska se on salattu.
     */
    public static function isValidCiphertext(mixed $value): bool
    {
        if (!is_string($value) || $value === '' || strlen($value) > 22000) {
            return false;
        }
        if (preg_match('/^[A-Za-z0-9+\/]+={0,2}$/', $value) !== 1) {
            return false;
        }
        $raw = base64_decode($value, true);
        if ($raw === false) {
            return false;
        }
        $len = strlen($raw);
        return $len >= self::CIPHERTEXT_MIN_BYTES && $len <= self::CIPHERTEXT_MAX_BYTES;
    }

    public function add(int $eventId, int $nicknameId, string $ciphertext): int
    {
        $this->db->exec(
            'INSERT INTO questions (event_id, nickname_id, ciphertext, status, created_at) VALUES (?, ?, ?, ?, ?)',
            [$eventId, $nicknameId, $ciphertext, 'new', $this->clock->now()],
        );
        return $this->db->lastId();
    }

    /** @return list<array<string, mixed>> */
    public function forEvent(int $eventId, int $afterId = 0): array
    {
        return $this->db->all(
            'SELECT id, nickname_id, ciphertext, status, created_at FROM questions WHERE event_id = ? AND id > ? ORDER BY id ASC LIMIT 1000',
            [$eventId, $afterId],
        );
    }

    /** @return array<int, string> id => status */
    public function statusesForEvent(int $eventId): array
    {
        $out = [];
        foreach ($this->db->all('SELECT id, status FROM questions WHERE event_id = ?', [$eventId]) as $row) {
            $out[(int) $row['id']] = (string) $row['status'];
        }
        return $out;
    }

    public function countForEvent(int $eventId): int
    {
        $row = $this->db->one('SELECT COUNT(*) AS n FROM questions WHERE event_id = ?', [$eventId]);
        return (int) ($row['n'] ?? 0);
    }

    public function setStatus(int $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new \InvalidArgumentException('Tuntematon tila.');
        }
        return $this->db->exec('UPDATE questions SET status = ? WHERE id = ?', [$status, $id]) === 1;
    }

    public function delete(int $id): bool
    {
        return $this->db->exec('DELETE FROM questions WHERE id = ?', [$id]) === 1;
    }
}
