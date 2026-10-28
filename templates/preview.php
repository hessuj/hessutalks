<?php
/** @var \Closure $e @var \Closure $t @var string $lang */
/** @var array<string, mixed> $event @var string $pollJson @var string $jsStrings */
// Esikatselu osallistujan ulkoasussa: polls.js piirtää kortin data-preview-kentästä eikä lähetä mitään.
?>
<section class="card" id="ask"
         data-code="<?= $e($event['code']) ?>"
         data-lang="<?= $e($lang) ?>"
         data-i18n="<?= $e($jsStrings) ?>">
  <p class="notice">Esikatselu: näin kysymys näkyy osallistujalle. Vastausta ei lähetetä.</p>
  <p class="eyebrow"><?= $e($t('event.code')) ?> <span class="mono"><?= $e($event['code']) ?></span></p>
  <h1><?= $e($event['title']) ?></h1>
  <div id="polls" class="polls" data-preview="<?= $e($pollJson) ?>"></div>
</section>
