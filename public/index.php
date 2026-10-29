<?php

declare(strict_types=1);

// HessuTalks – front controller.
//
// Tuotannossa (FTP-tunnus rajattu sovelluksen omaan kansioon):
//   <sovelluskansio>/index.php, assets/   julkiset tiedostot
//   <sovelluskansio>/app/                 sovelluskoodi, suora pääsy estetty (.htaccess)
//   ~/hessutalks-data/config.php          asetukset, tietokanta ja istunnot WEBROOTIN ULKOPUOLELLA
//
// Ympäristömuuttujat HESSUTALKS_APP_ROOT ja HESSUTALKS_CONFIG ohittavat oletukset.

$envRoot = getenv('HESSUTALKS_APP_ROOT');
if (is_string($envRoot) && $envRoot !== '') {
    $appRoot = $envRoot;
} elseif (is_file(__DIR__ . '/app/src/App.php')) {
    $appRoot = __DIR__ . '/app';           // tuotanto
} else {
    $appRoot = dirname(__DIR__);           // kehitys: repon juuri
}

$configFile = null;
$envConfig = getenv('HESSUTALKS_CONFIG');
if (is_string($envConfig) && $envConfig !== '') {
    $configFile = $envConfig;
} else {
    // 1) käyttäjän kotihakemisto, 2) yläkansiot sovelluskansiosta ylöspäin
    $candidates = [];
    if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $pw = posix_getpwuid(posix_geteuid());
        if (is_array($pw) && $pw['dir'] !== '') {
            $candidates[] = $pw['dir'] . '/hessutalks-data/config.php';
        }
    }
    for ($dir = dirname(__DIR__), $i = 0; $i < 5 && $dir !== dirname($dir); $dir = dirname($dir), $i++) {
        $candidates[] = $dir . '/hessutalks-data/config.php';
    }
    foreach ($candidates as $candidate) {
        if (is_file($candidate)) {
            $configFile = $candidate;
            break;
        }
    }
}

if ($configFile === null || !is_file($appRoot . '/vendor/autoload.php')) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Palvelu ei ole vielä käytettävissä.');
}
require $appRoot . '/vendor/autoload.php';

\HessuTalks\Bootstrap::run($appRoot, $configFile, __DIR__);
