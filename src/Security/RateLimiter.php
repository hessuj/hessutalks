<?php

declare(strict_types=1);

namespace HessuTalks\Security;

use HessuTalks\Database;

/**
 * Liukuvan ikkunan rajoitin SQLitessä.
 * Huom: luentosalissa koko ryhmä voi näkyä samana IP-osoitteena (NAT/eduroam),
 * joten osallistujarajat ovat tarkoituksella väljiä.
 */
final class RateLimiter
{
    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
    ) {
    }

    /** Palauttaa true, jos pyyntö sallitaan (ja kirjaa sen). */
    public function hit(string $bucket, int $limit, int $windowSeconds): bool
    {
        $now = $this->clock->now();
        $since = $now - $windowSeconds;

        if (random_int(1, 50) === 1) {
            $this->db->exec('DELETE FROM rate_limits WHERE ts < ?', [$now - 86400]);
        }

        $row = $this->db->one('SELECT COUNT(*) AS n FROM rate_limits WHERE bucket = ? AND ts > ?', [$bucket, $since]);
        $count = (int) ($row['n'] ?? 0);
        if ($count >= $limit) {
            return false;
        }
        $this->db->exec('INSERT INTO rate_limits (bucket, ts) VALUES (?, ?)', [$bucket, $now]);
        return true;
    }

    public function reset(string $bucket): void
    {
        $this->db->exec('DELETE FROM rate_limits WHERE bucket = ?', [$bucket]);
    }
}
