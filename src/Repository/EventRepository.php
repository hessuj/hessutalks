<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

final class EventRepository
{
    /** Ei sekoittuvia merkkejä (0/O, 1/I/L). 31^6 ≈ 887 miljoonaa yhdistelmää. */
    public const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    public const CODE_LENGTH = 6;
    public const TITLE_MAX = 120;

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    public static function generateCode(): string
    {
        $max = strlen(self::CODE_ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::CODE_LENGTH; $i++) {
            $code .= self::CODE_ALPHABET[random_int(0, $max)];
        }
        return $code;
    }

    public static function normalizeCode(string $input): ?string
    {
        $code = strtoupper(preg_replace('/[\s-]+/', '', $input) ?? '');
        $pattern = '/^[' . self::CODE_ALPHABET . ']{' . self::CODE_LENGTH . '}$/';
        return preg_match($pattern, $code) === 1 ? $code : null;
    }

    /**
     * @param string|null $lang osallistujan sivun oletuskieli (fi/en) tai null = selaimen kieli
     * @return array<string, mixed>
     */
    public function create(string $title, ?int $durationHours, ?string $lang = null): array
    {
        if ($lang !== null && !in_array($lang, ['fi', 'en'], true)) {
            throw new \InvalidArgumentException('Tuntematon kieli.');
        }
        $title = trim($title);
        if ($title === '' || mb_strlen($title) > self::TITLE_MAX) {
            throw new \InvalidArgumentException('Otsikon pituus 1–' . self::TITLE_MAX . ' merkkiä.');
        }
        $now = $this->clock->now();
        $closesAt = $durationHours !== null ? $now + $durationHours * 3600 : null;

        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = self::generateCode();
            if ($this->db->one('SELECT id FROM events WHERE code = ?', [$code]) !== null) {
                continue;
            }
            $this->db->exec(
                'INSERT INTO events (code, title, status, created_at, closes_at, lang) VALUES (?, ?, ?, ?, ?, ?)',
                [$code, $title, 'open', $now, $closesAt, $lang],
            );
            $event = $this->find($this->db->lastId());
            if ($event === null) {
                break;
            }
            return $event;
        }
        throw new \RuntimeException('Koodin luonti epäonnistui.');
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        return $this->db->one('SELECT * FROM events WHERE id = ?', [$id]);
    }

    /** @return array<string, mixed>|null */
    public function findByCode(string $code): ?array
    {
        return $this->db->one('SELECT * FROM events WHERE code = ?', [$code]);
    }

    /** @return list<array<string, mixed>> */
    public function all(): array
    {
        return $this->db->all(
            'SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.event_id = e.id) AS question_count,
                    (SELECT COUNT(*) FROM questions q WHERE q.event_id = e.id AND q.status = \'new\') AS new_count
             FROM events e ORDER BY e.created_at DESC, e.id DESC',
        );
    }

    /** @param array<string, mixed> $event */
    public function isOpen(array $event): bool
    {
        if (($event['status'] ?? '') !== 'open') {
            return false;
        }
        $closesAt = $event['closes_at'] ?? null;
        return $closesAt === null || (int) $closesAt > $this->clock->now();
    }

    public function setStatus(int $id, string $status): bool
    {
        if (!in_array($status, ['open', 'closed'], true)) {
            throw new \InvalidArgumentException('Tuntematon tila.');
        }
        // Avattaessa uudelleen poistetaan mahdollinen vanhentunut sulkeutumisaika.
        $sql = $status === 'open'
            ? 'UPDATE events SET status = ?, closes_at = NULL WHERE id = ?'
            : 'UPDATE events SET status = ? WHERE id = ?';
        return $this->db->exec($sql, [$status, $id]) === 1;
    }

    /** Projektorin iso QR-koodi (ohjattavissa myös puhelimen ohjaimesta). */
    public function setShowQr(int $id, bool $show): bool
    {
        return $this->db->exec('UPDATE events SET show_qr = ? WHERE id = ?', [$show ? 1 : 0, $id]) === 1;
    }

    public function setLang(int $id, ?string $lang): bool
    {
        if ($lang !== null && !in_array($lang, ['fi', 'en'], true)) {
            throw new \InvalidArgumentException('Tuntematon kieli.');
        }
        return $this->db->exec('UPDATE events SET lang = ? WHERE id = ?', [$lang, $id]) === 1;
    }

    public function delete(int $id): bool
    {
        return $this->db->exec('DELETE FROM events WHERE id = ?', [$id]) === 1;
    }
}
