<?php

/**
 * Luo HessuTalksin asetustiedoston ja kertakäyttöisen käyttöönottotunnuksen.
 *
 * Tuotanto, cPanelin Terminalissa (suositeltu – asetukset syntyvät suoraan oikeaan paikkaan):
 *   php ~/public_html/hessutalks/app/bin/init.php --origin=https://example.com --base=/hessutalks
 *   -> luo ~/hessutalks-data/config.php (kotihakemistoon, EI sivuston kansioon)
 *
 * Valinnaiset: --data=<hakemisto> (oletus ~/hessutalks-data), --out=<tiedosto> (oletus <data>/config.php)
 *
 * Kehitys:
 *   php bin/init.php --dev
 *   -> luo var/config.php ja tulostaa käynnistyskomennon
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$opts = getopt('', ['dev', 'origin:', 'base:', 'data:', 'out:', 'rp-id:', 'name:', 'force']);
$dev = isset($opts['dev']);
$root = dirname(__DIR__);

if ($dev) {
    $origin = 'http://localhost:8080';
    $base = '';
    $dataDir = $root . '/var';
    $out = $dataDir . '/config.php';
    $rpId = 'localhost';
} else {
    foreach (['origin', 'base'] as $req) {
        if (!isset($opts[$req]) || !is_string($opts[$req])) {
            fwrite(STDERR, "Puuttuu --$req\n");
            exit(2);
        }
    }
    $origin = rtrim((string) $opts['origin'], '/');
    $base = rtrim((string) $opts['base'], '/');
    $home = getenv('HOME');
    if (is_string($opts['data'] ?? null)) {
        $dataDir = rtrim($opts['data'], '/');
    } elseif (is_string($home) && $home !== '') {
        $dataDir = rtrim($home, '/') . '/hessutalks-data';
    } else {
        fwrite(STDERR, "Kotihakemistoa ei tunnistettu. Anna --data=/home/KÄYTTÄJÄ/hessutalks-data\n");
        exit(2);
    }
    $out = is_string($opts['out'] ?? null) ? $opts['out'] : $dataDir . '/config.php';
    if (str_contains($dataDir, '/public_html')) {
        fwrite(STDERR, "Datahakemisto ei saa olla sivuston (public_html) alla.\n");
        exit(2);
    }
    $rpId = is_string($opts['rp-id'] ?? null) ? $opts['rp-id'] : (string) parse_url($origin, PHP_URL_HOST);
    if (!str_starts_with($origin, 'https://')) {
        fwrite(STDERR, "Tuotannossa origin pitää olla https://\n");
        exit(2);
    }
}

if (is_file($out) && !isset($opts['force'])) {
    fwrite(STDERR, "$out on jo olemassa. Käytä --force korvataksesi (uusi app_secret mitätöi avoimet lomakkeet).\n");
    exit(2);
}

// Käyttöönottotunnus: 128 bittiä, ryhmiteltynä luettavuuden vuoksi.
$token = implode('-', str_split(strtoupper(bin2hex(random_bytes(16))), 8));

$config = [
    'base_path' => $base,
    'public_origin' => $origin,
    'rp_id' => $rpId,
    'db_path' => $dataDir . '/hessutalks.sqlite',
    'session_path' => $dataDir . '/sessions',
    'app_secret' => bin2hex(random_bytes(32)),
    'setup_token_hash' => password_hash($token, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT),
    'admin_name' => is_string($opts['name'] ?? null) ? $opts['name'] : 'Hessu',
    'cookie_secure' => !$dev,
];

if (!is_dir(dirname($out))) {
    mkdir(dirname($out), 0700, true);
}
if (!$dev) {
    @chmod($dataDir, 0700);
}
$php = "<?php\n\n// HessuTalks-asetukset. ÄLÄ lisää versionhallintaan. Pidä webrootin ulkopuolella.\n\nreturn " . var_export($config, true) . ";\n";
file_put_contents($out, $php);
chmod($out, 0600);

echo "Asetukset kirjoitettu: $out\n\n";
echo "KÄYTTÖÖNOTTOTUNNUS (näytetään vain kerran, tarvitaan ensimmäisen passkeyn rekisteröintiin):\n\n    $token\n\n";
if (!$dev) {
    echo "Avaa seuraavaksi: $origin$base/admin\n";
}
if ($dev) {
    echo "Käynnistä kehityspalvelin:\n    HESSUTALKS_CONFIG=$out php -S localhost:8080 -t public bin/dev-router.php\n";
    echo "Hallinta: http://localhost:8080/admin\n";
}
