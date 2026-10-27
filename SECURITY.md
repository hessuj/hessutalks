# Tietoturva

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
| Kirjautumisen arvaus tai kalastelu | Passkey on sidottu originiin, joten salasanaa ei ole kalasteltavissa. Haasteet ovat kertakäyttöisiä ja vanhenevat 3 minuutissa. Kirjautumisyrityksiä rajoitetaan. |
| Istunnon kaappaus tai fixation | `__Host-`-eväste, `HttpOnly`, `SameSite=Strict`, tunniste vaihdetaan kirjautuessa, aikakatkaisut |
| CSRF | Tarkka Origin-vertailu, `Sec-Fetch-Site`-tarkistus, CSRF-token, vain JSON-pyynnöt |
| XSS viestien kautta | CSP ilman inline-skriptejä. Purettu sisältö lisätään DOMiin vain `textContent`illa. Templatet escapoidaan. |
| Toisen nimimerkin käyttö | Varaus sidotaan satunnaiseen 256-bittiseen omistajatunnisteeseen, josta palvelimella on vain tiiviste |
| Projektorin esitysikkuna | Esitysikkunassa ei ole salausavainta eikä salauskirjastoa. Hallintaikkuna lähettää sille vain näytettävän tekstin `postMessage`lla omaan originiinsa. Esitysikkuna hyväksyy viestit vain avaajaltaan ja samasta originista, ja se vaatii kirjautumisen. Näyttö tyhjennetään, kun hallintaikkuna suljetaan. |
| Kyselyvastaukset | Vastaus salataan selaimessa (sealed box) ja sidotaan luentoon ja kyselyyn salatun sisällön sisällä. Luennoitsijan selain hylkää väärän muotoiset tai toiselle kyselylle salatut vastaukset. Kysymysteksti ja vaihtoehdot ovat luennoitsijan julkista sisältöä ja tallennetaan selväkielisinä. |
| Kyselyvastaajan tunnistaminen | Ei nimimerkkiä. Selaimen satunnaisesta tunnisteesta tallennetaan vain kyselykohtainen HMAC, joten saman selaimen vastauksia eri kyselyissä ei voi yhdistää tietokannasta. |
| Viestin siirto toiselle luennolle | Luennon koodi on salatun viestin sisällä. Ylläpitonäkymä varoittaa ristiriidasta. |
| Roskapostitus | Nimimerkki- ja luentokohtaiset rajat sekä luentokohtaiset enimmäismäärät |
| Luentokoodien arvailu | Avaruus 31⁶ ≈ 887 milj. Epäonnistuneita hakuja rajoitetaan palvelun tasolla. |
| Toimitusketju | Selainkirjastot vendoroitu SHA-256-lukituksella, ei CDN:ää. Actionit kiinnitetty commit-SHA:han. Dependabot, composer audit. |

## Jäännösriskit

- **Palvelimen haltuunotto ja JavaScriptin vaihto.** Kaikki selainpohjainen päästä päähän -salaus
  luottaa palvelimen toimittamaan koodiin. Jos hyökkääjä pystyy muuttamaan tiedostoja webhotellissa,
  se voi vaihtaa skriptin, joka vuotaa *tulevat* viestit tai tunnuslauseen. Jo tallennetut viestit pysyvät suojassa.
  Riskiä pienentävät: julkaisu vain CI/CD:n kautta, FTPS-tunnuksen suojaus ja tuotannon savutesti.
- **Tunnuslauseen menetys.** Viestejä ei voi palauttaa ilman tunnuslausetta. Tämä on tarkoituksellista.
- **Webhotellin lokit.** Apache voi kirjata IP-osoitteita palvelinlokeihin sovelluksen ulkopuolella.
  Lokien säilytystä voi rajoittaa cPanelin *Raw Access* -asetuksista.
- **Osallistujan oma tieto.** Jos osallistuja kirjoittaa nimimerkkiin tai viestiin henkilötietoja,
  ne tallentuvat salattuina. Lomake ohjeistaa olemaan tekemättä niin.
- **Saman verkon käyttäjät.** Rajoitukset eivät perustu IP-osoitteisiin, joten luentosali voi olla NAT:n takana ilman haittaa.
  Tämä tarkoittaa myös, että yksittäistä häiriköijää voi rajoittaa vain nimimerkin perusteella.
- **Kyselyjen äänten monistaminen.** Koska vastaajia ei tunnisteta, muokattu asiakasohjelma voi luoda
  uusia satunnaisia tunnisteita ja vastata useasti. Rajoja: lomaketoken, vastaajakohtainen nopeusraja ja
  kyselykohtainen enimmäismäärä (3000). Kyselyt sopivat mielipiteiden ja osaamisen kartoitukseen, eivät äänestyksiin,
  joiden tuloksella on seurauksia.

## Ylläpitäjän muistilista

- Pidä ainakin kaksi passkeyta (esim. MacBook ja iPhone).
- Tallenna tunnuslause salasanojen hallintaan ja avaimen varmuuskopio turvalliseen paikkaan.
- Tarkista *Asetukset → Tietoturvaloki* ajoittain.
- Poista vanhat luennot, kun niiden viestejä ei enää tarvita.
