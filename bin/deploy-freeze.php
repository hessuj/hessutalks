<?php

/**
 * CI:n deploy-jobin ensimmäinen vaihe: estää julkaisun jäädytysikkunan aikana.
 * Ikkunat tulevat ympäristömuuttujasta DEPLOY_FREEZE (GitHubin production-ympäristön muuttuja).
 *   DEPLOY_FREEZE="..." php bin/deploy-freeze.php                          # exit 1 ikkunan aikana
 *   DEPLOY_FREEZE="..." DEPLOY_FREEZE_OVERRIDE=1 php bin/deploy-freeze.php # hätätapauksen ohitus (käsin käynnistetty ajo)
 */

declare(strict_types=1);

use HessuTalks\DeployFreeze;

if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__) . '/src/DeployFreeze.php';

[$code, $message] = DeployFreeze::decide((string) getenv('DEPLOY_FREEZE'), new DateTimeImmutable('now'), getenv('DEPLOY_FREEZE_OVERRIDE') === '1');
echo $message, "\n";
exit($code);
