# Tietoturva

**Suomi** · [English](SECURITY.en.md)

## Haavoittuvuuksien ilmoittaminen

Ilmoita haavoittuvuuksista yksityisesti GitHubin *Security → Report a vulnerability* -toiminnolla.
Älä avaa julkista issueta.

## Suojattavat kohteet

1. Osallistujien viestien sisältö
2. Osallistujien anonymiteetti: sovellus ei kerää henkilötietoja
3. Ylläpitäjän pääsy hallintanäkymään
4. Palvelun käytettävyys luennon aikana

## Uhkamalli

| Uhka | Torjunta |
|---|---|
| Tietokanta tai varmuuskopio vuotaa | Viestit ja nimimerkit ovat vain salattuina. Yksityinen avain on salattu Argon2id-tunnuslauseella. Nimimerkeistä on tallessa vain HMAC-tiiviste. |
| Webhotellin tiedostot luetaan | Kuten edellä. Lisäksi `app_secret` suojaa HMAC-tiivisteitä ja lomaketokeneita. |
| Yksityisen avaimen avaus passkeylla | WebAuthn PRF: passkey laskee laitteen sisällä salaisen arvon passkeykohtaisesta suolasta. Selain johtaa siitä avaimen ja salaa sillä kopion yksityisestä avaimesta. Palvelimella on vain suola ja salattu kopio. PRF-arvo ei lähde selaimesta, joten tietokannan vuoto ei paljasta avainta. Kopion voi tallentaa vain sille passkeylle, jolla istunto kirjautui, ja se poistuu passkeyn mukana. Tunnuslause ja varmuuskopio jäävät varakeinoksi. |
| Kirjautumisen arvaus tai kalastelu | Passkey on sidottu originiin, joten salasanaa ei ole kalasteltavissa. Haasteet ovat kertakäyttöisiä ja vanhenevat 3 minuutissa. Kirjautumisyrityksiä rajoitetaan. |
| Istunnon kaappaus tai fixation | `__Host-`-eväste, `HttpOnly`, `SameSite=Strict`, tunniste vaihdetaan kirjautuessa, aikakatkaisut |
| CSRF | Tarkka Origin-vertailu, `Sec-Fetch-Site`-tarkistus, CSRF-token, vain JSON-pyynnöt |
| XSS viestien kautta | CSP ilman inline-skriptejä. Purettu sisältö lisätään DOMiin vain `textContent`illa. Templatet escapoidaan. |
| Toisen nimimerkin käyttö | Varaus sidotaan satunnaiseen 256-bittiseen omistajatunnisteeseen, josta palvelimella on vain tiiviste |
| Projektorin esitysikkuna | Esitysikkunassa ei ole salausavainta eikä salauskirjastoa. Hallintaikkuna lähettää sille vain näytettävän tekstin `postMessage`lla omaan originiinsa. Esitysikkuna hyväksyy viestit vain avaajaltaan ja samasta originista, ja se vaatii kirjautumisen. Näyttö tyhjennetään, kun hallintaikkuna suljetaan. |
| Esitysikkunan komennot | Esitysikkunalla ei ole pääsyä rajapintaan. Pikanäppäin lähettää hallintaikkunalle `postMessage`-komennon omaan originiin. Hallinta hyväksyy vain omien esitysikkunoidensa viestit ja vain tunnetut komennot, ja tekee toiminnon tavallisena kirjautuneena pyyntönä (CSRF-token). |
| Puhelinohjain | Vaatii kirjautumisen (passkey) kuten muukin hallinta, mutta ei salausavainta, koska se ei käsittele viestien sisältöä. |
| Kyselyvastaukset | Vastaus salataan selaimessa (sealed box) ja sidotaan luentoon ja kyselyyn salatun sisällön sisällä. Palvelin hyväksyy vastauksen vain luennon aktiiviseen ja avoimeen kysymykseen, ja osallistuja näkee vain sen (ei luonnoksia eikä muita kysymyksiä). Luennoitsijan selain hylkää väärän muotoiset tai toiselle kyselylle salatut vastaukset. Kysymysteksti ja vaihtoehdot ovat luennoitsijan julkista sisältöä ja tallennetaan selväkielisinä. |
| Moderointi | Piilotetut vastaukset ja sanat sekä suodattimen hyväksynnät salataan luennoitsijan julkisella avaimella (sealed box) ennen tallennusta, joten palvelin ei näe piilotettuja sanoja. Kirosanasuodatin toimii luennoitsijan selaimessa. Avoimet vastaukset näytetään vain `textContent`illa (H6). |
| Pitkät avoimet vastaukset | Kysymyskohtainen enimmäispituus (`config.max`) on 280–3500 merkkiä. Palvelin ei näe tekstiä, mutta se rajaa salatun vastauksen koon kysymyksen asetuksen mukaan (enintään 4 tavua merkkiä kohden + metatiedot), joten oletuskysymykseen ei voi tallentaa isoja rivejä. Luennoitsijan selain hylkää rajaa pidemmät vastaukset, ja muokattu asetus ei avaa rajaa yli 3500 merkin. |
| Useat avoimet vastaukset | Kun kysely sallii useita vastauksia, jokainen vastaus saa satunnaisen tiivisteen, eikä saman osallistujan vastauksia voi yhdistää tietokannasta. Rajana nopeusraja ja kyselykohtainen enimmäismäärä. |
| Tuloskooste osallistujille (päätös P2) | Kun luennoitsija näyttää tulokset, hänen selaimensa julkaisee palvelimelle koosteen (vaihtoehtojen määrät, keskiarvo, mediaani). Tämä on tietoinen poikkeus periaatteesta, ettei palvelin näe sisältöä: kooste on sama, joka näkyy projektorilla ja Teamsissa. Vain monivalinnat ja asteikot, ei avoimia vastauksia eikä sanapilveä. Palvelin tarkistaa muodon ja rajat, ja piilotus poistaa koosteen. |
| CSV-vienti | Vastaukset puretaan luennoitsijan selaimessa, joten palvelin ei näe tiedostoa. Ei osallistujatunnisteita. Kaavainjektion esto: osallistujan teksti, joka alkaa merkillä `=`, `+`, `-` tai `@`, saa eteensä heittomerkin, jottei Excel suorita sitä kaavana (esim. `=HYPERLINK(...)`). |
| Esikatselu | `/admin/esikatselu` vaatii kirjautumisen ja näyttää vain julkiset kentät (ei oikeita vastauksia). Vastausta ei lähetetä. |
| Oikeat vastaukset ennen paljastusta | Oikeat vastaukset ja selitykset ovat vain hallinnan rajapinnassa. Osallistujan rajapinta (`/api/live`), tilatiedosto ja sivu suodattavat ne pois, joten niitä ei näe selaimen kehitystyökaluistakaan. |
| Osallistujien tilatiedosto (`live/`) | Jaetun palvelimen PHP-prosessiraja täyttyi kuormitustestissä, joten osallistujan selain lukee tilan staattisesta tiedostosta, jonka Apache palvelee ilman PHP:tä. Sisältö on sama julkinen tila kuin `/api/live`-vastauksessa: aktiivinen kysymys, vaihtoehdot ja paljastuksen jälkeen oikea vastaus. Ei salattuja vastauksia, nimimerkkejä eikä viestejä. Nimi on avaimellinen tiiviste luennon id:stä, ja se annetaan luennon sivulla, joten luentokoodeja ei voi kokeilla tiedostonimillä ohi hakurajojen. Suljetun luennon tiedostossa ei ole kysymystä, ja luennon poisto poistaa tiedoston. `live/.htaccess` sallii vain sovelluksen kirjoittamat nimet, estää välimuistin eikä ohjaa puuttuvia tiedostoja PHP:lle. |
| Kyselyvastaajan tunnistaminen | Ei nimimerkkiä. Selaimen satunnaisesta tunnisteesta tallennetaan vain kyselykohtainen HMAC, joten saman selaimen vastauksia eri kyselyissä ei voi yhdistää tietokannasta. |
| Viestin siirto toiselle luennolle | Luennon koodi on salatun viestin sisällä. Ylläpitonäkymä varoittaa ristiriidasta. |
| Roskapostitus | Nimimerkki- ja luentokohtaiset rajat sekä luentokohtaiset enimmäismäärät |
| Kyselyvastausten massalähetys (H9) | Enintään 10 vastausta minuutissa laitetta ja kysymystä kohden (ylitys 429). Lisäksi 600 vastausta minuutissa osoitetta kohden (P3). Osoiteraja hylkää ylimääräiset **hiljaa** (skripti näkee onnistumisen, mitään ei tallenneta), jotta skripti ei voi säätää tahtiaan. Osoitteesta tallennetaan vain avaimellinen tiiviste, ja rivit poistetaan heti minuutin ikkunan jälkeen. Raja on reilu, koska luentosali voi näkyä yhtenä osoitteena (NAT). |
| Luentokoodien arvailu | Avaruus 31⁶ ≈ 887 milj. Epäonnistuneita hakuja rajoitetaan palvelun tasolla. |
| Toimitusketju | Selainkirjastot vendoroitu SHA-256-lukituksella, ei CDN:ää. Actionit kiinnitetty commit-SHA:han. Dependabot, composer audit. |

## Jäännösriskit

- **Palvelimen haltuunotto ja JavaScriptin vaihto.** Kaikki selainpohjainen päästä päähän -salaus
  luottaa palvelimen toimittamaan koodiin. Jos hyökkääjä pystyy muuttamaan tiedostoja webhotellissa,
  se voi vaihtaa skriptin, joka vuotaa *tulevat* viestit tai tunnuslauseen. Jo tallennetut viestit pysyvät suojassa.
  Riskiä pienentävät: julkaisu vain CI/CD:n kautta, FTPS-tunnuksen suojaus ja tuotannon savutesti.
- **Tunnuslauseen menetys.** Viestejä ei voi palauttaa ilman tunnuslausetta. Tämä on tarkoituksellista.
- **Webhotellin lokit.** Apache voi kirjata IP-osoitteita palvelinlokeihin sovelluksen ulkopuolella.
  Vaatimuksen 7.7 mukainen enintään 7 päivän säilytys asetetaan cPanelissa: *Raw Access* → poista
  *Archive logs in your home directory* käytöstä tai rajaa arkistointi, jolloin lokit kiertävät webhotellin oletuksen mukaan.
  Sovellus itse ei tallenna IP-osoitteita.
- **Osallistujan oma tieto.** Jos osallistuja kirjoittaa nimimerkkiin tai viestiin henkilötietoja,
  ne tallentuvat salattuina. Lomake ohjeistaa olemaan tekemättä niin.
- **Saman verkon käyttäjät.** Rajoitukset eivät perustu IP-osoitteisiin, joten luentosali voi olla NAT:n takana ilman haittaa.
  Tämä tarkoittaa myös, että yksittäistä häiriköijää voi rajoittaa vain nimimerkin perusteella.
- **Kyselyjen äänten monistaminen.** Koska vastaajia ei tunnisteta, muokattu asiakasohjelma voi luoda
  uusia satunnaisia tunnisteita ja vastata useasti. Rajoja: lomaketoken, laitekohtainen nopeusraja,
  osoitekohtainen nopeusraja ja kyselykohtainen enimmäismäärä (3000). Kyselyt sopivat mielipiteiden ja osaamisen kartoitukseen, eivät äänestyksiin,
  joiden tuloksella on seurauksia.

## Ylläpitäjän muistilista

- Pidä ainakin kaksi passkeyta (esim. MacBook ja iPhone).
- Tallenna tunnuslause salasanojen hallintaan ja avaimen varmuuskopio turvalliseen paikkaan.
- Tarkista *Asetukset → Tietoturvaloki* ajoittain.
- Poista vanhat luennot, kun niiden viestejä ei enää tarvita.
