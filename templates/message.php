<?php /** @var \Closure $e @var \Closure $url */ ?>
<section class="card narrow">
  <h1><?= $e($heading ?? '') ?></h1>
  <p><?= $e($message ?? '') ?></p>
  <p><a class="btn ghost" href="<?= $e($url('/')) ?>">Etusivulle</a></p>
</section>
