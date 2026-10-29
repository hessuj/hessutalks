<?php

declare(strict_types=1);

namespace HessuTalks;

/**
 * Sovelluksen asetukset. Tuotannossa luetaan tiedostosta, joka sijaitsee
 * webroot-hakemiston ULKOPUOLELLA (esim. ~/hessutalks-data/config.php).
 */
final class Config
{
    /**
     * @param string $basePath      Polku, jossa sovellus näkyy, esim. "/softa/hessutalks" (ei kauttaviivaa lopussa)
     * @param string $publicOrigin  Julkinen origin, esim. "https://example.com"
     * @param string $rpId          WebAuthn relying party id, esim. "example.com"
     * @param string $appSecret     32 tavun satunnainen salaisuus heksana (HMAC-tunnisteet ja lomaketokenit)
     * @param string $setupTokenHash password_hash() ensimmäisen passkeyn rekisteröintitokenista
     */
    public function __construct(
        public readonly string $basePath,
        public readonly string $publicOrigin,
        public readonly string $rpId,
        public readonly string $dbPath,
        public readonly string $sessionPath,
        public readonly string $appSecret,
        public readonly string $setupTokenHash,
        public readonly string $adminName = 'Hessu',
        public readonly bool $cookieSecure = true,
        public readonly int $adminIdleTimeout = 1800,
        public readonly int $adminAbsoluteTimeout = 28800,
    ) {
        if (strlen($appSecret) < 64 || !ctype_xdigit($appSecret)) {
            throw new \InvalidArgumentException('app_secret pitää olla vähintään 32 tavua heksana.');
        }
        if ($basePath !== '' && (!str_starts_with($basePath, '/') || str_ends_with($basePath, '/'))) {
            throw new \InvalidArgumentException('base_path pitää alkaa kauttaviivalla eikä päättyä siihen.');
        }
    }

    /** @param array<string, mixed> $c */
    public static function fromArray(array $c): self
    {
        $str = static function (string $k, ?string $default = null) use ($c): string {
            $v = $c[$k] ?? $default;
            if (!is_string($v)) {
                throw new \InvalidArgumentException("Asetus '$k' puuttuu tai on virheellinen.");
            }
            return $v;
        };

        return new self(
            basePath: $str('base_path'),
            publicOrigin: rtrim($str('public_origin'), '/'),
            rpId: $str('rp_id'),
            dbPath: $str('db_path'),
            sessionPath: $str('session_path'),
            appSecret: $str('app_secret'),
            setupTokenHash: $str('setup_token_hash', ''),
            adminName: $str('admin_name', 'Hessu'),
            cookieSecure: (bool) ($c['cookie_secure'] ?? true),
            adminIdleTimeout: (int) ($c['admin_idle_timeout'] ?? 1800),
            adminAbsoluteTimeout: (int) ($c['admin_absolute_timeout'] ?? 28800),
        );
    }

    public static function fromFile(string $path): self
    {
        if (!is_file($path)) {
            throw new \RuntimeException('Asetustiedostoa ei löydy.');
        }
        /** @var mixed $data */
        $data = require $path;
        if (!is_array($data)) {
            throw new \RuntimeException('Asetustiedoston pitää palauttaa taulukko.');
        }
        /** @var array<string, mixed> $data */
        return self::fromArray($data);
    }

    public function url(string $path = '/'): string
    {
        return $this->basePath . $path;
    }
}
