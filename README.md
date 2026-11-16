# HessuTalks

**Suomi** · [English](README.en.md)

Päästä päähän salattu kysymys- ja palautekanava luennoille ja puheille.
Osallistujat liittyvät luennolle koodilla tai QR-koodilla ja lähettävät kysymyksiä nimimerkillä.
Vain luennoitsija voi lukea viestit.

Osoite: <https://hessujarvinen.com/hessutalks/>

**Käyttöohje ruutukaappauksin:** [docs/kayttoohje.md](docs/kayttoohje.md)

## Miten se toimii

1. Luennoitsija luo hallintanäkymässä luennon. Sovellus antaa 6-merkkisen koodin ja QR-koodin. Otsikkoa voi muokata myöhemmin (*Muokkaa otsikkoa*), ja koodi pysyy samana.
2. Osallistuja avaa sivun, valitsee nimimerkin ja kirjoittaa kysymyksen tai palautteen.
3. Viesti ja nimimerkki salataan osallistujan selaimessa luennoitsijan julkisella avaimella.
4. Luennoitsija avaa viestit omassa selaimessaan passkeylla tai tunnuslauseella. Ne päivittyvät reaaliaikaisesti,
   ja QR-koodin, kysymyksiä tuloksineen ja yksittäisiä viestejä voi näyttää taululla (projektorilla).

### Kyselyt ja kysymyssarjat

Luento koostuu **kysymyssarjoista** (esim. moduulit `M1`, `M4`), joissa on kysymykset järjestyksessä.
Kysymystyypit: monivalinta (yksi tai useita vastauksia), avoin teksti (oletus 280 merkkiä, pohdintatehtäviin enintään 3 500 eli noin 500 sanaa, valinnaisesti useita vastauksia), sanapilvi (1–3 sanaa, 30 merkkiä), Likert-asteikko (5 tai 7 kohtaa) ja asteikko 0–10.

Yksi luento voi kattaa koko kurssin tai luentosarjan: sarjat jakavat sen luentoihin (esim. `L1`–`L4`), ja osallistujat
käyttävät samaa koodia ja nimimerkkiä koko kurssin ajan. Hallinnan luentosivulla on kolme välilehteä: *Kysymykset*
(ennalta laaditut kysymykset sarjoittain), *Vapaat kysymykset* ja *Palautteet*. Viestivälilehdet kertovat uusien määrän.

Hallinnassa ei ole erillisiä tiloja eikä aktiivista kysymystä: jokaisen kysymyksen ja viestin toiminnot ovat sen rivillä
([#60](https://github.com/hessuj/hessutalks/issues/60)).

1. Luo sarjat (*Uusi sarja*) ja niihin kysymykset (*Uusi kysymys*) tai tuo ne JSON-tiedostosta ennen luentoa. Sarjan
   otsikkorivin *Sarja ▾* avaa sarjan muokkauksen, järjestyksen, viennin, monistuksen ja poiston.
2. **Kysymyksen rivillä** ovat luennon aikaiset toiminnot:
   - *Näytä taululla* tuo kysymyksen projektorille muiden rinnalle ja avaa sen vastauksille yhdellä napilla.
   - *Sulje* lopettaa vastausten vastaanoton, ja kysymys jää taululle (*Avaa vastauksille* avaa sen uudelleen).
   - *Poista taululta* vie kysymyksen pois projektorilta ja osallistujien puhelimista. Vastaukset säilyvät, ja
     uudelleen näyttäminen avaa kysymyksen taas.
   - *Näytä tulokset* ja *Paljasta oikea vastaus* (ks. kohta 6).
3. **Rivin klikkaus** avaa kysymyksen alle sen tulokset ja moderoinnin sekä muokkauksen: *Esikatsele*, *Muokkaa*,
   järjestys, *Siirrä sarjaan…*, *Palauta luonnokseksi*, *Tyhjennä vastaukset* ja *Poista*. *Piilota* sulkee osan.
   Vastausten tyhjennys ja poisto ovat vain täällä vahvistuksella, jotta luennon aikana annettuja vastauksia ei poisteta vahingossa.
4. **Taululla** voi olla useita kysymyksiä ja viestejä yhtä aikaa: projektori näyttää ne ruudukkona, ja osallistujat
   näkevät kysymykset allekkain ja voivat vastata kaikkiin avoimiin. Vain taululla oleva kysymys voi olla auki.
   *Palauta luonnokseksi* vie julkaistun kysymyksen pois taululta ja osallistujilta ja piilottaa tulokset ja oikean
   vastauksen. Annetut vastaukset säilyvät, ja kysymyksen voi näyttää uudelleen.
5. Osallistujat käyttävät koko ajan samaa luennon QR-koodia tai linkkiä. Näkymä vaihtuu itsestään noin
   sekunnin viiveellä ilman sivun päivitystä. Yhteyskatkon jälkeen sivu yhdistää uudelleen, ja oma vastaus säilyy myös uudelleenlatauksessa.
6. **Tulokset ja paljastus:** tulokset ovat aluksi piilossa (projektorilla kysymys, vaihtoehdot ja vastausmäärä).
   *Näytä tulokset* tuo ne projektorille ja tuloskoosteena myös osallistujien puhelimiin (monivalinnat ja asteikot).
   *Paljasta oikea vastaus* korostaa oikeat vaihtoehdot ja näyttää selitykset, jos kysymykselle on määritelty oikea vastaus.
   Oikeat vastaukset ja selitykset annetaan kysymyslomakkeella tai JSON-tiedostossa, eikä niitä lähetetä osallistujille ennen paljastusta.
7. **Vapaat kysymykset ja palautteet** näkyvät omilla välilehdillään uusin ensin. Viestin rivillä ovat *Näytä taululla* /
   *Poista taululta* (taululla enintään 6 viestiä kerrallaan), *Merkitse vastatuksi* (palaute: *Merkitse käsitellyksi*),
   jonka *Palauta uudeksi* peruu, sekä *Poista*.
8. **Taulu:** luennon sivun yläosan rivillä ovat *Avaa esitysnäyttö* (ja yhteyden tila), *QR isona* ja *Tyhjennä taulu*.
   Esitysnäyttö on yksi ikkuna, joka näyttää kaiken taululle valitun. Jos taululla ei ole mitään, siinä on luennon QR-koodi.
9. **Moderointi:** avoimen vastauksen voi piilottaa *Piilota*-napilla ja sanapilven sanan klikkaamalla sitä kysymyksen
   avautuvassa osassa. Piilotus katoaa projektorilta heti.
   Kirosanasuodatin (englanti ja suomi) piilottaa osumat automaattisesti, ja ne odottavat hyväksyntää (⚠ … ✓).
   Piilotukset tallennetaan palvelimelle salattuina luennoitsijan avaimella, joten ne säilyvät uudelleenlatauksen yli.

Kyselyyn vastataan ilman nimimerkkiä. Vastaukset salataan selaimessa kuten kysymyksetkin, ja tulokset
lasketaan luennoitsijan selaimessa, joten hallinnan pitää olla auki ja avattuna. Saman selaimen uusi vastaus
korvaa aiemman, kunnes kysely suljetaan.

#### Esikatselu, monistus, siirto ja CSV

- **Esikatsele** (kysymyksen avautuvassa osassa) avaa kysymyksen osallistujan ulkoasussa (puhelimen kokoinen ikkuna,
  vastausta ei lähetetä) ja **Esikatsele projektorilla** esitysnäkymässä ennen avaamista.
- **Monista** kopioi sarjan kysymyksineen ilman vastauksia (tunniste saa jatkeen `-2`). Kysymyksen voi siirtää toiseen sarjaan
  valikosta *Siirrä sarjaan…*. Vastaukset säilyvät.
- **Vie CSV** (koko luento tai sarjan *Sarja ▾* -valikosta): kysymys, vaihtoehto tai teksti, vastausmäärä ja aikaleima, ei osallistujatunnisteita.
  Vastaukset puretaan selaimessasi, joten palvelin ei näe tiedoston sisältöä. Erotin `;` ja UTF-8-BOM, jolloin Excel avaa tiedoston suoraan.
  Kaavana alkavat tekstit (`=`, `+`, `-`, `@`) saavat eteensä heittomerkin (CSV-injektion esto).
- **Vie Markdown**: koko luennon tai luentosarjan raportti (`.md`): sarjat, kysymykset ja tulokset taulukkoina, oikeat vastaukset,
  avoimet vastaukset sekä osallistujien kysymykset ja palaute. Ei nimimerkkejä; piilotetut ja arkistoidut jäävät pois. Puretaan selaimessasi.

#### Tuonti ja vienti JSON-tiedostona

*Tuo JSON* lukee sarjat tiedostosta, ja kysymykset voi pitää versionhallinnassa ja kopioida tulevia
kursseja varten. Ennen tallennusta sovellus näyttää yhteenvedon: tuotavat sarjat, ohitettavat kysymykset ja virheet.
Tuonti on kaikki tai ei mitään. Virhe (myös luennolla jo oleva sarjan tunniste) estää koko tuonnin.
*Vie JSON* (koko luento tai sarjan *Sarja ▾* -valikosta) lataa saman muodon takaisin. Esimerkki: [tests/fixtures/mmoit-2026.json](tests/fixtures/mmoit-2026.json).
Tiedostomuodon tarkka kuvaus: [docs/tuontimuoto.md](docs/tuontimuoto.md). Kun annat tekoälylle oppimateriaalin ja
tämän kuvauksen, se voi tuottaa tuontitiedoston suoraan materiaalista.

```json
{ "event": { "title": "…" },
  "sets": [ { "id": "M4", "title": "M4 Case", "questions": [
    { "type": "single", "text": "What is your FIRST action?", "options": ["A", "B"], "correct": [1], "explanations": ["…", "…"] },
    { "type": "scale", "text": "…", "min": 1, "max": 5, "minLabel": "Strongly disagree", "maxLabel": "Strongly agree" },
    { "type": "wordcloud", "text": "Cybersecurity in one word?", "maxWords": 3 } ] } ] }
```

| `type` | Sovelluksessa |
|---|---|
| `single`, `multi` | Monivalinta. `correct` = oikeiden vaihtoehtojen indeksit (0-pohjainen), `explanations` = selitys per vaihtoehto. Molemmat valinnaisia, eikä niitä näytetä osallistujille. |
| `scale` | `min`–`max` 1–5 tai 1–7 = Likert, 0–10 = asteikko |
| `wordcloud` | Sanapilvi, `maxWords` 1–3 |
| `open` | Avoin teksti, `multipleAnswers` = useita vastauksia, `maxLength` = enimmäispituus merkkeinä 280–3500 (oletus 280). Osallistuja näkee laskurin, esim. `240/3500`. Projektori näyttää pitkistä vastauksista 280 ensimmäistä merkkiä, hallinta ja CSV koko tekstin. |
| `qa` | Ei käytössä; tuodaan `fallbackType`-kentän tyyppinä, jos se on annettu |

**Osallistujien kieli** valitaan luennolle (luontilomake tai luennon sivu): *English*, *Suomi* tai selaimen kielen mukaan.
Osallistuja voi silti vaihtaa kieltä FI/EN-kytkimestä. Projektorin omat tekstit (esim. vastausmäärä ja "Tulokset näytetään
myöhemmin") seuraavat samaa valintaa: *English* → englanti, *Suomi* ja *selaimen kielen mukaan* → suomi. Hallinta on aina suomeksi.

### Esitysnäkymä ja pikanäppäimet

Esitysnäyttö on luennon esitysnäkymä Teams-jakoon ja salin projektorille. Alareunassa ovat aina QR-koodi ja
liittymiskoodi, ja jokaisessa kysymyksessä sen vastausmäärä. Jos vastauksia on enemmän kuin mahtuu, ruutu vierittyy. Yksi kysymys täyttää näytön (kysymys yli 40 px 1080p:llä).
Useampi jaetaan ruudukoksi (enintään 12), ja fontit pienenevät ruudun koon mukaan.

| Näppäin | Toiminto |
|---|---|
| Q | Iso QR-koodi koko näytön peitoksi (väistyy, kun tuot jotain taululle). Toimii myös hallinnassa. |
| T | Vaalea / tumma teema (esitysikkuna) |
| F tai kaksoisklikkaus | Koko näyttö (esitysikkuna) |

Kysymysten ohjaus näppäimillä (Seuraava/Edellinen, avaus, tulokset, paljastus) ja puhelinohjain poistettiin hallinnan
yksinkertaistuksessa ([#60](https://github.com/hessuj/hessutalks/issues/60)): toiminnot ovat kysymyksen rivillä.

### Esitys projektorilla

Kun projektori on kytketty jatketuksi näytöksi (ei peilaus), *Avaa esitysnäyttö* avaa esitysikkunan.
Myös *Näytä taululla* avaa sen, jos se ei ole auki. Hallintanäkymä jää
läppärin näytölle. Luennon sivun yläosa kertoo, onko esitysnäyttö yhdistetty (● yhdistetty).

- Chrome ja Edge sijoittavat ikkunan automaattisesti (Window Management API). Ensimmäisellä kerralla
  selain kysyy luvan *ikkunoiden hallintaan*. Jos selain estää ponnahdusikkunan, salli ponnahdusikkunat sivulle ja paina nappia uudelleen.
- Muissa selaimissa ikkuna aukeaa tavallisena ikkunana: raahaa se projektorin näytölle.
- Kaksoisklikkaus tai F-näppäin vaihtaa koko näytön tilaan, Esc palauttaa.
- Esitysikkunoita on vain yksi: kaikki näytölle valittu näkyy siinä. Listat ja tulokset päivittyvät automaattisesti.
- Yhteys palautuu itsestään, jos esitysikkuna tai hallinta ladataan uudelleen (hallinnassa avaimen avauksen jälkeen).
- *Tyhjennä taulu* poistaa kaiken taululta (näkyviin jää QR-koodi). Taululla olleet kysymykset suljetaan, ja vastaukset
  säilyvät. Näyttö tyhjenee myös uloskirjautuessa ja hallintasivun sulkeutuessa.

### Ei henkilötietoja

- Nimimerkki on pakollinen ja uniikki luennon sisällä. Palvelin tallentaa siitä vain avaimellisen tiivisteen.
- Selain muistaa nimimerkin ja satunnaisen omistajatunnisteen (localStorage). Vain sama selain voi
  käyttää varattua nimimerkkiä, ja seuraavalla luennolla sama nimimerkki ehdotetaan valmiiksi.
- Ei sähköposteja, nimiä, evästeitä, analytiikkaa eikä IP-osoitteiden tallennusta osallistujista.

### Kieli

Osallistujan sivut ovat suomeksi ja englanniksi (hallinta aina suomeksi). Kieli tulee selaimen
asetuksista, ja sen voi vaihtaa yläkulman FI/EN-kytkimestä. Valinta muistetaan vain selaimessa
(localStorage). Käännökset ovat tiedostossa `src/I18n.php`, ja testi varmistaa, että jokaisella
avaimella on molemmat kielet.

## Tietoturva lyhyesti

| Kerros | Ratkaisu |
|---|---|
| Viestien luottamuksellisuus | libsodium `crypto_box_seal` (X25519 + XSalsa20-Poly1305) selaimessa |
| Yksityinen avain | Avataan selaimessa passkeylla (WebAuthn PRF) tai varakeinona tunnuslauseella (Argon2id, 64 MiB). Palvelin ei näe kumpaakaan |
| Ylläpitäjän kirjautuminen | Passkey (WebAuthn), käyttäjän varmennus pakollinen, ei salasanoja |
| Istunto | `__Host-`-eväste, `HttpOnly`, `Secure`, `SameSite=Strict`, 3 h toimettomuus / 8 h enintään |
| CSRF | Origin- ja `Sec-Fetch-Site`-tarkistus + CSRF-token (ylläpito) / tilaton HMAC-lomaketoken (osallistuja) |
| XSS | Tiukka CSP ilman `unsafe-inline`-sääntöä, puretut viestit DOMiin vain `textContent`illa |
| Väärinkäyttö | Nimimerkki- ja luentokohtaiset rajat, haasteiden kertakäyttöisyys, tietoturvaloki |
| Tallennus | SQLite webrootin ulkopuolella, parametrisoidut kyselyt, `secure_delete` |

Tarkempi uhkamalli ja jäännösriskit: [SECURITY.md](SECURITY.md). Esimerkki poikkeaman käsittelystä: [esitysnäytön poikkeamakatselmus](docs/poikkeama-esitysnaytto.md).

## CI/CD-putki

Jokainen push ja pull request ajaa tietoturvavaiheet tässä järjestyksessä. Jokainen vaihe tallentaa raporttinsa
ajon artefaktiksi (*Actions → ajo → Artifacts*):

1. **Gitleaks**: vuotaneet salaisuudet koko git-historiasta
2. **Semgrep (SAST)**: PHP, JavaScript, OWASP Top 10, salaisuudet
3. **Trivy (SCA)**: tunnetut haavoittuvuudet riippuvuuksissa (`composer.lock`). Putki pysähtyy CRITICAL-löydökseen.
4. **Trivy (SBOM)**: ainesosaluettelo CycloneDX JSON -muodossa: PHP-riippuvuudet ja vendoroidut selainkirjastot
   SHA-256-summineen (`scripts/sbom-vendor.py`)
5. **OWASP ZAP baseline (DAST)**: CI:ssä käynnistetyn testisovelluksen skannaus, ei koskaan tuotantoa

Trivy asennetaan julkaisusta lukitulla SHA-256-summalla (`scripts/install-trivy.sh`), ei GitHub Actionina:
`aquasecurity/trivy-action` kaapattiin maaliskuussa 2026 (CVE-2026-33634).

Lisäksi rinnakkain:

- **PHPUnit**: yksikkötestit ja tietoturvatestit (CSRF, origin, pääsynhallinta, injektiot, XSS,
  nimimerkkien omistajuus, rate limit, istuntojen aikakatkaisut, turvaotsakkeet, henkilötietojen puuttuminen)
- **PHPStan** taso 8 + strict rules
- **composer audit**: tunnetut haavoittuvuudet riippuvuuksissa
- **CodeQL**: JavaScriptin tietoturva-analyysi
- **Vendor-eheys**: selainkirjastojen SHA-256-tarkistus
- **Kryptotestit**: selaimen ja ylläpidon salausformaatin yhteentoimivuus

Kun kaikki menevät läpi `main`-haarassa, sovellus julkaistaan FTPS:llä webhotelliin ja tuotanto savutestataan.

**Julkaisujäädytys:** luentojen aikana deploy-job pysähtyy, eikä tuotantoon julkaista. Aikaikkunat ovat `production`-ympäristön
muuttujassa `DEPLOY_FREEZE` (*Settings → Environments → production → Variables*), eivät julkisessa repossa, eikä loki kerro
niitä. Yksi ikkuna riviä kohden Suomen aikaa: `VVVV-KK-PP HH:MM  VVVV-KK-PP HH:MM  # kuvaus`. Virheellinen muuttuja estää
julkaisun. Hätätapauksessa *Actions → CI/CD → Run workflow* ja valinta *Ohita julkaisujäädytys*.

ZAP-säännöt ovat tiedostossa `.zap/rules.tsv`: FAIL kaataa CI:n, WARN raportoidaan ja IGNORE ohitetaan perustellusti.

### Riippuvuuspäivitykset (Dependabot)

Dependabot tarkistaa GitHub Actionsien ja Composer-pakettien päivitykset viikoittain ja avaa niistä
pull requestin (`.github/dependabot.yml`). Uutta versiota ehdotetaan vasta, kun se on ollut julkaistuna
7 päivää. Kaikki Actions-päivitykset kootaan yhteen PR:ään, ja ne pysyvät lukittuina commit-SHA:han.

- Lue PR:n muutokset ja julkaisutiedot ja mergeä, kun CI on vihreä.
- Jos PR on jäänyt jälkeen `main`ista, kommentoi `@dependabot rebase`. Jos ryhmään on sillä välin tullut
  uusia päivityksiä, Dependabot sulkee vanhan PR:n ja avaa uuden.
- Satunnaisesti kaatunut job (esim. ZAP:n exit code 3) ajetaan uudelleen PR:n *Checks*-välilehdeltä
  (*Re-run failed jobs*).

## Käyttöönotto

HessuTalks on PHP 8.4 -sovellus, joka asennetaan web-palvelimelle omaan hakemistoonsa. Tietokantapalvelinta ei
tarvita. Julkinen hakemisto sisältää `index.php`:n ja `assets/`-kansion, sovelluskoodi on sen `app/`-alikansiossa
(suora pääsy estetty), ja asetukset, tietokanta ja istunnot ovat datahakemistossa webrootin ulkopuolella.
Asennus Apacheen, nginxiin tai muuhun palvelimeen, asetustiedoston luonti, tarkistuslista ja päivitykset:
[docs/asennus.md](docs/asennus.md).

## Kehitys omalla koneella

```sh
composer install
php bin/init.php --dev                  # luo var/config.php ja tulostaa käyttöönottotunnuksen
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
```

Avaa hallintanäkymä kehityspalvelimen kautta. Passkeyt toimivat `localhost`-osoitteessa ilman HTTPS:ää.

`HESSUTALKS_CONFIG=var/config.php php bin/seed-demo.php` luo testiavaimet ja avoimen luennon ja tulostaa
sen koodin. CI käyttää sitä ZAP-skannaukseen. Skripti kieltäytyy toimimasta tuotantoasetuksilla.

Testit:

```sh
vendor/bin/phpunit --testdox
vendor/bin/phpstan analyse --memory-limit=1G
node --test tests/js/*.test.mjs
scripts/verify-vendor.sh
scripts/e2e.sh          # selaintestit: oikea Chrome (headless) ja virtuaalinen passkey
```

Selaintestit (`tests/e2e/`) käynnistävät oman palvelimen väliaikaisella tietokannalla. Ne ajavat
hallinnan ja osallistujan rinnakkain omissa ikkunoissaan ja todentavat hyväksymistestejä, ks.
[docs/hyvaksymistestit.md](docs/hyvaksymistestit.md). Ne vaativat Chromen (macOS:llä valmiina, muuten `CHROME=...`).

## Selainkirjastot

`public/assets/vendor/` sisältää [libsodium.js](https://github.com/jedisct1/libsodium.js)- ja
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)-kirjastot (molemmat avointa lähdekoodia, lisenssit samassa hakemistossa).
Ne haetaan suoraan lähderepoista komennolla `scripts/update-vendor.sh`, ja niiden SHA-256-summat lukitaan tiedostoon `VENDOR.lock`.
Kirjastoja ei ladata CDN:stä.

## Tila

MMoIT 2026 -kurssin vaatimukset on toteutettu, ja kuormitustesti 150 osallistujalla meni läpi tuotannossa.
Hyväksymistestit ja niiden todennus: [docs/hyvaksymistestit.md](docs/hyvaksymistestit.md).
Kehitystehtävät, user storyt ja määrittelyt ovat backlogina [GitHub Issuesissa](https://github.com/hessuj/hessutalks/issues). Kysymysten tykkäykset (Q&A, COULD) on jätetty pois.

## Lisenssi

MIT, © Hessu Järvinen
