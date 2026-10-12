<?php

declare(strict_types=1);

// HessuTalks – front controller.
// Sovelluskoodi ja data sijaitsevat webrootin ulkopuolella (ks. src/Bootstrap.php).

$envRoot = getenv('HESSUTALKS_APP_ROOT');
$envConfig = getenv('HESSUTALKS_CONFIG');
if (is_string($envRoot) && $envRoot !== '') {
    $appRoot = $envRoot;
} elseif (is_file(__DIR__ . '/../src/App.php')) {
    $appRoot = dirname(__DIR__);                     // kehitys: repo
} else {
    $appRoot = dirname(__DIR__, 3) . '/hessutalks-app'; // tuotanto: ~/public_html/softa/hessutalks -> ~/hessutalks-app
}
$configFile = is_string($envConfig) && $envConfig !== '' ? $envConfig : dirname($appRoot) . '/hessutalks-data/config.php';

if (!is_file($appRoot . '/vendor/autoload.php')) {
    http_response_code(503);
    exit('Palvelu ei ole käytettävissä.');
}
require $appRoot . '/vendor/autoload.php';

\HessuTalks\Bootstrap::run($appRoot, $configFile);
