<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

/**
 * Osallistujan tilakyselyn staattinen kopio (vaatimus 8: 150 osallistujaa).
 *
 * Jaetulla palvelimella jokainen PHP-pyyntö varaa prosessin, ja tilan prosessiraja täyttyi tuotannon
 * kuormitustestissä 28.10. jo ennen 150:tä osallistujaa. Apache palvelee staattisen
 * tiedoston ilman PHP:tä, joten osallistujien sekunnin välein tekemät tilakyselyt eivät kuormita PHP:tä.
 *
 * - Tiedostossa on sama sisältö kuin /api/live-vastauksessa (ei salattuja vastauksia, ei oikeita
 *   vastauksia ennen paljastusta). Sen voi lukea vain, joka tietää nimen: nimi on avaimellinen tiiviste
 *   luennon id:stä, ja se annetaan luennon sivulla. Luentokoodeja ei voi kokeilla tiedostonimillä.
 * - Kirjoitus on atominen (väliaikainen pistetiedosto + rename), joten osittaista tiedostoa ei näy.
 */
final class LiveFile
{
    public function __construct(
        private readonly string $dir,
        private readonly string $secret,
    ) {
    }

    /** Tiedoston nimi ilman hakemistoa: 32 heksamerkkiä + .json. */
    public function name(int $eventId): string
    {
        return substr(hash_hmac('sha256', 'live-file|' . $eventId, $this->secret), 0, 32) . '.json';
    }

    public function exists(int $eventId): bool
    {
        return is_file($this->path($eventId));
    }

    /** @param array<string, mixed> $state */
    public function write(int $eventId, array $state): bool
    {
        if (!is_dir($this->dir) && !@mkdir($this->dir, 0755, true) && !is_dir($this->dir)) {
            return false;
        }
        $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            return false;
        }
        $tmp = $this->dir . '/.' . $this->name($eventId) . '.' . bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, $json) !== strlen($json)) {
            @unlink($tmp);
            return false;
        }
        // Apache lukee tiedoston eri käyttäjänä kuin PHP kirjoittaa sen.
        @chmod($tmp, 0644);
        if (!@rename($tmp, $this->path($eventId))) {
            @unlink($tmp);
            return false;
        }
        return true;
    }

    public function remove(int $eventId): void
    {
        $path = $this->path($eventId);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    private function path(int $eventId): string
    {
        return $this->dir . '/' . $this->name($eventId);
    }
}
