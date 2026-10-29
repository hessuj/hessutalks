<?php

declare(strict_types=1);

namespace HessuTalks;

use HessuTalks\Auth\LbuchsWebAuthn;
use HessuTalks\Http\Request;
use HessuTalks\Security\Clock;
use HessuTalks\Security\NativeSession;

/**
 * Tuotantokäynnistys. Polut:
 *   <sovelluskansio>/                 index.php ja assets (FTP-deployn juuri)
 *   <sovelluskansio>/app/             sovelluskoodi (src, vendor, templates, migrations), suora pääsy estetty
 *   ~/hessutalks-data/                config.php, SQLite-kanta, istunnot – webrootin ulkopuolella,
 *                                     deploy ei koske tähän
 */
final class Bootstrap
{
    /** $publicDir: index.php:n hakemisto (webroot), jonne kirjoitetaan osallistujien tilatiedostot (live/). */
    public static function run(string $appRoot, string $configFile, ?string $publicDir = null): void
    {
        ini_set('display_errors', '0');
        ini_set('expose_php', '0');
        header_remove('X-Powered-By');

        $config = Config::fromFile($configFile);
        $db = new Database($config->dbPath, $appRoot . '/migrations');
        $session = new NativeSession($config->sessionPath, $config->basePath . '/admin', $config->cookieSecure);
        $app = new App($config, $db, $session, new LbuchsWebAuthn('HessuTalks', $config->rpId), new Clock(), $appRoot, $publicDir === null ? null : $publicDir . '/live');
        $app->onError(static function (\Throwable $e): void {
            error_log('[hessutalks] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        });
        $app->handle(Request::fromGlobals($config->basePath))->send();
    }
}
