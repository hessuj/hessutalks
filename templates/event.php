<?php
/** @var \Closure $e @var \Closure $url @var \Closure $t @var string $lang */
/** @var array<string, mixed> $event @var string $publicKey @var string $formToken @var string $jsStrings */
/** @var string $liveEndpoint @var string $answerEndpoint */
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

  <div id="polls" class="polls" hidden
       data-endpoint="<?= $e($liveEndpoint) ?>"
       data-answer-endpoint="<?= $e($answerEndpoint) ?>"></div>

  <form id="ask-form" class="ask-form" method="post" action="#" novalidate hidden>
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
  </form>

  <div id="status" class="notice" role="status" aria-live="polite" hidden></div>
</section>
