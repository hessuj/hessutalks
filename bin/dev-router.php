<?php

// Kehityspalvelimen reititin: php -S localhost:8080 -t public bin/dev-router.php
// Vaatii ympäristömuuttujan HESSUTALKS_CONFIG (ks. bin/init.php --dev).
//
// Palvelee staattiset tiedostot samoilla turvaotsakkeilla, jotka Apache lisää tuotannossa
// (public/.htaccess), jotta CI:n DAST-skannaus vastaa tuotantoa.

declare(strict_types=1);

const STATIC_TYPES = [
    'css' => 'text/css; charset=utf-8',
    'js' => 'application/javascript; charset=utf-8',
    'svg' => 'image/svg+xml',
    'txt' => 'text/plain; charset=utf-8',
];

$publicDir = (string) realpath(__DIR__ . '/../public');
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);

if (str_starts_with($path, '/assets/')) {
    $file = realpath($publicDir . $path);
    $ext = $file === false ? '' : strtolower(pathinfo($file, PATHINFO_EXTENSION));
    // Vain public/assets-hakemiston sisällä olevat sallitut tiedostotyypit (ei polkujen läpikulkua).
    if ($file === false || !str_starts_with($file, $publicDir . '/assets/') || !isset(STATIC_TYPES[$ext]) || !is_file($file)) {
        http_response_code(404);
        exit;
    }
    header_remove('X-Powered-By');
    header('Content-Type: ' . STATIC_TYPES[$ext]);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Resource-Policy: same-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    header('Cache-Control: public, max-age=604800, immutable');
    readfile($file);
    exit;
}

// Osallistujien tilatiedostot kuten public/live/.htaccess: vain 32 heksamerkkiä + .json, ei välimuistia,
// puuttuva tiedosto on 404 ilman sovellusta.
if (str_starts_with($path, '/live/')) {
    $file = realpath($publicDir . $path);
    // Vain public/live-hakemiston sovelluksen kirjoittamat tiedostot (ei polkujen läpikulkua), kuten assets yllä.
    if ($file === false || !str_starts_with($file, $publicDir . '/live/') || preg_match('/^[0-9a-f]{32}\.json$/', basename($file)) !== 1 || !is_file($file)) {
        http_response_code(404);
        exit;
    }
    header_remove('X-Powered-By');
    header('Content-Type: application/json');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Cross-Origin-Resource-Policy: same-origin');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    header('Cache-Control: no-store');
    readfile($file);
    exit;
}

require $publicDir . '/index.php';
