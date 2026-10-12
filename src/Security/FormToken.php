<?php

declare(strict_types=1);

namespace HessuTalks\Security;

/**
 * Tilaton, tapahtumaan sidottu lomaketoken osallistujille (ei evästeitä).
 * Muoto: <expires>.<hmac(event_id|expires)>
 * Estää lomakkeen lähettämisen suoraan ilman, että sivu on ladattu,
 * ja sitoo lähetyksen tiettyyn tapahtumaan.
 */
final class FormToken
{
    public const TTL = 43200; // 12 h

    public function __construct(
        private readonly string $appSecret,
        private readonly Clock $clock,
    ) {
    }

    public function issue(int $eventId): string
    {
        $expires = $this->clock->now() + self::TTL;
        return $expires . '.' . $this->mac($eventId, $expires);
    }

    public function verify(string $token, int $eventId): bool
    {
        if (preg_match('/^(\d{1,12})\.([a-f0-9]{64})$/', $token, $m) !== 1) {
            return false;
        }
        $expires = (int) $m[1];
        if ($expires < $this->clock->now()) {
            return false;
        }
        return hash_equals($this->mac($eventId, $expires), $m[2]);
    }

    private function mac(int $eventId, int $expires): string
    {
        return hash_hmac('sha256', 'form|' . $eventId . '|' . $expires, $this->appSecret);
    }
}
