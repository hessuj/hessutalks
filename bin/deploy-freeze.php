<?php

/**
 * CI:n deploy-jobin ensimmäinen vaihe: estää julkaisun jäädytysikkunan aikana (.github/deploy-freeze.txt).
 *   php bin/deploy-freeze.php            # exit 1 ikkunan aikana
 *   DEPLOY_FREEZE_OVERRIDE=1 php bin/deploy-freeze.php   # hätätapauksen ohitus (käsin käynnistetty ajo)
 */

declare(strict_types=1);

use HessuTalks\DeployFreeze;

if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__) . '/src/DeployFreeze.php';

$file = dirname(__DIR__) . '/.github/deploy-freeze.txt';
$spec = is_file($file) ? (string) file_get_contents($file) : '';
try {
    $window = DeployFreeze::activeWindow($spec, new DateTimeImmutable('now'));
} catch (InvalidArgumentException $e) {
    fwrite(STDERR, "::error title=Julkaisujäädytys::deploy-freeze.txt: {$e->getMessage()}\n");
    exit(1);
}
if ($window === null) {
    echo "Ei julkaisujäädytystä.\n";
    exit(0);
}
if (getenv('DEPLOY_FREEZE_OVERRIDE') === '1') {
    echo "::warning title=Julkaisujäädytys ohitettu::$window\n";
    exit(0);
}
echo "::error title=Julkaisujäädytys::Tapahtuma käynnissä $window. Tuotantoon ei julkaista. Hätätapauksessa: Run workflow → Ohita julkaisujäädytys.\n";
exit(1);
