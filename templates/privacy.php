<?php /** @var \Closure $e @var \Closure $url */ ?>
<section class="card narrow prose">
  <h1>Tietosuoja</h1>
  <p>HessuTalks ei kerää osallistujista henkilötietoja. Kysymyksiä ja palautetta lähetetään vain nimimerkillä.</p>
  <h2>Mitä tallennetaan</h2>
  <ul>
    <li>Viestisi ja nimimerkkisi salataan selaimessasi luennoitsijan julkisella avaimella. Palvelimelle tallentuu vain salattu data ja lähetysaika.</li>
    <li>Jotta sama nimimerkki ei ole kahdella käyttäjällä, palvelin tallentaa nimimerkistä avaimellisen tiivisteen. Itse nimimerkkiä palvelin ei tallenna.</li>
    <li>Selaimesi muistaa nimimerkkisi ja satunnaisen tunnisteen, jolla vain sinä voit lähettää viestejä sillä nimimerkillä. Tiedot ovat vain laitteellasi. Voit poistaa ne tyhjentämällä tämän sivuston tiedot selaimesta.</li>
    <li>Sovellus ei käytä evästeitä eikä analytiikkaa, eikä se tallenna IP-osoitettasi.</li>
  </ul>
  <h2>Huomioi itse</h2>
  <p>Älä kirjoita nimimerkkiin tai viestiin omaa nimeäsi, yhteystietojasi tai muuta tunnistettavaa tietoa.</p>
  <p>Palvelimen ylläpitäjä (webhotelli) voi kirjata tavanomaisia teknisiä lokeja, kuten IP-osoitteita, palvelun toiminnan varmistamiseksi. Sovellus ei käytä niitä.</p>
  <h2>Säilytys</h2>
  <p>Luennon viestit ja nimimerkkitiivisteet poistetaan, kun luennoitsija poistaa luennon.</p>
  <p><a class="btn ghost" href="<?= $e($url('/')) ?>">Takaisin</a></p>
</section>
