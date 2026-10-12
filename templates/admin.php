<?php /** @var \Closure $e @var \Closure $url */ ?>
<section id="admin"
         data-base="<?= $e($url('')) ?>"
         data-csrf="<?= $e($csrf ?? '') ?>"
         data-mode="<?= $e($mode ?? 'login') ?>"
         data-origin="<?= $e($origin ?? '') ?>">
  <noscript><p class="notice error">Hallintanäkymä vaatii JavaScriptin.</p></noscript>
  <p class="ready blink">LOADING…</p>
</section>
