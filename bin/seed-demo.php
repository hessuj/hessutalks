<?php

/**
 * Luo kehitys-/CI-ympäristöön testiavaimet ja yhden avoimen luennon (DAST-skannausta varten).
 * Tulostaa luennon koodin. Kieltäytyy toimimasta tuotantoasetuksilla.
 *   HESSUTALKS_CONFIG=var/config.php php bin/seed-demo.php
 */

declare(strict_types=1);

use HessuTalks\Config;
use HessuTalks\Database;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Security\Clock;

if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__) . '/vendor/autoload.php';

$configFile = getenv('HESSUTALKS_CONFIG');
if (!is_string($configFile) || $configFile === '') {
    fwrite(STDERR, "Aseta HESSUTALKS_CONFIG\n");
    exit(2);
}
$config = Config::fromFile($configFile);
if ($config->cookieSecure || str_starts_with($config->publicOrigin, 'https://')) {
    fwrite(STDERR, "seed-demo on vain kehitysympäristöön.\n");
    exit(2);
}

$clock = new Clock();
$db = new Database($config->dbPath, dirname(__DIR__) . '/migrations');
$kp = sodium_crypto_box_keypair();
(new KeyRepository($db, $clock))->createOnce([
    'public_key' => base64_encode(sodium_crypto_box_publickey($kp)),
    'enc_secret_key' => base64_encode(random_bytes(48)),
    'nonce' => base64_encode(random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES)),
    'salt' => base64_encode(random_bytes(SODIUM_CRYPTO_PWHASH_SALTBYTES)),
    'opslimit' => 3,
    'memlimit' => 67108864,
]);
echo (new EventRepository($db, $clock))->create('DAST-testiluento', null)['code'], "\n";
