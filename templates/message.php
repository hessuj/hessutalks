<?php /** @var \Closure $e @var \Closure $url @var \Closure $t */ $lq = isset($langQuery) && is_string($langQuery) ? $langQuery : ''; ?>
<section class="card narrow">
  <h1><?= $e($heading ?? '') ?></h1>
  <p><?= $e($message ?? '') ?></p>
  <p><a class="btn ghost" href="<?= $e($url('/') . $lq) ?>"><?= $e($t('page.home')) ?></a></p>
</section>
