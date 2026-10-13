<?php
/** @var \Closure $e @var \Closure $url @var \Closure $t @var string $lang */
$err = isset($error) && is_string($error) ? $error : '';
$explicitLang = isset($langQuery) && is_string($langQuery) && $langQuery !== '';
?>
<section class="card narrow">
  <p class="ready">READY.</p>
  <h1><?= $e($t('home.heading')) ?></h1>
  <p><?= $e($t('home.intro')) ?></p>
  <form method="get" action="<?= $e($url('/')) ?>" class="code-form" autocomplete="off">
    <label for="k" class="sr-only"><?= $e($t('home.code_label')) ?></label>
    <input id="k" name="k" type="text" inputmode="text" autocapitalize="characters" spellcheck="false"
           maxlength="9" placeholder="ABC234" required pattern="[A-Za-z0-9 \-]{6,9}" class="code-input">
    <?php if ($explicitLang): ?><input type="hidden" name="lang" value="<?= $e($lang) ?>"><?php endif; ?>
    <button type="submit" class="btn"><?= $e($t('home.continue')) ?></button>
  </form>
  <?php if ($err !== ''): ?><p class="notice error" role="alert"><?= $e($err) ?></p><?php endif; ?>
</section>
