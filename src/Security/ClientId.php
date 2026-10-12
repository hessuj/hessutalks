<?php

declare(strict_types=1);

namespace HessuTalks\Security;

/**
 * Muuntaa IP-osoitteen avaimelliseksi tiivisteeksi, jotta rate limit ja
 * tietoturvaloki toimivat ilman, että IP-osoitteita tallennetaan selväkielisenä.
 */
final class ClientId
{
    public function __construct(private readonly string $appSecret)
    {
    }

    public function of(string $ip): string
    {
        return substr(hash_hmac('sha256', 'client|' . $ip, $this->appSecret), 0, 32);
    }
}
