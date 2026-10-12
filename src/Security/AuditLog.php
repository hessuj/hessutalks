<?php

declare(strict_types=1);

namespace HessuTalks\Security;

use HessuTalks\Database;

final class AuditLog
{
    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    public function record(string $action, string $client, string $detail = ''): void
    {
        $this->db->exec(
            'INSERT INTO audit_log (ts, action, client, detail) VALUES (?, ?, ?, ?)',
            [$this->clock->now(), $action, $client, mb_substr($detail, 0, 200)],
        );
        if (random_int(1, 100) === 1) {
            // Säilytetään loki 180 päivää.
            $this->db->exec('DELETE FROM audit_log WHERE ts < ?', [$this->clock->now() - 180 * 86400]);
        }
    }

    /** @return list<array<string, mixed>> */
    public function recent(int $limit = 50): array
    {
        return $this->db->all('SELECT ts, action, client, detail FROM audit_log ORDER BY id DESC LIMIT ?', [$limit]);
    }
}
