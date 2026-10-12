<?php /** @var \Closure $e @var \Closure $url */ $err = isset($error) && is_string($error) ? $error : ''; ?>
<section class="card narrow">
  <p class="ready">READY.</p>
  <h1>Liity luennolle</h1>
  <p>Syötä luennoitsijan näyttämä koodi tai skannaa QR-koodi.</p>
  <form method="get" action="<?= $e($url('/')) ?>" class="code-form" autocomplete="off">
    <label for="k" class="sr-only">Luennon koodi</label>
    <input id="k" name="k" type="text" inputmode="text" autocapitalize="characters" spellcheck="false"
           maxlength="9" placeholder="ABC234" required pattern="[A-Za-z0-9 \-]{6,9}" class="code-input">
    <button type="submit" class="btn">Jatka</button>
  </form>
  <?php if ($err !== ''): ?><p class="notice error" role="alert"><?= $e($err) ?></p><?php endif; ?>
</section>
