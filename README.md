# HessuTalks

Päästä päähän salattu kysymys- ja palautekanava luennoille ja puheille.
Osallistujat liittyvät luennolle koodilla tai QR-koodilla ja lähettävät kysymyksiä nimimerkillä.
Vain luennoitsija voi lukea viestit.

Osoite: <https://hessujarvinen.com/softa/hessutalks/>

## Miten se toimii

1. Luennoitsija luo hallintanäkymässä luennon. Sovellus antaa 6-merkkisen koodin ja QR-koodin.
2. Osallistuja avaa sivun, valitsee nimimerkin ja kirjoittaa kysymyksen tai palautteen.
3. Viesti ja nimimerkki salataan osallistujan selaimessa luennoitsijan julkisella avaimella.
4. Luennoitsija avaa viestit omassa selaimessaan tunnuslauseella. Ne päivittyvät reaaliaikaisesti,
   ja yksittäisen kysymyksen voi näyttää projektorilla.

### Ei henkilötietoja

- Nimimerkki on pakollinen ja uniikki luennon sisällä. Palvelin tallentaa siitä vain avaimellisen tiivisteen.
- Selain muistaa nimimerkin ja satunnaisen omistajatunnisteen (localStorage). Vain sama selain voi
  käyttää varattua nimimerkkiä, ja seuraavalla luennolla sama nimimerkki ehdotetaan valmiiksi.
- Ei sähköposteja, nimiä, evästeitä, analytiikkaa eikä IP-osoitteiden tallennusta osallistujista.

## Tietoturva lyhyesti

| Kerros | Ratkaisu |
|---|---|
| Viestien luottamuksellisuus | libsodium `crypto_box_seal` (X25519 + XSalsa20-Poly1305) selaimessa |
| Yksityinen avain | Salattu selaimessa tunnuslauseella (Argon2id, 64 MiB), palvelin ei näe tunnuslausetta |
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

## Käyttöönotto (cPanel)

Hakemistorakenne webhotellissa:

```
~/hessujarvinen.com/softa/hessutalks/   FTP-tunnuksen juuri = sovelluksen URL-kansio  ← deploy
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
   Directory-kentäksi sovelluksen URL-kansio, esim. `hessujarvinen.com/softa/hessutalks`.
3. **GitHub:** repo → *Settings → Environments* → luo ympäristö `production` ja lisää siihen secretit:
   - `FTP_SERVER`: esim. `ftp.hessujarvinen.com`
   - `FTP_USERNAME`: FTP-tilin koko käyttäjätunnus
   - `FTP_PASSWORD`: FTP-tilin salasana

   Jos sovellus ei ole osoitteessa `https://hessujarvinen.com/softa/hessutalks`, lisää
   *Settings → Secrets and variables → Actions → Variables* -kohtaan muuttuja `APP_URL`.
   Halutessasi lisää ympäristöön *Required reviewers* → itsesi, jolloin jokainen julkaisu odottaa hyväksyntääsi.
4. **Asetustiedosto:** aja omalla koneellasi repon juuressa:
   ```sh
   php bin/init.php --origin=https://hessujarvinen.com --base=/softa/hessutalks \
       --data=/home/CPANEL-KÄYTTÄJÄ/hessutalks-data --out=config.php
   ```
   `--base` on sovelluksen polku URL:ssa ja `--data` kotihakemistosi alla oleva kansio
   (cPanelin etusivulla näkyy *Home Directory*). Komento tulostaa **käyttöönottotunnuksen**, joka kannattaa tallentaa hetkeksi.
   Luo cPanelin *File Managerilla* kotihakemistoon kansio `hessutalks-data` (oikeudet `700`), lataa `config.php` sinne
   (oikeudet `600`) ja poista se omalta koneeltasi. Sovellus löytää tiedoston automaattisesti.
5. **Julkaisu:** push `main`-haaraan tai *Actions → CI/CD → Run workflow*.
6. **Ensimmäinen kirjautuminen:** avaa `https://hessujarvinen.com/softa/hessutalks/admin`, syötä käyttöönottotunnus ja luo passkey.
   Luo sen jälkeen salausavaimet tunnuslauseella. Tallenna tunnuslause salasanojen hallintaan
   ja talleta ladattu varmuuskopiotiedosto turvaan.
7. **Varapasskey:** lisää *Asetukset*-sivulta toinen passkey esimerkiksi puhelimeen.

## Kehitys omalla koneella

```sh
composer install
php bin/init.php --dev                  # luo var/config.php ja tulostaa käyttöönottotunnuksen
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
```

Hallinta: <http://localhost:8080/admin>. Passkeyt toimivat `localhost`-osoitteessa ilman HTTPS:ää.

Testit:

```sh
vendor/bin/phpunit --testdox
vendor/bin/phpstan analyse
node --test tests/js/*.test.mjs
scripts/verify-vendor.sh
```

## Selainkirjastot

`public/assets/vendor/` sisältää [libsodium.js](https://github.com/jedisct1/libsodium.js)- ja
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)-kirjastot (molemmat avointa lähdekoodia, lisenssit samassa hakemistossa).
Ne haetaan suoraan lähderepoista komennolla `scripts/update-vendor.sh`, ja niiden SHA-256-summat lukitaan tiedostoon `VENDOR.lock`.
Kirjastoja ei ladata CDN:stä.

## Tulossa

Sanapilvi, kysymyksiin vastaaminen osallistujille näkyvästi, äänestys kysymyksistä.

## Lisenssi

MIT, © Hessu Järvinen
