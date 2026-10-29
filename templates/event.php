<?php
/** @var \Closure $e @var \Closure $url @var \Closure $t @var string $lang */
/** @var array<string, mixed> $event @var string $publicKey @var string $formToken @var string $jsStrings */
/** @var string $liveEndpoint @var string $liveFile @var string $answerEndpoint */
?>
<section class="card" id="ask"
         data-code="<?= $e($event['code']) ?>"
         data-pk="<?= $e($publicKey) ?>"
         data-token="<?= $e($formToken) ?>"
         data-lang="<?= $e($lang) ?>"
         data-i18n="<?= $e($jsStrings) ?>"
         data-nick-endpoint="<?= $e($url('/api/nickname')) ?>"
         data-endpoint="<?= $e($url('/api/questions')) ?>">
  <p class="eyebrow"><?= $e($t('event.code')) ?> <span class="mono"><?= $e($event['code']) ?></span></p>
  <h1><?= $e($event['title']) ?></h1>

  <noscript><p class="notice error"><?= $e($t('event.noscript')) ?></p></noscript>

  <!-- Kolme erillistä osiota: luennoitsijan kysymykset, oma nimimerkki ja omat viestit. -->
  <section class="zone zone-live" id="polls-zone" aria-labelledby="zone-live-title" hidden>
    <h2 class="zone-title" id="zone-live-title"><?= $e($t('event.zone_live')) ?></h2>
    <p class="zone-hint"><?= $e($t('event.zone_live_hint')) ?></p>
    <div id="polls" class="polls"
         data-endpoint="<?= $e($liveEndpoint) ?>"
         data-live-file="<?= $e($liveFile) ?>"
         data-answer-endpoint="<?= $e($answerEndpoint) ?>"></div>
  </section>

  <form id="ask-form" class="ask-form" method="post" action="#" novalidate hidden>
   <section class="zone zone-nick" aria-labelledby="zone-nick-title">
    <h2 class="zone-title" id="zone-nick-title"><?= $e($t('event.zone_nick')) ?></h2>
    <div id="nick-pick">
      <label for="nickname"><?= $e($t('event.nickname')) ?></label>
      <input id="nickname" name="nickname" type="text" minlength="2" maxlength="24" required
             autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="<?= $e($t('event.nick_placeholder')) ?>">
      <p class="hint"><?= $e($t('event.nick_hint')) ?></p>
    </div>
    <div id="nick-owned" class="nick-owned" hidden>
      <p><?= $e($t('event.nick_owned')) ?> <strong id="nick-label"></strong></p>
      <button type="button" class="btn ghost small" id="nick-change"><?= $e($t('event.nick_change')) ?></button>
    </div>
    <p class="zone-hint"><?= $e($t('event.zone_nick_hint')) ?></p>
   </section>

   <section class="zone zone-ask" aria-labelledby="zone-ask-title">
    <h2 class="zone-title" id="zone-ask-title"><?= $e($t('event.zone_ask')) ?></h2>

    <fieldset class="kind">
      <legend class="sr-only"><?= $e($t('event.kind')) ?></legend>
      <label><input type="radio" name="kind" value="question" checked> <?= $e($t('event.question')) ?></label>
      <label><input type="radio" name="kind" value="feedback"> <?= $e($t('event.feedback')) ?></label>
    </fieldset>

    <label for="text"><?= $e($t('event.message')) ?></label>
    <textarea id="text" name="text" rows="5" maxlength="2000" required placeholder="<?= $e($t('event.message_placeholder')) ?>"></textarea>
    <p class="counter"><span id="count">0</span>/2000</p>

    <button type="submit" class="btn" id="send"><?= $e($t('event.send')) ?></button>
    <p class="hint lock"><?= $e($t('event.lock_hint')) ?></p>
   </section>
  </form>

  <div id="status" class="notice" role="status" aria-live="polite" hidden></div>
</section>
