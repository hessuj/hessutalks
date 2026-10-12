<?php

declare(strict_types=1);

namespace HessuTalks;

use HessuTalks\Auth\LbuchsWebAuthn;
use HessuTalks\Http\Request;
use HessuTalks\Security\Clock;
use HessuTalks\Security\NativeSession;

/**
 * Tuotantokäynnistys. Polut:
 *   ~/public_html/softa/hessutalks/   julkinen hakemisto (index.php, assets)
 *   ~/hessutalks-app/                 sovelluskoodi (src, vendor, templates, migrations)
 *   ~/hessutalks-data/                config.php, SQLite-kanta, istunnot (EI deployn ylikirjoittama)
 */
final class Bootstrap
{
    public static function run(string $appRoot, string $configFile): void
    {
        ini_set('display_errors', '0');
        ini_set('expose_php', '0');
        header_remove('X-Powered-By');

        $config = Config::fromFile($configFile);
        $db = new Database($config->dbPath, $appRoot . '/migrations');
        $session = new NativeSession($config->sessionPath, $config->basePath . '/admin', $config->cookieSecure);
        $app = new App($config, $db, $session, new LbuchsWebAuthn('HessuTalks', $config->rpId), new Clock(), $appRoot);
        $app->onError(static function (\Throwable $e): void {
            error_log('[hessutalks] ' . $e::class . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        });
        $app->handle(Request::fromGlobals($config->basePath))->send();
    }
}
