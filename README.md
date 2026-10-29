# HessuTalks

**Suomi** · [English](README.en.md)

Päästä päähän salattu kysymys- ja palautekanava luennoille ja puheille.
Osallistujat liittyvät luennolle koodilla tai QR-koodilla ja lähettävät kysymyksiä nimimerkillä.
Vain luennoitsija voi lukea viestit.

Osoite: <https://hessujarvinen.com/hessutalks/>

## Miten se toimii

1. Luennoitsija luo hallintanäkymässä luennon. Sovellus antaa 6-merkkisen koodin ja QR-koodin.
2. Osallistuja avaa sivun, valitsee nimimerkin ja kirjoittaa kysymyksen tai palautteen.
3. Viesti ja nimimerkki salataan osallistujan selaimessa luennoitsijan julkisella avaimella.
4. Luennoitsija avaa viestit omassa selaimessaan passkeylla tai tunnuslauseella. Ne päivittyvät reaaliaikaisesti,
   ja QR-koodin, yksittäisen kysymyksen tai kysymyslistan voi näyttää projektorilla.

### Kyselyt ja kysymyssarjat

Luento koostuu **kysymyssarjoista** (esim. moduulit `M1`, `M4`), joissa on kysymykset järjestyksessä.
Kysymystyypit: monivalinta (yksi tai useita vastauksia), avoin teksti (oletus 280 merkkiä, pohdintatehtäviin enintään 3 500 eli noin 500 sanaa, valinnaisesti useita vastauksia), sanapilvi (1–3 sanaa, 30 merkkiä), Likert-asteikko (5 tai 7 kohtaa) ja asteikko 0–10.

Yksi luento voi kattaa koko kurssin tai luentosarjan: sarjat jakavat sen luentoihin (esim. `L1`–`L4`), ja osallistujat
käyttävät samaa koodia ja nimimerkkiä koko kurssin ajan. Hallinnan luentosivulla on kaksi välilehteä, *Kyselyt* ja
*Kysymykset ja palaute*. Ohjauspalkki näkyy kummallakin, ja viestivälilehti kertoo uusien viestien määrän.

Kyselyillä on kaksi tilaa: **Valmistelu** (kortit: luonti, muokkaus, järjestys, esikatselu, poisto) ja **▶ Luennolla**
(ohjauspalkki, aktiivisen kysymyksen tulokset ja moderointi sekä tiivis numeroitu lista; rivin klikkaus tekee kysymyksestä
aktiivisen). Luennolla-tilassa ei ole muokkaus- eikä poistonappeja.

1. Luo luennon sivulla sarjat (*Uusi sarja*) ja niihin kysymykset (*Uusi kysymys*) valmiiksi ennen luentoa.
   Sarjoja ja kysymyksiä voi siirtää nuolilla, ja sarjan voi **ohittaa** kesken luennon. Ohitetun sarjan
   kysymykset jäävät pois Seuraava/Edellinen-järjestyksestä, mutta niiden vastaukset säilyvät.
2. Luennolla on kerrallaan yksi **aktiivinen kysymys**, jonka kaikki osallistujat näkevät. Ohjauspalkissa:
   *Seuraava →* ja *← Edellinen* vaihtavat aktiivista kysymystä, *Avaa vastauksille* ja *Sulje vastaukset*
   ohjaavat vastaamista, ja *Odotusnäkymä* poistaa aktiivisen kysymyksen.
   Luonnos-tilainen aktiivinen kysymys näkyy projektorilla, mutta osallistujat näkevät odotusnäkymän
   (*Waiting for the next question…*), kunnes avaat sen. Vain aktiivinen kysymys voi olla auki.
3. Osallistujat käyttävät koko ajan samaa luennon QR-koodia tai linkkiä. Näkymä vaihtuu itsestään noin
   sekunnin viiveellä ilman sivun päivitystä. Yhteyskatkon jälkeen sivu yhdistää uudelleen, ja oma vastaus säilyy myös uudelleenlatauksessa.
4. **Tulokset ja paljastus:** tulokset ovat aluksi piilossa (projektorilla kysymys, vaihtoehdot ja vastausmäärä).
   *Näytä tulokset* tuo ne projektorille ja tuloskoosteena myös osallistujien puhelimiin (monivalinnat ja asteikot).
   *Paljasta oikea vastaus* korostaa oikeat vaihtoehdot ja näyttää selitykset, jos kysymykselle on määritelty oikea vastaus.
   Oikeat vastaukset ja selitykset annetaan kysymyslomakkeella tai JSON-tiedostossa, eikä niitä lähetetä osallistujille ennen paljastusta.
5. *Aktiivinen projektorille* avaa ikkunan, joka seuraa aktiivista kysymystä ja sen tuloksia (ilman aktiivista kysymystä
   siinä näkyy luennon QR-koodi). *Tulokset projektorille* näyttää yksittäisen kysymyksen tulokset omassa ikkunassaan.
6. **Moderointi:** avoimen vastauksen voi piilottaa *Piilota*-napilla ja sanapilven sanan klikkaamalla sitä. Piilotus katoaa projektorilta heti.
   Kirosanasuodatin (englanti ja suomi) piilottaa osumat automaattisesti, ja ne odottavat hyväksyntää (⚠ … ✓).
   Piilotukset tallennetaan palvelimelle salattuina luennoitsijan avaimella, joten ne säilyvät uudelleenlatauksen yli.

Kyselyyn vastataan ilman nimimerkkiä. Vastaukset salataan selaimessa kuten kysymyksetkin, ja tulokset
lasketaan luennoitsijan selaimessa, joten hallinnan pitää olla auki ja avattuna. Saman selaimen uusi vastaus
korvaa aiemman, kunnes kysely suljetaan.

#### Esikatselu, monistus, siirto ja CSV

- **Esikatsele** avaa kysymyksen osallistujan ulkoasussa (puhelimen kokoinen ikkuna, vastausta ei lähetetä) ja
  **Esikatsele projektorilla** esitysnäkymässä ennen avaamista.
- **Monista** kopioi sarjan kysymyksineen ilman vastauksia (tunniste saa jatkeen `-2`). Kysymyksen voi siirtää toiseen sarjaan
  valikosta *Siirrä sarjaan…*. Vastaukset säilyvät.
- **Vie CSV** (koko luento) ja sarjan **CSV**: kysymys, vaihtoehto tai teksti, vastausmäärä ja aikaleima, ei osallistujatunnisteita.
  Vastaukset puretaan selaimessasi, joten palvelin ei näe tiedoston sisältöä. Erotin `;` ja UTF-8-BOM, jolloin Excel avaa tiedoston suoraan.
  Kaavana alkavat tekstit (`=`, `+`, `-`, `@`) saavat eteensä heittomerkin (CSV-injektion esto).

#### Tuonti ja vienti JSON-tiedostona

*Tuo JSON* lukee sarjat tiedostosta, ja kysymykset voi pitää versionhallinnassa ja kopioida tulevia
kursseja varten. Ennen tallennusta sovellus näyttää yhteenvedon: tuotavat sarjat, ohitettavat kysymykset ja virheet.
Tuonti on kaikki tai ei mitään. Virhe (myös luennolla jo oleva sarjan tunniste) estää koko tuonnin.
*Vie JSON* (koko luento) ja sarjan *Vie* lataavat saman muodon takaisin. Esimerkki: [tests/fixtures/mmoit-2026.json](tests/fixtures/mmoit-2026.json).

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

### Esitysnäkymä, pikanäppäimet ja puhelinohjain

*Aktiivinen projektorille* on luennon pääesitysnäkymä Teams-jakoon ja salin projektorille. Kulmassa ovat aina
QR-koodi, liittymiskoodi ja vastausmäärä, ja kysymys on isolla fontilla (yli 40 px 1080p:llä).

| Näppäin | Toiminto |
|---|---|
| → / PageDown | Seuraava kysymys (myös langaton esitysohjain) |
| ← / PageUp | Edellinen kysymys |
| Välilyönti | Avaa / sulje vastaukset |
| R | Näytä / piilota tulokset |
| A | Paljasta oikea vastaus |
| Q | Iso QR-koodi koko näytölle |
| T | Vaalea / tumma teema (esitysikkuna) |
| F tai kaksoisklikkaus | Koko näyttö (esitysikkuna) |

Näppäimet toimivat esitysikkunassa ja hallinnassa (ei lomakekentissä). Esitysikkuna ei käytä rajapintaa itse,
vaan lähettää komennon hallintaikkunalle.

**Puhelinohjain:** kirjaudu puhelimella hallintaan ja valitse *Puhelinohjain* (avausnäkymässä) tai luennon *Ohjain*.
Isot napit ohjaavat aktiivista kysymystä kävellessä salissa. Ohjain ei pura viestejä, joten salausavainta ei tarvita.
Projektoria ohjaava läppäri huomaa muutokset parissa sekunnissa.

### Esitys projektorilla

Kun projektori on kytketty jatketuksi näytöksi (ei peilaus), luennon *…projektorille*-napit avaavat
erillisen esitysikkunan (`/admin/esitys`) toiselle näytölle. Hallintanäkymä jää läppärin näytölle.

- Chrome ja Edge sijoittavat ikkunan automaattisesti (Window Management API). Ensimmäisellä kerralla
  selain kysyy luvan *ikkunoiden hallintaan*. Jos ponnahdusikkuna estyy luvan kysymisen takia, paina nappia uudelleen.
- Muissa selaimissa ikkuna aukeaa tavallisena ikkunana: raahaa se projektorin näytölle.
- Kaksoisklikkaus tai F-näppäin vaihtaa koko näytön tilaan, Esc palauttaa.
- Kysymykset, palautteet ja jokainen kysely avautuvat omiin ikkunoihinsa, jotka voivat olla auki yhtä aikaa.
  Listat ja tulokset päivittyvät automaattisesti. Napin painaminen tuo ikkunan eteen.
- *Tyhjennä projektori* tyhjentää näytön. Näyttö tyhjenee myös uloskirjautuessa ja hallintasivun sulkeutuessa.

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
| Istunto | `__Host-`-eväste, `HttpOnly`, `Secure`, `SameSite=Strict`, 30 min toimettomuus / 8 h enintään |
| CSRF | Origin- ja `Sec-Fetch-Site`-tarkistus + CSRF-token (ylläpito) / tilaton HMAC-lomaketoken (osallistuja) |
| XSS | Tiukka CSP ilman `unsafe-inline`-sääntöä, puretut viestit DOMiin vain `textContent`illa |
| Väärinkäyttö | Nimimerkki- ja luentokohtaiset rajat, haasteiden kertakäyttöisyys, tietoturvaloki |
| Tallennus | SQLite webrootin ulkopuolella, parametrisoidut kyselyt, `secure_delete` |

Tarkempi uhkamalli ja jäännösriskit: [SECURITY.md](SECURITY.md).

## CI/CD-putki

Jokainen push ja pull request ajaa:

- **PHPUnit**: yksikkötestit ja tietoturvatestit (CSRF, origin, pääsynhallinta, injektiot, XSS,
  nimimerkkien omistajuus, rate limit, istuntojen aikakatkaisut, turvaotsakkeet, henkilötietojen puuttuminen)
- **PHPStan** taso 8 + strict rules
- **composer audit**: tunnetut haavoittuvuudet riippuvuuksissa
- **Semgrep (SAST)**: PHP, JavaScript, OWASP Top 10, salaisuudet
- **Gitleaks**: vuotaneet salaisuudet koko git-historiasta
- **OWASP ZAP baseline (DAST)**: käynnissä olevan sovelluksen skannaus
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

## Käyttöönotto (cPanel)

Hakemistorakenne webhotellissa:

```
~/public_html/hessutalks/               FTP-tunnuksen juuri = sovelluksen URL-kansio  ← deploy
    index.php, .htaccess, assets/       julkiset tiedostot
    app/                                sovelluskoodi, suora pääsy estetty
~/hessutalks-data/                      config.php, tietokanta, istunnot  ← webrootin ulkopuolella,
                                        deploy ei koske tähän
```

Deploy-tunnus on rajattu pelkkään sovelluksen kansioon. Vaikka tunnus vuotaisi, sillä ei pääse
käsiksi tietokantaan eikä muihin sivuston osiin.

1. **PHP-versio:** cPanel → *MultiPHP Manager* → oma domain → **PHP 8.4**.
   Varmista, että laajennukset `sodium`, `pdo_sqlite`, `mbstring` ja `intl` ovat päällä (*Select PHP Version → Extensions*).
2. **FTP-tili:** cPanel → *FTP Accounts* → oma tili julkaisulle. Valitse nimi, jota ei voi arvata (esim. satunnainen jatke), ja pitkä satunnainen salasana.
   Directory-kentäksi sovelluksen kansio sivuston juuren (`public_html`) alla: `public_html/hessutalks`.
3. **GitHub:** (julkaisu käynnistyy pushista `main`-haaraan tai *Actions → CI/CD → Run workflow*) repo → *Settings → Environments* → luo ympäristö `production` ja lisää siihen secretit:
   - `FTP_SERVER`: webhotellin FTP-palvelin (esim. `ftp.example.com`)
   - `FTP_USERNAME`: FTP-tilin koko käyttäjätunnus
   - `FTP_PASSWORD`: FTP-tilin salasana

   Jos sovellus ei ole osoitteessa `https://hessujarvinen.com/hessutalks`, lisää
   *Settings → Secrets and variables → Actions → Variables* -kohtaan muuttuja `APP_URL`.
   Halutessasi lisää ympäristöön *Required reviewers* → itsesi, jolloin jokainen julkaisu odottaa hyväksyntääsi.
4. **Asetustiedosto:** kun sovellus on julkaistu kerran, avaa cPanel → *Terminal* ja aja:
   ```sh
   php ~/public_html/hessutalks/app/bin/init.php --origin=https://example.com --base=/hessutalks
   ```
   Komento luo tiedoston `~/hessutalks-data/config.php` suoraan oikeaan paikkaan kotihakemistoon
   sivuston ulkopuolelle oikeilla tiedosto-oikeuksilla. Se tulostaa **käyttöönottotunnuksen**, joka kannattaa tallentaa hetkeksi.
   Sovellus löytää asetukset automaattisesti.

   *Jos cPanelissa ei ole Terminalia:* aja sama komento omalla koneella repon juuressa (`php bin/init.php … --data=/home/CPANEL-KÄYTTÄJÄ/hessutalks-data --out=config.php`,
   vaatii PHP:n, esim. `brew install php`). Lataa sitten `config.php` File Managerilla kotihakemiston kansioon `hessutalks-data` (oikeudet `700`/`600`).
5. **Ensimmäinen kirjautuminen:** avaa `https://example.com/hessutalks/admin`, syötä käyttöönottotunnus ja luo passkey.
   Luo sen jälkeen salausavaimet tunnuslauseella. Tallenna tunnuslause salasanojen hallintaan
   ja talleta ladattu varmuuskopiotiedosto turvaan.
6. **Varapasskey:** lisää *Asetukset*-sivulta toinen passkey esimerkiksi puhelimeen.
7. **Avaus passkeylla:** kirjaudu kullakin passkeylla kerran ja avaa avain tunnuslauseella. Sovellus
   tallentaa passkeykohtaisen salatun kopion, ja sen jälkeen pelkkä Touch ID / Face ID avaa myös kysymykset.
   Vaatii PRF-tuen (Safari 18 / macOS 15 / iOS 18, Chrome, Edge). Muuten tunnuslause kysytään kuten ennenkin.

## Kehitys omalla koneella

```sh
composer install
php bin/init.php --dev                  # luo var/config.php ja tulostaa käyttöönottotunnuksen
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
```

Hallinta: <http://localhost:8080/admin>. Passkeyt toimivat `localhost`-osoitteessa ilman HTTPS:ää.

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

MMoIT 2026 -kurssin vaatimukset (13.–14.11.2026) on toteutettu, ja kuormitustesti 150 osallistujalla meni läpi tuotannossa 29.10.2026.
Hyväksymistestit ja niiden todennus: [docs/hyvaksymistestit.md](docs/hyvaksymistestit.md).
Jäljellä: koeajo oikeilla laitteilla ja Teamsilla. 200 osallistujan kuormitustesti on siirretty, ja kysymysten tykkäykset (Q&A, COULD) on jätetty pois.

## Lisenssi

MIT, © Hessu Järvinen
