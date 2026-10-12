<?php
/** @var \Closure $e @var \Closure $url */
/** @var array<string, mixed> $event @var string $publicKey @var string $formToken */
?>
<section class="card" id="ask"
         data-code="<?= $e($event['code']) ?>"
         data-pk="<?= $e($publicKey) ?>"
         data-token="<?= $e($formToken) ?>"
         data-nick-endpoint="<?= $e($url('/api/nickname')) ?>"
         data-endpoint="<?= $e($url('/api/questions')) ?>">
  <p class="eyebrow">Koodi <span class="mono"><?= $e($event['code']) ?></span></p>
  <h1><?= $e($event['title']) ?></h1>

  <noscript><p class="notice error">Lomake vaatii JavaScriptin, koska viesti salataan selaimessasi ennen lähetystä.</p></noscript>

  <form id="ask-form" class="ask-form" method="post" action="#" novalidate hidden>
    <div id="nick-pick">
      <label for="nickname">Nimimerkki</label>
      <input id="nickname" name="nickname" type="text" minlength="2" maxlength="24" required
             autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="esim. Kahvikuppi42">
      <p class="hint">Pakollinen ja luennolla uniikki. Älä käytä omaa nimeäsi tai muuta tunnistettavaa tietoa.</p>
    </div>
    <div id="nick-owned" class="nick-owned" hidden>
      <p>Kirjoitat nimimerkillä <strong id="nick-label"></strong></p>
      <button type="button" class="btn ghost small" id="nick-change">Vaihda nimimerkki</button>
    </div>

    <fieldset class="kind">
      <legend class="sr-only">Viestin tyyppi</legend>
      <label><input type="radio" name="kind" value="question" checked> Kysymys</label>
      <label><input type="radio" name="kind" value="feedback"> Palaute</label>
    </fieldset>

    <label for="text">Viestisi</label>
    <textarea id="text" name="text" rows="5" maxlength="2000" required placeholder="Kirjoita kysymys tai palaute"></textarea>
    <p class="counter"><span id="count">0</span>/2000</p>

    <button type="submit" class="btn" id="send">Lähetä salattuna</button>
    <p class="hint lock">Viesti ja nimimerkki salataan laitteellasi. Palvelin tallentaa vain salatun datan, jonka voi avata ainoastaan luennoitsija.</p>
  </form>

  <div id="status" class="notice" role="status" aria-live="polite" hidden></div>
</section>
