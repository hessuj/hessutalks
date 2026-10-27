# HessuTalks – ohjeet Claudelle

Kieli: keskustele, kommentoi ja kirjoita commit-viestit suomeksi. Hessu opettelee kehityksen
työnkulkua: selitä lyhyesti, mitä teet ja miksi (git, testit, CI), ja näytä komennot.

## Mikä tämä on
Päästä päähän salattu kysymys- ja palautekanava luennoille. Tuotannossa https://hessujarvinen.com/hessutalks/
Katso README.md (käyttö, käyttöönotto) ja SECURITY.md (uhkamalli). Älä heikennä tietoturvaratkaisuja.

## Ehdottomat periaatteet
- **Ei henkilötietoja osallistujista**: ei nimiä, sähköposteja, evästeitä, IP-osoitteiden tallennusta.
  Pakollinen, luennolla uniikki nimimerkki; palvelimella vain sen HMAC-tiiviste.
- **Viestit ja nimimerkit salataan selaimessa** (libsodium `crypto_box_seal`). Palvelin ei saa koskaan nähdä selväkielistä sisältöä.
  Kyselyvastaukset salataan samoin, ja tulokset lasketaan luennoitsijan selaimessa. Vain luennoitsijan
  julkaisema sisältö (kyselyn kysymys ja vaihtoehdot) on selväkielisenä. Uudet ominaisuudet on suunniteltava tämän rajoitteen mukaan.
- Purettu sisältö DOMiin vain `textContent`illa. Ei inline-skriptejä (tiukka CSP). Ei CDN-kirjastoja.
- Kaikki SQL parametrisoituna `Database`-luokan kautta.
- Oikeat vastaukset ja selitykset (`config.correct`, `config.explanations`) eivät saa päätyä osallistujalle
  ennen paljastusta: käytä `PollRepository::publicConfig()`.

## Rakenne
```
public/            index.php (front controller), .htaccess, assets/ (css, js, vendor)
src/               PHP 8.4, PSR-4 HessuTalks\ – App (reititys), I18n (fi/en), Controller/, Repository/, Auth/, Security/, Http/
templates/         PHP-templatet, escapoi aina $e():llä
migrations/        SQL-migraatiot (ajetaan automaattisesti), numeroidaan juoksevasti (001_, 002_ …)
tests/Unit, tests/Security   PHPUnit; tests/js  Node-testit (krypto, kyselytulokset, PRF)
tests/e2e          selaintestit (headless Chrome, virtuaalinen passkey), ajo scripts/e2e.sh
bin/init.php       asetustiedoston luonti; bin/dev-router.php kehityspalvelin; bin/seed-demo.php testiluento (dev/CI)
.zap/rules.tsv     ZAP baseline -säännöt (FAIL/WARN/IGNORE)
```
Osallistujan tekstit ovat `src/I18n.php`:ssä molemmilla kielillä (testi valvoo). Hallinta on vain suomeksi.

## Komennot
```sh
composer install
php bin/init.php --dev                 # var/config.php + käyttöönottotunnus
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
vendor/bin/phpunit --testdox           # aja aina ennen committia
vendor/bin/phpstan analyse --memory-limit=1G
node --test tests/js/*.test.mjs
scripts/verify-vendor.sh
scripts/e2e.sh                         # selaintestit; aja käyttöliittymämuutosten jälkeen
```
Lisää jokaiselle uudelle ominaisuudelle testit, myös tietoturvatestit (`tests/Security`).

## Työnkulku
- Tee muutokset omaan haaraan (`git switch -c ominaisuus/nimi`), pushaa ja avaa pull request.
  CI ajaa testit ja tietoturvaskannaukset PR:lle. Merge `main`iin julkaisee tuotantoon automaattisesti.
- Älä pushaa suoraan `main`iin ilman Hessun lupaa.
- Commit-viestit suomeksi, lyhyt otsikko + tarvittaessa perustelu.
- Dependabot avaa viikoittain PR:t Actions- ja Composer-päivityksistä. `@dependabot rebase` voi sulkea
  vanhan PR:n ja avata uuden, jos ryhmään on tullut päivityksiä. Seuraa silloin uutta PR:ää.

## Julkaisu (GitHub Actions → cPanel)
- FTPS-tunnus on rajattu kansioon `~/public_html/hessutalks/`. Sovelluskoodi menee `app/`-alikansioon (pääsy estetty).
- Asetukset, tietokanta ja istunnot: `~/hessutalks-data/` webrootin ulkopuolella – deploy ei koske niihin.
- Secretit `production`-ympäristössä: FTP_SERVER, FTP_USERNAME, FTP_PASSWORD. Muuttuja APP_URL.
- Actionit on lukittu commit-SHA:han. Päivitä SHA ja versiokommentti yhdessä.
- Selainkirjastot päivitetään vain `scripts/update-vendor.sh`-skriptillä (SHA-256-lukitus).

## Tulossa
MMoIT 2026 -kurssin vaatimukset (tapahtuma 13.–14.11.2026, ei julkaisuja tapahtuman aikana).
Tila ja hyväksymistestit: docs/hyvaksymistestit.md. Valmiina: passkey-avaus (PRF), sarjat ja aktiivinen kysymys, JSON-tuonti/vienti (src/Import/SetFormat.php).
Seuraavaksi: avoin teksti + moderointi (lisää myös SetFormatiin type open), oikea vastaus/paljastus, esitysnäkymä + pikanäppäimet,
nopeusrajat + julkaisujäädytys.
