<?php

// Kehityspalvelimen reititin: php -S 127.0.0.1:8080 -t public bin/dev-router.php
// Vaatii ympäristömuuttujan HESSUTALKS_CONFIG (ks. bin/init.php --dev).

declare(strict_types=1);

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$file = __DIR__ . '/../public' . $path;
if ($path !== '/' && is_file($file) && !str_ends_with($file, '.php')) {
    return false; // staattinen tiedosto
}
require __DIR__ . '/../public/index.php';
