<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

/**
 * Ylläpitäjän julkinen avain ja salattu yksityinen avain.
 * Palvelin säilyttää yksityisen avaimen vain salattuna eikä koskaan näe tunnuslausetta.
 */
final class KeyRepository
{
    public const OPSLIMIT_MIN = 2;
    public const OPSLIMIT_MAX = 10;
    public const MEMLIMIT_MIN = 33554432;    // 32 MiB
    public const MEMLIMIT_MAX = 1073741824;  // 1 GiB

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    /** @return array<string, mixed>|null */
    public function get(): ?array
    {
        return $this->db->one('SELECT public_key, enc_secret_key, nonce, salt, opslimit, memlimit, created_at FROM admin_keys WHERE id = 1');
    }

    public function publicKey(): ?string
    {
        $row = $this->get();
        return $row === null ? null : (string) $row['public_key'];
    }

    public static function fingerprint(string $publicKeyB64): string
    {
        $raw = base64_decode($publicKeyB64, true);
        $hex = strtoupper(substr(hash('sha256', $raw === false ? '' : $raw), 0, 20));
        return implode(' ', str_split($hex, 4));
    }

    /**
     * @param array<string, mixed> $in
     * @return string|null virheviesti tai null jos ok
     */
    public static function validate(array $in): ?string
    {
        $b64 = static function (mixed $v, int $len): bool {
            if (!is_string($v)) {
                return false;
            }
            $raw = base64_decode($v, true);
            return $raw !== false && strlen($raw) === $len;
        };
        if (!$b64($in['public_key'] ?? null, SODIUM_CRYPTO_BOX_PUBLICKEYBYTES)) {
            return 'Virheellinen julkinen avain.';
        }
        // Salattu yksityinen avain = 32 tavua + 16 tavun MAC.
        if (!$b64($in['enc_secret_key'] ?? null, SODIUM_CRYPTO_BOX_SECRETKEYBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES)) {
            return 'Virheellinen salattu avain.';
        }
        if (!$b64($in['nonce'] ?? null, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES)) {
            return 'Virheellinen nonce.';
        }
        if (!$b64($in['salt'] ?? null, SODIUM_CRYPTO_PWHASH_SALTBYTES)) {
            return 'Virheellinen suola.';
        }
        $ops = $in['opslimit'] ?? null;
        $mem = $in['memlimit'] ?? null;
        if (!is_int($ops) || $ops < self::OPSLIMIT_MIN || $ops > self::OPSLIMIT_MAX) {
            return 'Virheellinen opslimit.';
        }
        if (!is_int($mem) || $mem < self::MEMLIMIT_MIN || $mem > self::MEMLIMIT_MAX) {
            return 'Virheellinen memlimit.';
        }
        return null;
    }

    /**
     * Tallentaa avaimet vain, jos niitä ei vielä ole. Avaimen vaihto vaatisi
     * kaikkien vanhojen kysymysten uudelleensalauksen, joten sitä ei sallita API:n kautta.
     *
     * @param array<string, mixed> $in validoitu syöte
     */
    public function createOnce(array $in): bool
    {
        if ($this->get() !== null) {
            return false;
        }
        $this->db->exec(
            'INSERT INTO admin_keys (id, public_key, enc_secret_key, nonce, salt, opslimit, memlimit, created_at)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
            [
                (string) $in['public_key'], (string) $in['enc_secret_key'], (string) $in['nonce'],
                (string) $in['salt'], (int) $in['opslimit'], (int) $in['memlimit'], $this->clock->now(),
            ],
        );
        return true;
    }

    /**
     * Tunnuslauseen vaihto: sama avainpari, uusi salaus. Julkisen avaimen on täsmättävä.
     *
     * @param array<string, mixed> $in validoitu syöte
     */
    public function rewrap(array $in): bool
    {
        $current = $this->get();
        if ($current === null || !hash_equals((string) $current['public_key'], (string) $in['public_key'])) {
            return false;
        }
        return $this->db->exec(
            'UPDATE admin_keys SET enc_secret_key = ?, nonce = ?, salt = ?, opslimit = ?, memlimit = ? WHERE id = 1',
            [(string) $in['enc_secret_key'], (string) $in['nonce'], (string) $in['salt'], (int) $in['opslimit'], (int) $in['memlimit']],
        ) === 1;
    }
}
