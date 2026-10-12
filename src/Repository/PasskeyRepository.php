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
        return $this->db->all('SELECT id, name, created_at, last_used_at FROM passkeys ORDER BY id');
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
