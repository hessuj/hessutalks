# HessuTalksin asennus

**Suomi** · [English](installation.md)

HessuTalks on PHP-sovellus, joka asennetaan web-palvelimelle omaan hakemistoonsa. Se ei tarvitse
tietokantapalvelinta (tietokanta on SQLite-tiedosto), taustaprosesseja eikä ajastettuja tehtäviä. Ohje on
yleinen: se toimii jaetussa webhotellissa, omassa virtuaalipalvelimessa ja konttiympäristössä, kunhan
alla luetellut vaatimukset täyttyvät.

## Periaate

Sovellus koostuu kolmesta osasta:

| Osa | Sisältö | Näkyy verkkoon | PHP kirjoittaa |
|---|---|---|---|
| Julkinen hakemisto | `index.php`, `.htaccess`, `assets/`, `live/` | kyllä | vain `live/` |
| Sovelluskoodi `app/` | `src/`, `templates/`, `migrations/`, `vendor/`, `bin/init.php` | **ei** | ei |
| Datahakemisto | `config.php`, `hessutalks.sqlite`, `sessions/` | **ei, webrootin ulkopuolella** | kyllä |

```
<webroot>/hessutalks/          julkinen hakemisto = https://example.com/hessutalks
    index.php                  front controller: kaikki pyynnöt tulevat tänne
    .htaccess                  Apachen säännöt (muut palvelimet: ks. Verkkopalvelimen asetukset)
    assets/                    CSS, JavaScript, selainkirjastot
    live/                      osallistujien tilatiedostot, jotka palvelin jakaa staattisina
    app/                       sovelluskoodi, suora pääsy estetty
<datahakemisto>/               esim. ~/hessutalks-data, ei koskaan webrootin alla
    config.php                 asetukset ja salaisuudet (bin/init.php luo)
    hessutalks.sqlite          tietokanta (luodaan ja päivitetään automaattisesti)
    sessions/                  ylläpitäjän istunnot
```

Julkaisu korvaa vain julkisen hakemiston ja `app/`-kansion. Datahakemistoon julkaisu ei koske, joten
sovelluksen voi päivittää ilman, että asetukset tai luennot katoavat.

Julkisen hakemiston nimi ja paikka ovat vapaat. Sovellus voi olla domainin juuressa (`https://example.com/`)
tai alihakemistossa (`https://example.com/hessutalks`). Polku annetaan asetuksissa (`--base`).

### Miten sovellus löytää koodinsa ja asetuksensa

`index.php` etsii sovelluskoodia ja asetustiedostoa tässä järjestyksessä:

1. **Sovelluskoodi:** ympäristömuuttuja `HESSUTALKS_APP_ROOT`, muuten kansio `app/` `index.php`:n vieressä.
2. **Asetukset:** ympäristömuuttuja `HESSUTALKS_CONFIG`, muuten `hessutalks-data/config.php`
   PHP-prosessin käyttäjän kotihakemistossa, muuten `hessutalks-data/config.php` julkisen hakemiston
   yläkansioissa (enintään viisi tasoa ylöspäin).

Jaetussa webhotellissa oletukset riittävät yleensä sellaisinaan. Omalla palvelimella aseta
`HESSUTALKS_CONFIG` aina itse. Esimerkiksi `www-data`-käyttäjän kotihakemisto voi olla webrootin alla, ja
silloin oletuspaikka olisi verkosta luettavissa.

Jos asetustiedostoa tai sovelluskoodia ei löydy, sovellus vastaa `503 Palvelu ei ole vielä käytettävissä`.

## Vaatimukset

- **PHP 8.4** tai uudempi ja laajennukset `sodium`, `pdo_sqlite`, `mbstring`, `intl` ja `openssl`.
  `posix` on valinnainen (kotihakemiston tunnistus).
- **HTTPS.** Passkeyt (WebAuthn) ja `__Host-`-istuntoeväste toimivat vain suojatussa yhteydessä.
  `bin/init.php` ei hyväksy tuotannossa muuta kuin `https://`-osoitteen.
- **Verkkopalvelin**, joka osaa ohjata pyynnöt `index.php`:lle, estää pääsyn sovelluskoodiin ja
  lisätä turvaotsakkeet staattisiin tiedostoihin. Apachen säännöt tulevat paketin mukana. Muille
  palvelimille säännöt kirjoitetaan itse (ks. alla).
- **Komentorivi palvelimella** asetustiedoston luontiin. Jos komentoriviä ei ole, tiedoston voi luoda omalla
  koneella ja siirtää palvelimelle.
- Paketin rakentamiseen: PHP, [Composer](https://getcomposer.org/) ja tämä repo. Palvelimella Composeria ei tarvita.

## 1. Paketin rakentaminen

Julkaisupaketti rakennetaan repon juuressa samalla tavalla kuin CI tekee sen (`.github/workflows/ci.yml`):

```sh
composer install --no-dev --no-interaction --optimize-autoloader --classmap-authoritative
scripts/verify-vendor.sh                    # selainkirjastojen SHA-256-tarkistus
mkdir -p build/app/bin
cp -r public/. build/                       # julkinen hakemisto, myös .htaccess-tiedostot
cp -r src templates migrations vendor build/app/
cp bin/init.php build/app/bin/
git rev-parse --short HEAD > build/app/VERSION
printf 'Require all denied\n' > build/app/.htaccess
composer install                            # kehitysriippuvuudet takaisin omalle koneelle
```

`build/`-kansion sisältö on valmis julkinen hakemisto. Siinä ei ole asetuksia, tietokantaa eikä git-dataa.

## 2. Tiedostojen siirto

Siirrä `build/`-kansion sisältö palvelimen julkiseen hakemistoon millä tahansa tavalla: SFTP, FTPS, rsync,
kontti-image tai palvelimella ajettu rakennus. Hyvät käytännöt:

- Anna julkaisutunnukselle oikeudet vain julkiseen hakemistoon. Silloin vuotanut tunnus ei pääse käsiksi
  datahakemistoon eikä muuhun sivustoon.
- Älä siirrä datahakemistoa tai `config.php`:tä julkaisun mukana.
- `live/`-kansion on oltava PHP-prosessin kirjoitettavissa, ja verkkopalvelimen on voitava lukea sen tiedostot.
  Älä tyhjennä sitä luennon aikana: osallistujat lukevat luennon tilan sieltä.

## 3. Verkkopalvelimen asetukset

Sovellus lisää turvaotsakkeet (CSP, HSTS ym.) kaikkiin PHP:n vastauksiin itse. Verkkopalvelimen vastuulla on:

1. **HTTPS:** ohjaa `http://`-pyynnöt `https://`-osoitteeseen.
2. **Front controller:** pyyntö, joka ei osu olemassa olevaan tiedostoon, ohjataan `index.php`:lle niin, että
   alkuperäinen polku säilyy `REQUEST_URI`-muuttujassa.
3. **Sovelluskoodi:** `app/` ei näy verkkoon (403 tai 404). Vaihtoehtoisesti koodin voi sijoittaa webrootin
   ulkopuolelle ja asettaa `HESSUTALKS_APP_ROOT`.
4. **Vain `index.php` suoritetaan PHP:nä.** Muut `.php`-tiedostot eivät ole saatavilla.
5. **Piilotiedostot ja lähdetiedostot estetään:** `.`-alkuiset nimet sekä päätteet `.lock`, `.md`, `.sql`,
   `.sqlite`, `.ini`, `.log`, `.sh` ja `.dist`. Hakemistolistaus pois päältä.
6. **`live/`:** vain nimet, jotka ovat muotoa 32 heksamerkkiä + `.json`, jaetaan staattisina tiedostoina
   (`application/json`, `Cache-Control: no-store`). Puuttuva tiedosto on staattinen 404 eikä ohjaudu PHP:lle.
   Tämä pitää osallistujien sekunnin välein tekemät tilakyselyt poissa PHP:ltä.
7. **Turvaotsakkeet staattisiin tiedostoihin:** samat kuin `public/.htaccess`-tiedostossa
   (`X-Content-Type-Options`, `Content-Security-Policy`, `Cross-Origin-*`, `Strict-Transport-Security` ym.).

### Apache

Paketin `.htaccess`-tiedostot toteuttavat säännöt valmiiksi. Ne vaativat moduulit `mod_rewrite` ja `mod_headers`
sekä `.htaccess`-tiedostojen sallimisen (`AllowOverride All`, koska tiedoston `ServerSignature` ei kelpaa
rajatummalla asetuksella). Jaetuissa webhotelleissa nämä ovat yleensä valmiina. Omassa palvelimessa varmista
asetus virtuaalipalvelimen määrityksestä ja aseta asetustiedoston polku samassa paikassa (ei `.htaccess`iin,
jonka julkaisu korvaa):

```apache
<Directory /var/www/example.com/hessutalks>
    AllowOverride All
    SetEnv HESSUTALKS_CONFIG /srv/hessutalks-data/config.php
</Directory>
```

### Nginx ja PHP-FPM

Nginx ei lue `.htaccess`-tiedostoja, joten säännöt kirjoitetaan palvelimen määritykseen. Alla oleva esimerkki
olettaa, että sovellus on polussa `/hessutalks`. Muokkaa polut ja PHP-FPM:n socket omiksesi ja todenna lopputulos
kohdan [6. Tarkistus](#6-tarkistus) komennoilla. Esimerkkiä ei ajeta projektin CI:ssä.

```nginx
# Toistuvat otsakkeet omaan tiedostoon, esim. /etc/nginx/snippets/hessutalks-headers.conf:
#   add_header X-Content-Type-Options "nosniff" always;
#   add_header Referrer-Policy "no-referrer" always;
#   add_header X-Frame-Options "DENY" always;
#   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
#   add_header Cross-Origin-Resource-Policy "same-origin" always;
#   add_header Cross-Origin-Opener-Policy "same-origin" always;
#   add_header Cross-Origin-Embedder-Policy "require-corp" always;
#   add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
#   add_header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" always;

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name example.com;
    root /var/www/example.com;
    # ssl_certificate ja ssl_certificate_key
    server_tokens off;

    location = /hessutalks { return 301 /hessutalks/; }

    location ^~ /hessutalks/ {
        autoindex off;

        location ^~ /hessutalks/app/ { return 404; }
        location ~ /\. { return 404; }
        location ~ \.(lock|md|sql|sqlite|ini|log|sh|dist)$ { return 404; }

        location ^~ /hessutalks/live/ {
            location ~ ^/hessutalks/live/[0-9a-f]{32}\.json$ {
                default_type application/json;
                include snippets/hessutalks-headers.conf;
                add_header Cache-Control "no-store" always;
                try_files $uri =404;
            }
            return 404;
        }

        location ^~ /hessutalks/assets/ {
            include snippets/hessutalks-headers.conf;
            add_header Cache-Control "public, max-age=604800, immutable" always;
            try_files $uri =404;
        }

        location = /hessutalks/index.php {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root/hessutalks/index.php;
            fastcgi_param HESSUTALKS_CONFIG /srv/hessutalks-data/config.php;
            fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        }
        location ~ \.php$ { return 404; }

        try_files $uri /hessutalks/index.php$is_args$args;
    }
}
```

`HESSUTALKS_CONFIG` voidaan antaa myös PHP-FPM:n poolin asetuksissa: `env[HESSUTALKS_CONFIG] = /srv/hessutalks-data/config.php`.

### Muut palvelimet ja käänteinen välityspalvelin

Muilla palvelimilla (esim. Caddy, IIS) toteuta yllä luetellut seitsemän sääntöä palvelimen omalla tavalla.
PHP:n sisäänrakennettu palvelin (`php -S`) on tarkoitettu vain kehitykseen.

Jos TLS päättyy käänteiseen välityspalvelimeen tai kuormantasaajaan:

- `.htaccess` tunnistaa HTTPS:n myös otsakkeesta `X-Forwarded-Proto: https`.
- Välitä osallistujan osoite sovellukselle (`REMOTE_ADDR`), esim. Apachen `mod_remoteip` tai nginxin
  `real_ip`-moduuli. Muuten kaikki pyynnöt näyttävät tulevan samasta osoitteesta ja jakavat saman
  osoitekohtaisen nopeusrajan. Sovellus ei tallenna osoitetta: rajoitusta varten siitä lasketaan
  avaimellinen tiiviste, joka poistetaan aikaikkunan jälkeen.

### Palvelimen lokit

Sovellus ei tallenna IP-osoitteita, mutta verkkopalvelimen pääsyloki tallentaa ne yleensä. Rajaa lokien
säilytysaika (enintään 7 päivää, ks. [SECURITY.md](../SECURITY.md)) tai ota pääsyloki pois sovelluksen
polulta. Jaetussa webhotellissa säilytys asetetaan yleensä hallintapaneelista, esim. lokien arkistoinnin
asetuksista.

## 4. Asetustiedosto

Kun paketti on palvelimella, luo asetustiedosto palvelimen komentorivillä:

```sh
php <julkinen hakemisto>/app/bin/init.php --origin=https://example.com --base=/hessutalks --data=/srv/hessutalks-data
```

| Valinta | Merkitys |
|---|---|
| `--origin` | Sovelluksen julkinen origin ilman polkua, `https://` pakollinen |
| `--base` | Polku, jossa sovellus näkyy, esim. `/hessutalks`. Domainin juuressa `--base=/` |
| `--data` | Datahakemisto. Oletus `~/hessutalks-data` (komennon ajajan kotihakemisto) |
| `--out` | Asetustiedoston polku. Oletus `<data>/config.php` |
| `--rp-id` | WebAuthn-tunniste. Oletus originin palvelinnimi |
| `--name` | Ylläpitäjän näyttönimi |
| `--force` | Korvaa olemassa oleva tiedosto (uusi `app_secret` mitätöi avoimet lomakkeet) |

Komento luo datahakemiston (oikeudet `700`) ja `config.php`:n (`600`). Se tulostaa **käyttöönottotunnuksen**,
jolla ensimmäinen passkey rekisteröidään. Tunnus näytetään vain kerran.

- Aja komento **samana käyttäjänä, jona PHP suoritetaan**, tai anna datahakemisto sen omistukseen
  (`chown -R`). PHP:n pitää voida kirjoittaa tietokantaan ja istuntoihin, eikä muiden käyttäjien pidä nähdä niitä.
- Jos datahakemisto ei ole oletuspaikassa (ks. [Miten sovellus löytää koodinsa ja asetuksensa](#miten-sovellus-löytää-koodinsa-ja-asetuksensa)),
  aseta `HESSUTALKS_CONFIG` verkkopalvelimen tai PHP-FPM:n asetuksissa.
- **Jos palvelimella ei ole komentoriviä:** aja komento omalla koneella repon juuressa ja anna palvelimen polku:
  `php bin/init.php --origin=… --base=… --data=/home/KÄYTTÄJÄ/hessutalks-data --out=config.php`. Siirrä sitten
  `config.php` palvelimen datahakemistoon (hakemisto `700`, tiedosto `600`). Tietokanta ja istunnot luodaan
  ensimmäisellä pyynnöllä.

## 5. Ensimmäinen käyttöönotto

1. Avaa hallintanäkymä osoitteessa, jonka `init.php` tulosti. Syötä käyttöönottotunnus ja luo passkey.
2. Luo salausavaimet tunnuslauseella. Tallenna tunnuslause salasanojen hallintaan ja talleta ladattu
   varmuuskopiotiedosto turvaan. Viestejä ei voi avata ilman jompaakumpaa.
3. Lisää *Asetukset*-sivulta toinen passkey esimerkiksi puhelimeen.
4. Kirjaudu kullakin passkeylla kerran ja avaa avain tunnuslauseella. Sovellus tallentaa passkeykohtaisen
   salatun kopion, ja sen jälkeen pelkkä passkey avaa myös viestit. Tämä vaatii selaimelta PRF-tuen
   (Safari 18 / macOS 15 / iOS 18, Chrome, Edge). Muuten tunnuslause kysytään joka kerta.

## 6. Tarkistus

Todenna asennus komennoilla (vaihda osoite omaksesi):

```sh
URL=https://example.com/hessutalks
curl -s "$URL/healthz"                                   # {"ok":true,…}; 503 = asetuksia ei löydy
curl -s -o /dev/null -w '%{http_code}\n' "$URL/app/bin/init.php"     # 403 tai 404
curl -s -o /dev/null -w '%{http_code}\n' "$URL/app/VERSION"          # 403 tai 404
curl -s -o /dev/null -w '%{http_code}\n' "$URL/live/"                # 403 tai 404
curl -s -o /dev/null -w '%{http_code}\n' "${URL/https:/http:}/"      # 301 (ohjaus HTTPS:ään)
curl -sI "$URL/assets/css/app.css" | grep -i -E 'content-security|nosniff|strict-transport'
curl -sI "$URL/" | grep -i 'content-security-policy'      # sovelluksen CSP
```

Varmista lopuksi, ettei datahakemisto näy verkkoon: kokeile sen arvattavia osoitteita, esim.
`https://example.com/hessutalks-data/config.php`. Vastauksen pitää olla 403 tai 404.

## Päivitys ja varmuuskopiot

- **Päivitys:** rakenna uusi paketti ja korvaa julkinen hakemisto ja `app/`. Tietokannan migraatiot ajetaan
  automaattisesti seuraavalla pyynnöllä. Älä päivitä luennon aikana.
- **Varmuuskopio:** kopioi datahakemisto. Tietokannasta saa yhtenäisen kopion myös käytön aikana:
  `sqlite3 hessutalks.sqlite ".backup hessutalks-kopio.sqlite"`. Viestit ovat tietokannassa salattuina, mutta
  `config.php` sisältää `app_secret`-salaisuuden, joten säilytä varmuuskopiot suojattuina.
- **Siirto toiselle palvelimelle:** siirrä datahakemisto, asenna paketti ja korjaa tarvittaessa `config.php`:n
  polut (`db_path`, `session_path`). Jos osoite muuttuu, passkeyt on luotava uudelleen, koska ne on sidottu
  palvelinnimeen (`rp_id`).

## Automaattinen julkaisu

Repon CI/CD-putki (`.github/workflows/ci.yml`) rakentaa saman paketin ja siirtää sen FTPS:llä, kun kaikki testit
menevät läpi `main`-haarassa. Julkaisun jälkeen se savutestaa osoitteen `APP_URL/healthz`. Omassa kopiossa:

1. Luo GitHubissa ympäristö `production` (*Settings → Environments*) ja lisää siihen secretit `FTP_SERVER`,
   `FTP_USERNAME` ja `FTP_PASSWORD` sekä muuttuja `APP_URL` (esim. `https://example.com/hessutalks`).
2. Rajaa FTP-tunnuksen juureksi julkinen hakemisto. Valitse tunnus, jota ei voi arvata, ja pitkä satunnainen salasana.
3. Halutessasi lisää ympäristöön *Required reviewers*, jolloin jokainen julkaisu odottaa hyväksyntää.
4. Muuttuja `DEPLOY_FREEZE` estää julkaisut annettuina aikaikkunoina (ks. [README](../README.md#cicd-putki)).

Jos julkaiset muulla tavalla (SFTP, rsync, kontti), korvaa putken *Lähetä FTPS:llä* -vaihe omallasi. Paketin
rakennus ja savutesti pysyvät samoina.
