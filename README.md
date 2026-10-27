# HessuTalks

Päästä päähän salattu kysymys- ja palautekanava luennoille ja puheille.
Osallistujat liittyvät luennolle koodilla tai QR-koodilla ja lähettävät kysymyksiä nimimerkillä.
Vain luennoitsija voi lukea viestit.

Osoite: <https://hessujarvinen.com/hessutalks/>

## Miten se toimii

1. Luennoitsija luo hallintanäkymässä luennon. Sovellus antaa 6-merkkisen koodin ja QR-koodin.
2. Osallistuja avaa sivun, valitsee nimimerkin ja kirjoittaa kysymyksen tai palautteen.
3. Viesti ja nimimerkki salataan osallistujan selaimessa luennoitsijan julkisella avaimella.
4. Luennoitsija avaa viestit omassa selaimessaan tunnuslauseella. Ne päivittyvät reaaliaikaisesti,
   ja QR-koodin, yksittäisen kysymyksen tai kysymyslistan voi näyttää projektorilla.

### Kyselyt ja kysymyssarjat

Luento koostuu **kysymyssarjoista** (esim. moduulit `M1`, `M4`), joissa on kysymykset järjestyksessä.
Kysymystyypit: monivalinta (yksi tai useita vastauksia), sanapilvi, Likert-asteikko (5 tai 7 kohtaa) ja asteikko 0–10.

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
4. *Aktiivinen projektorille* avaa ikkunan, joka seuraa aktiivista kysymystä ja sen tuloksia (ilman aktiivista kysymystä
   siinä näkyy luennon QR-koodi). *Tulokset projektorille* näyttää yksittäisen kysymyksen tulokset omassa ikkunassaan.
5. Sanapilvessä sopimattoman sanan voi piilottaa klikkaamalla sitä hallinnan tuloksissa.

Kyselyyn vastataan ilman nimimerkkiä. Vastaukset salataan selaimessa kuten kysymyksetkin, ja tulokset
lasketaan luennoitsijan selaimessa, joten hallinnan pitää olla auki ja avattuna. Saman selaimen uusi vastaus
korvaa aiemman, kunnes kysely suljetaan.

**Osallistujien kieli** valitaan luennolle (luontilomake tai luennon sivu): *English*, *Suomi* tai selaimen kielen mukaan.
Osallistuja voi silti vaihtaa kieltä FI/EN-kytkimestä.

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

1. **PHP-versio:** cPanel → *MultiPHP Manager* → hessujarvinen.com → **PHP 8.4** (ea-php84).
   Varmista, että laajennukset `sodium`, `pdo_sqlite`, `mbstring` ja `intl` ovat päällä (*Select PHP Version → Extensions*).
2. **FTP-tili:** cPanel → *FTP Accounts* → esim. `deploy-hessutalks@hessujarvinen.com`.
   Directory-kentäksi sovelluksen kansio sivuston juuren (`public_html`) alla: `public_html/hessutalks`.
3. **GitHub:** (julkaisu käynnistyy pushista `main`-haaraan tai *Actions → CI/CD → Run workflow*) repo → *Settings → Environments* → luo ympäristö `production` ja lisää siihen secretit:
   - `FTP_SERVER`: esim. `ftp.hessujarvinen.com`
   - `FTP_USERNAME`: FTP-tilin koko käyttäjätunnus
   - `FTP_PASSWORD`: FTP-tilin salasana

   Jos sovellus ei ole osoitteessa `https://hessujarvinen.com/hessutalks`, lisää
   *Settings → Secrets and variables → Actions → Variables* -kohtaan muuttuja `APP_URL`.
   Halutessasi lisää ympäristöön *Required reviewers* → itsesi, jolloin jokainen julkaisu odottaa hyväksyntääsi.
4. **Asetustiedosto:** kun sovellus on julkaistu kerran, avaa cPanel → *Terminal* ja aja:
   ```sh
   php ~/public_html/hessutalks/app/bin/init.php --origin=https://hessujarvinen.com --base=/hessutalks
   ```
   Komento luo tiedoston `~/hessutalks-data/config.php` suoraan oikeaan paikkaan kotihakemistoon
   sivuston ulkopuolelle oikeilla tiedosto-oikeuksilla. Se tulostaa **käyttöönottotunnuksen**, joka kannattaa tallentaa hetkeksi.
   Sovellus löytää asetukset automaattisesti.

   *Jos cPanelissa ei ole Terminalia:* aja sama komento omalla koneella repon juuressa (`php bin/init.php … --data=/home/CPANEL-KÄYTTÄJÄ/hessutalks-data --out=config.php`,
   vaatii PHP:n, esim. `brew install php`). Lataa sitten `config.php` File Managerilla kotihakemiston kansioon `hessutalks-data` (oikeudet `700`/`600`).
5. **Ensimmäinen kirjautuminen:** avaa `https://hessujarvinen.com/hessutalks/admin`, syötä käyttöönottotunnus ja luo passkey.
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

## Tulossa

MMoIT 2026 -kurssin vaatimukset (13.–14.11.2026), tilanne: [docs/hyvaksymistestit.md](docs/hyvaksymistestit.md).

- JSON-tuonti ja -vienti kysymyssarjoille
- Avoin teksti (280 merkkiä) ja pysyvä moderointi, myös sanapilvelle
- Oikea vastaus, selitykset ja paljastus; tulosten näyttö ja piilotus
- Yksi esitysnäkymä pikanäppäimineen (QR kulmassa, vastausmäärä, Teams-luettavuus)
- Nopeusrajat osoitteen mukaan (vain tiiviste, 10 min) ja julkaisujäädytys tapahtuman ajaksi

## Lisenssi

MIT, © Hessu Järvinen
