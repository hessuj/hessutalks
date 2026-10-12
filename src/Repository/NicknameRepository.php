<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

/**
 * Luentokohtaiset, uniikit nimimerkit ilman henkilötietoja.
 *
 * - Palvelin tallentaa vain avaimellisen tiivisteen nimimerkistä (uniikkiuden tarkistus).
 *   Itse nimimerkki kulkee salatun viestin sisällä, joten vain ylläpitäjä näkee sen.
 * - Varaaja saa satunnaisen omistajatunnisteen, jonka selain säilyttää. Palvelin
 *   tallentaa siitä vain SHA-256-tiivisteen. Ilman tunnistetta nimimerkillä ei voi lähettää.
 */
final class NicknameRepository
{
    public const MIN_LEN = 2;
    public const MAX_LEN = 24;
    public const MAX_PER_EVENT = 1000;

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
        private readonly string $appSecret,
    ) {
    }

    /**
     * Palauttaa siistityn nimimerkin tai null, jos muoto ei kelpaa.
     * Sallitut merkit: kirjaimet, numerot, välilyönti, _ . - (ei @, jotta sähköpostiosoitteita ei käytetä).
     */
    public static function clean(mixed $input): ?string
    {
        if (!is_string($input)) {
            return null;
        }
        $nick = trim((string) preg_replace('/\s+/u', ' ', $input));
        if (class_exists(\Normalizer::class)) {
            $nick = (string) \Normalizer::normalize($nick, \Normalizer::FORM_C);
        }
        $len = mb_strlen($nick);
        if ($len < self::MIN_LEN || $len > self::MAX_LEN) {
            return null;
        }
        if (preg_match('/^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u', $nick) !== 1) {
            return null;
        }
        return $nick;
    }

    /** Uniikkiusvertailussa kirjainkoolla, väliviivoilla ja pisteillä ei ole merkitystä. */
    public static function canonical(string $nick): string
    {
        return (string) preg_replace('/[ _.\-]+/u', '', mb_strtolower($nick, 'UTF-8'));
    }

    private function nickHash(int $eventId, string $nick): string
    {
        return hash_hmac('sha256', 'nick|' . $eventId . '|' . self::canonical($nick), $this->appSecret);
    }

    /**
     * Varaa nimimerkin luennolle.
     * @return array{id: int, secret: string}|null null jos nimimerkki on jo käytössä
     */
    public function claim(int $eventId, string $nick): ?array
    {
        $secret = PasskeyRepository::b64urlEncode(random_bytes(32));
        try {
            $this->db->exec(
                'INSERT INTO nicknames (event_id, nick_hash, owner_hash, created_at) VALUES (?, ?, ?, ?)',
                [$eventId, $this->nickHash($eventId, $nick), hash('sha256', $secret), $this->clock->now()],
            );
        } catch (\PDOException $e) {
            if (str_contains($e->getMessage(), 'UNIQUE')) {
                return null;
            }
            throw $e;
        }
        return ['id' => $this->db->lastId(), 'secret' => $secret];
    }

    /** Palauttaa nimimerkin id:n, jos omistajatunniste täsmää. */
    public function verify(int $eventId, string $nick, string $secret): ?int
    {
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $secret) !== 1) {
            return null;
        }
        $row = $this->db->one(
            'SELECT id, owner_hash FROM nicknames WHERE event_id = ? AND nick_hash = ?',
            [$eventId, $this->nickHash($eventId, $nick)],
        );
        if ($row === null || !hash_equals((string) $row['owner_hash'], hash('sha256', $secret))) {
            return null;
        }
        return (int) $row['id'];
    }

    public function countForEvent(int $eventId): int
    {
        $row = $this->db->one('SELECT COUNT(*) AS n FROM nicknames WHERE event_id = ?', [$eventId]);
        return (int) ($row['n'] ?? 0);
    }
}
