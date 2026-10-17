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

### Kyselyt

Luentoon voi liittää kyselyitä: monivalinta (yksi tai useita vastauksia), sanapilvi, Likert-asteikko
(5 tai 7 kohtaa) ja asteikko 0–10.

1. Luo kyselyt hallinnassa luennon sivulla valmiiksi ja lataa kunkin **QR-koodi** (PNG) luentokalvoon.
2. Avaa kysely luennolla napista *Avaa kysely*. Kuulijat vastaavat kalvon QR-koodilla tai luennon
   tavallisella sivulla, jolle avoimet kyselyt ilmestyvät automaattisesti.
3. *Tulokset projektorille* avaa kyselyn tulokset omaan ikkunaansa. Kaaviot ja sanapilvi päivittyvät
   reaaliajassa (muutaman sekunnin viiveellä), ja ikkunan alareunassa on QR-koodi myöhässä tuleville.
4. Sanapilvessä sopimattoman sanan voi piilottaa klikkaamalla sitä hallinnan tuloksissa.

Kyselyyn vastataan ilman nimimerkkiä. Vastaukset salataan selaimessa kuten kysymyksetkin, ja tulokset
lasketaan luennoitsijan selaimessa, joten hallinnan pitää olla auki ja avattuna tunnuslauseella.
Saman selaimen uusi vastaus korvaa aiemman.

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
