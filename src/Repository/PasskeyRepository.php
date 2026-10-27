<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

final class PasskeyRepository
{
    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    public function count(): int
    {
        $row = $this->db->one('SELECT COUNT(*) AS n FROM passkeys');
        return (int) ($row['n'] ?? 0);
    }

    /** @return list<string> binääriset credential id:t */
    public function allCredentialIds(): array
    {
        $out = [];
        foreach ($this->db->all('SELECT credential_id FROM passkeys') as $row) {
            $raw = self::b64urlDecode((string) $row['credential_id']);
            if ($raw !== null) {
                $out[] = $raw;
            }
        }
        return $out;
    }

    /** @return array<string, mixed>|null */
    public function findByCredentialId(string $rawId): ?array
    {
        return $this->db->one('SELECT * FROM passkeys WHERE credential_id = ?', [self::b64urlEncode($rawId)]);
    }

    /** @return list<array<string, mixed>> */
    public function list(): array
    {
        return array_map(
            static fn (array $r): array => ['prf' => (bool) $r['prf']] + $r,
            $this->db->all('SELECT id, name, created_at, last_used_at, prf_enc_secret_key IS NOT NULL AS prf FROM passkeys ORDER BY id'),
        );
    }

    /**
     * PRF-suolat kirjautumisen haasteeseen: credential id (base64url) => suola (base64url).
     * Suola luodaan passkeylle ensimmäisellä kerralla. Se ei ole salainen.
     *
     * @return array<string, string>
     */
    public function prfSalts(): array
    {
        $out = [];
        foreach ($this->db->all('SELECT id, credential_id, prf_salt FROM passkeys ORDER BY id') as $row) {
            $salt = $row['prf_salt'];
            if (!is_string($salt)) {
                $salt = self::b64urlEncode(random_bytes(32));
                $this->db->exec('UPDATE passkeys SET prf_salt = ? WHERE id = ? AND prf_salt IS NULL', [$salt, (int) $row['id']]);
            }
            $out[(string) $row['credential_id']] = $salt;
        }
        return $out;
    }

    /** @return array{enc_secret_key: string, nonce: string}|null */
    public function prfWrap(int $id): ?array
    {
        $row = $this->db->one('SELECT prf_enc_secret_key, prf_nonce FROM passkeys WHERE id = ?', [$id]);
        if ($row === null || !is_string($row['prf_enc_secret_key']) || !is_string($row['prf_nonce'])) {
            return null;
        }
        return ['enc_secret_key' => $row['prf_enc_secret_key'], 'nonce' => $row['prf_nonce']];
    }

    public function setPrfWrap(int $id, string $encSecretKey, string $nonce): bool
    {
        return $this->db->exec(
            'UPDATE passkeys SET prf_enc_secret_key = ?, prf_nonce = ? WHERE id = ? AND prf_salt IS NOT NULL',
            [$encSecretKey, $nonce, $id],
        ) === 1;
    }

    public function clearPrfWrap(int $id): bool
    {
        return $this->db->exec('UPDATE passkeys SET prf_enc_secret_key = NULL, prf_nonce = NULL WHERE id = ?', [$id]) === 1;
    }

    public function add(string $rawId, string $publicKeyPem, int $signCount, string $name): void
    {
        $this->db->exec(
            'INSERT INTO passkeys (credential_id, public_key_pem, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?)',
            [self::b64urlEncode($rawId), $publicKeyPem, $signCount, mb_substr($name, 0, 60), $this->clock->now()],
        );
    }

    public function touch(int $id, int $signCount): void
    {
        $this->db->exec('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?', [$signCount, $this->clock->now(), $id]);
    }

    /** Viimeistä passkeyta ei voi poistaa, ettei ylläpitäjä lukitse itseään ulos. */
    public function delete(int $id): bool
    {
        if ($this->count() <= 1) {
            return false;
        }
        return $this->db->exec('DELETE FROM passkeys WHERE id = ?', [$id]) === 1;
    }

    public static function b64urlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function b64urlDecode(string $s): ?string
    {
        if (preg_match('/^[A-Za-z0-9_-]*$/', $s) !== 1) {
            return null;
        }
        $raw = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
        return $raw === false ? null : $raw;
    }
}
