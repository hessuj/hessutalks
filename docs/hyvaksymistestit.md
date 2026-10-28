# Hyväksymistestit – MMoIT 2026 (13.–14.11.2026)

Vaatimusdokumentin luvun 9 testit ja niiden todennus. Päivitetään jokaisen vaiheen PR:ssä.

Merkinnät: ✅ todennettu · 🟡 osittain · ⏳ ei vielä toteutettu · 🧪 todennetaan koeajossa Hessun kanssa (oikeat laitteet / Teams)

Todennustavat:
- **PHPUnit**: `vendor/bin/phpunit` (CI ajaa jokaiselle PR:lle)
- **Node**: `node --test tests/js/*.test.mjs` (CI)
- **Selain**: `scripts/e2e.sh` (`tests/e2e/`), oikea Chrome (headless) ja virtuaalinen passkey, hallinta ja osallistuja omissa ikkunoissaan. Ajetaan paikallisesti, ei vielä CI:ssä.

| # | Testi | Tila | Miten todennettu |
|---|---|---|---|
| H1 | Liittyminen QR-koodilla iPhonella, Androidilla ja läppärillä | 🧪 | Selain: luennon linkki avaa odotusnäkymän ilman kirjautumista (`live-polls.mjs`). Oikeat laitteet koeajossa. |
| H2 | Esittäjä avaa T1-kysymyksen, näkymä vaihtuu alle 2 s:ssa | ✅ | Selain: *Avaa vastauksille* → osallistujan näkymä vaihtui 1,0–1,6 s:ssa ilman päivitystä (paikallinen palvelin, pollaus 1,2 s). Tuotannon verkkoviive tarkistetaan koeajossa. |
| H3 | Vastauksen vaihto T1:ssä: vain viimeisin lasketaan | ✅ | Selain: vastaus ja muutos → hallinnassa 1 vastaus. PHPUnit `testSameBrowserReplacesItsAnswer`. |
| H4 | Sulkeminen estää vastaamisen ja osallistuja näkee tilan | ✅ | Selain: *Sulje vastaukset* → "This poll is closed", kentät pois käytöstä. PHPUnit `testAnswerRequiresOpenPollOfThisEvent` (myös: auki mutta ei aktiivinen → 409). |
| H5 | T2-asteikko: jakauma ja keskiarvo oikein | ✅ | Node `results.test.mjs` (jakaumat ja tunnusluvut). T2 = Likert 5 selitteineen. |
| H6 | T3: `<script>alert(1)</script>` näkyy tekstinä | ✅ | Selain `open-text.mjs`: osallistuja lähettää `<script>alert(1)</script><img src=x onerror=alert(2)>`, ja se näkyy tekstinä hallinnassa ja projektorilla. Yhtään elementtiä tai alert-dialogia ei synny (testi epäonnistuisi alertista). Node `results.test.mjs` (teksti säilyy tekstinä), PHPUnit `testBrowserScriptsNeverUseHtmlInjectionSinks` (ei innerHTML:ää missään skriptissä). |
| H7 | Moderointi T3:ssa: piilotettu katoaa heti | ✅ | Selain `open-text.mjs`: *Piilota* → vastaus katosi projektorilta muutamassa millisekunnissa. Piilotus säilyy uudelleenlatauksen yli (salattuna palvelimella). Kirosanasuodatin piilottaa osumat tarkistettavaksi; hyväksyntä tuo ne näkyviin. |
| H8 | Osallistuja kutsuu esittäjän rajapintaa → 401/403 | ✅ | PHPUnit `testAdminPollRoutesRequireLogin` (kaikki kysely-, sarja- ja ohjausreitit → 401), `testProtectedRoutesRequireLogin`, CSRF → 403. |
| H9 | Sama laite vastaa 50 kertaa skriptillä | ✅ | PHPUnit `testScriptedRepeatAnswersCountOnceAndAreRateLimited`: 50 yritystä → 10 hyväksytään, 40 saa 429, tietokannassa yksi vastaus; minuutin jälkeen taas sallittu. Osoiteraja `testAddressRateLimitDropsSilentlyAndForgetsAddress`: hiljainen hylkäys, ei IP-osoitetta, tiiviste poistuu ikkunan jälkeen. |
| H10 | Yhteyskatko ja palautus | ✅ | Selain: verkko pois → "Connection lost. Reconnecting…", verkko takaisin → tila päivittyy. Uudelleenlataus näyttää aktiivisen kysymyksen ja oman vastauksen. |
| H11 | Suljetaan perjantaina, avataan lauantaina | ✅ | PHPUnit `testEventCanBeClosedAndReopenedWithAnswersKept`: suljettu → 410, avattu → sama koodi toimii, vastaukset tallessa. Ylläpidon istunto vanhenee yön yli (8 h), joten lauantaina kirjaudutaan uudelleen passkeylla. |
| H12 | Sarjojen järjestyksen muutos ja ohitus kesken tapahtuman | ✅ | Selain: ohitus, palautus ja sarjan siirto muuttavat Seuraava/Edellinen-järjestystä. PHPUnit `LiveRepositoryTest`, `testAdminControlsSetsAndActiveQuestion`. Vastaukset säilyvät (ohitus ei poista mitään). |
| H13 | Kuorma: 150 osallistujaa | ⏳ | Siirretty myöhemmäksi (Hessun päätös 27.10.). Osallistujan tilakysely tekee yhden tietokantahaun, kun mikään ei muutu. |
| H14 | JSON-tuonti luvun 10 tiedostolla | ✅ | PHPUnit `SetFormatTest::testCourseFileIsImportedCompletely`, `testImportCourseFileWithDryRunFirst` ja selain `import-json.mjs`: kurssin tiedosto sellaisenaan tuottaa 9 sarjaa ja kaikki 22 kysymystä oikeassa järjestyksessä. Oikeat vastaukset ja selitykset ovat tallessa, ja M6:n Q&A tuodaan avoimena tekstinä (`fallbackType`). Vienti ja uudelleentuonti tuottavat samat kysymykset (`testExportRoundTrips`). |
| H15 | Esitysnäkymä Teams-jaossa luettavissa | 🧪 | Selain `presenter.mjs`: 1920×1080-näkymässä kysymyksen fontti on noin 67 px (vaatimus noin 40 px), koodi, QR ja vastausmäärä aina kulmassa, iso QR (Q), vaalea teema (T). Varsinainen luettavuus Teamsin vastaanottajan näkymässä koeajossa. |

## Vaiheiden tila

| Vaihe | Sisältö | Tila |
|---|---|---|
| 1 | Admin-kirjautuminen: avaus passkeylla (PRF) | ✅ PR #8–#10. Safari + 1Password: odottaa Hessun testiä. |
| 2 | Sarjat, aktiivinen kysymys, odotusnäkymä, osallistujan kieli | ✅ PR #11 |
| 3 | JSON-tuonti ja -vienti | ✅ PR #12 |
| 4 | T3 avoin teksti, pysyvä moderointi, kirosanasuodatin, T4 30 merkkiä | ✅ PR #13 |
| 5 | Oikea vastaus, selitykset, paljastus, tulosten näyttö/piilotus, tulokset osallistujille (SHOULD 4.8) | ✅ PR #14 (`reveal.mjs`) |
| 6 | Esitysnäkymä, pikanäppäimet (myös esitysohjain), iso QR, teemat, puhelinohjain (SHOULD 5.3) | ✅ PR #15 (`presenter.mjs`) |
| 7 | Nopeusrajat (laite 10/min, osoitetiiviste 600/min hiljaa), julkaisujäädytys | ✅ tämä PR (`DeployFreezeTest`) |
| 8 | SHOULD: tulokset osallistujille, CSV, monistus/siirto, teemat, kirosanasuodatin, puhelinohjain, esikatselu | ⏳ |
