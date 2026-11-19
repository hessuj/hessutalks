# Hyväksymistestit – MMoIT 2026

**Suomi** · [English](hyvaksymistestit.en.md)

Vaatimusdokumentin luvun 9 testit ja niiden todennus. Päivitetään jokaisen vaiheen PR:ssä.

Merkinnät: ✅ todennettu · 🟡 osittain · ⏳ ei vielä toteutettu · 🧪 todennetaan koeajossa Hessun kanssa (oikeat laitteet / Teams)

Todennustavat:
- **PHPUnit**: `vendor/bin/phpunit` (CI ajaa jokaiselle PR:lle)
- **Node**: `node --test tests/js/*.test.mjs` (CI)
- **Kuorma**: `scripts/e2e.sh load.mjs` (paikallisesti, hallinta ja esitysikkuna oikeassa Chromessa) ja `node scripts/load-test.mjs <osallistujalinkki>` (mikä tahansa ympäristö; tuotantoon vain testiluennolle, `--production`).
- **Selain**: `scripts/e2e.sh` (`tests/e2e/`), oikea Chrome (headless) ja virtuaalinen passkey, hallinta ja osallistuja omissa ikkunoissaan. Ajetaan paikallisesti, ei vielä CI:ssä.

| # | Testi | Tila | Miten todennettu |
|---|---|---|---|
| H1 | Liittyminen QR-koodilla iPhonella, Androidilla ja läppärillä | 🧪 | Selain: luennon linkki avaa odotusnäkymän ilman kirjautumista (`live-polls.mjs`). Oikeat laitteet koeajossa. |
| H2 | Esittäjä avaa T1-kysymyksen, näkymä vaihtuu alle 2 s:ssa | ✅ | Selain: *Avaa vastauksille* → osallistujan näkymä vaihtui 1,0–1,6 s:ssa ilman päivitystä (paikallinen palvelin, pollaus 1,2 s). Tuotannon verkkoviive tarkistetaan koeajossa. |
| H3 | Vastauksen vaihto T1:ssä: vain viimeisin lasketaan | ✅ | Selain: vastaus ja muutos → hallinnassa 1 vastaus. PHPUnit `testSameBrowserReplacesItsAnswer`. |
| H4 | Sulkeminen estää vastaamisen ja osallistuja näkee tilan | ✅ | Selain: kysymyksen rivin *Sulje* → "This poll is closed", kentät pois käytöstä. PHPUnit `testAnswerRequiresOpenPollOfThisEvent` (myös: auki mutta ei näytöllä → 409), `testSeveralPollsOnStageAcceptAnswersUntilRemoved`. |
| H5 | T2-asteikko: jakauma ja keskiarvo oikein | ✅ | Node `results.test.mjs` (jakaumat ja tunnusluvut). T2 = Likert 5 selitteineen. |
| H6 | T3: `<script>alert(1)</script>` näkyy tekstinä | ✅ | Selain `open-text.mjs`: osallistuja lähettää `<script>alert(1)</script><img src=x onerror=alert(2)>`, ja se näkyy tekstinä hallinnassa ja projektorilla. Yhtään elementtiä tai alert-dialogia ei synny (testi epäonnistuisi alertista). Node `results.test.mjs` (teksti säilyy tekstinä), PHPUnit `testBrowserScriptsNeverUseHtmlInjectionSinks` (ei innerHTML:ää missään skriptissä). |
| H7 | Moderointi T3:ssa: piilotettu katoaa heti | ✅ | Selain `open-text.mjs`: *Piilota* → vastaus katosi projektorilta muutamassa millisekunnissa. Piilotus säilyy uudelleenlatauksen yli (salattuna palvelimella). Kirosanasuodatin piilottaa osumat tarkistettavaksi; hyväksyntä tuo ne näkyviin. |
| H8 | Osallistuja kutsuu esittäjän rajapintaa → 401/403 | ✅ | PHPUnit `testAdminPollRoutesRequireLogin` (kaikki kysely-, sarja- ja ohjausreitit → 401), `testProtectedRoutesRequireLogin`, CSRF → 403. |
| H9 | Sama laite vastaa 50 kertaa skriptillä | ✅ | PHPUnit `testScriptedRepeatAnswersCountOnceAndAreRateLimited`: 50 yritystä → 10 hyväksytään, 40 saa 429, tietokannassa yksi vastaus; minuutin jälkeen taas sallittu. Osoiteraja `testAddressRateLimitDropsSilentlyAndForgetsAddress`: hiljainen hylkäys, ei IP-osoitetta, tiiviste poistuu ikkunan jälkeen. |
| H10 | Yhteyskatko ja palautus | ✅ | Selain: verkko pois → "Connection lost. Reconnecting…", verkko takaisin → tila päivittyy. Uudelleenlataus näyttää taululla olevan kysymyksen ja oman vastauksen. |
| H11 | Suljetaan perjantaina, avataan lauantaina | ✅ | PHPUnit `testEventCanBeClosedAndReopenedWithAnswersKept`: suljettu → 410, avattu → sama koodi toimii, vastaukset tallessa. Ylläpidon istunto vanhenee yön yli (8 h), joten lauantaina kirjaudutaan uudelleen passkeylla. |
| H12 | Sarjojen järjestyksen muutos ja ohitus kesken tapahtuman | ✅ | Selain `live-polls.mjs`: sarjan siirto kesken luennon muuttaa järjestystä, ja vastaukset säilyvät. Hallinnan yksinkertaistuksen ([#60](https://github.com/hessuj/hessutalks/issues/60)) jälkeen Seuraava/Edellinen-järjestystä ja Ohita-nappia ei ole: kysymykset näytetään listasta missä järjestyksessä tahansa, ja ohitus tarkoittaa, ettei sarjan kysymyksiä näytetä taululla. PHPUnit `LiveRepositoryTest`, `testAdminControlsSetsAndActiveQuestion` (myös: poistetut reitit palauttavat virheen). |
| H13 | Kuorma: 150 osallistujaa | ✅ | Selain `load.mjs` + `scripts/load-test.mjs` (paikallisesti 28.10.): 150 osallistujaa, noin 108 pyyntöä/s, 0 virhettä, tilakysely p95 16 ms. Avattu kysymys näkyi kaikille 1,2 s:ssa. Viive vastauksesta esitysnäkymän vastausmäärään oli enintään 1 978 ms, kun hallinta päivitti 2,5 s välein; päivitysväli lyhennettiin 1 sekuntiin, minkä jälkeen viive oli enintään 677 ms (mediaani 260 ms). **Tuotanto 28.10.:** HTTP 508 ennen 150:tä osallistujaa (jaetun palvelimen prosessiraja). Korjaus: osallistujat lukevat tilan staattisesta tiedostosta (`live/`, Apache ilman PHP:tä). Paikallisesti sen jälkeen 0 PHP-tilakyselyä 150 osallistujalla. **Tuotanto 29.10. (PR #20 julkaistu):** 150 osallistujaa 305 s testiluennolla, 36 171 pyyntöä (118,6/s), 0 virhettä, 0 PHP-tilakyselyä, tilatiedosto p50 18 / p95 31 / max 142 ms. Avattu kysymys näkyi kaikille 1,2 s:ssa, 150/150 kyselyvastausta perille (p95 40 ms), esitysnäkymä päivittyi sujuvasti (Hessu katsoi projektorilla). 200 osallistujan SHOULD-testi siirretty (Hessun päätös 27.10.). |
| H14 | JSON-tuonti luvun 10 tiedostolla | ✅ | PHPUnit `SetFormatTest::testCourseFileIsImportedCompletely`, `testImportCourseFileWithDryRunFirst` ja selain `import-json.mjs`: kurssin tiedosto sellaisenaan tuottaa 9 sarjaa ja kaikki 22 kysymystä oikeassa järjestyksessä. Oikeat vastaukset ja selitykset ovat tallessa, ja M6:n Q&A tuodaan avoimena tekstinä (`fallbackType`). Vienti ja uudelleentuonti tuottavat samat kysymykset (`testExportRoundTrips`). |
| H15 | Esitysnäkymä Teams-jaossa luettavissa | 🧪 | Selain `presenter.mjs`: 1920×1080-näkymässä kysymyksen fontti on noin 67 px (vaatimus noin 40 px), koodi, QR ja vastausmäärä aina kulmassa, iso QR (Q), vaalea teema (T). Varsinainen luettavuus Teamsin vastaanottajan näkymässä koeajossa. |

## Vaiheiden tila

| Vaihe | Sisältö | Tila |
|---|---|---|
| 1 | Admin-kirjautuminen: avaus passkeylla (PRF) | ✅ PR #8–#10. Todennettu Hessun laitteella: Safari + Applen Salasanat. 1Password rajattu pois (Hessun päätös 28.10.), tunnuslause varakeinona. |
| 2 | Sarjat, aktiivinen kysymys, odotusnäkymä, osallistujan kieli | ✅ PR #11 |
| 3 | JSON-tuonti ja -vienti | ✅ PR #12 |
| 4 | T3 avoin teksti, pysyvä moderointi, kirosanasuodatin, T4 30 merkkiä | ✅ PR #13 |
| 5 | Oikea vastaus, selitykset, paljastus, tulosten näyttö/piilotus, tulokset osallistujille (SHOULD 4.8) | ✅ PR #14 (`reveal.mjs`) |
| 6 | Esitysnäkymä, pikanäppäimet (myös esitysohjain), iso QR, teemat, puhelinohjain (SHOULD 5.3) | ✅ PR #15 (`presenter.mjs`) |
| 7 | Nopeusrajat (laite 10/min, osoitetiiviste 600/min hiljaa), julkaisujäädytys | ✅ PR #16 (`DeployFreezeTest`) |
| 8 | SHOULD: CSV-vienti (kaavainjektion esto), sarjan monistus, kysymyksen siirto, esikatselu. (Tulokset osallistujille, teemat, kirosanasuodatin ja puhelinohjain tehtiin vaiheissa 4–6.) | ✅ PR #17 (`should.mjs`) |
| 9 | Ensimmäisen luentokoeajon korjaukset: yksi esitysikkuna ruudukkona (kysymykset, kysymys- ja palautelista, viesti), useita kysymyksiä näytöllä ja auki yhtä aikaa, yhteys palautuu uudelleenlatauksen jälkeen, vastausten tyhjennys vain Valmistelu-tilassa | ✅ PR #40, #41 ([poikkeamakatselmus](poikkeama-esitysnaytto.md), `stage-multi.mjs`, `testSeveralPollsOnStageAcceptAnswersUntilRemoved`, `testStageMigrationKeepsAnswersAndActivePoll`) |
| 10 | Luentopalautteen backlog: kaksi tai useampi kysymys auki aina (rivin klikkaus ja Seuraava eivät sulje muita), istunto 3 h toimettomuutta, Markdown-raportti koko luennosta tai luentosarjasta | ✅ PR #43 (`stage-multi.mjs`, `testOpeningAndActivatingKeepOtherQuestionsOpen`, `testSessionSurvivesTwoHoursWithoutActivity`, Node `results.test.mjs`) |
| 11 | Hallinnan yksinkertaistus ([#60](https://github.com/hessuj/hessutalks/issues/60)): ei tiloja eikä aktiivista kysymystä; kolme välilehteä (Kysymykset, Vapaat kysymykset, Palautteet); kysymyksen rivillä Näytä taululla (näyttää ja avaa), Sulje, Poista taululta, tulokset ja paljastus; rivin klikkaus avaa tulokset ja muokkauksen; viestit taululle rivikohtaisesti. Poistettu Seuraava/Edellinen, sarjan ohitus, ohjauspikanäppäimet, puhelinohjain ja projektorin viestilistat | ✅ PR #61 (`admin-list.mjs`, `stage-messages.mjs`, `tabs.mjs`, `messages.mjs`, `testAdminControlsSetsAndActiveQuestion`) |
| 12 | Puhelinohjain ([#63](https://github.com/hessuj/hessutalks/issues/63)): samat kysymystoiminnot kuin hallinnan listassa isoin napein (Näytölle näyttää ja avaa, Sulje/Avaa, Poista näytöltä, tulokset, paljastus, Tyhjennä taulu, iso QR), useita kysymyksiä näytölle; Taululla- ja Kaikki-välilehdet; yhteyden, esitysnäytön ja näytön lukituksen tila; näytön pito päällä (Wake Lock), päivitys heti näytön tai verkon palatessa, idempotentit komennot; Tyhjennä taulu poistaa myös läppärin nostamat viestit; avaus QR-koodilla ilman salausavainta | ✅ tämä PR (`remote.mjs`, `testRemoteSeesScreenHeartbeatAndBoardClears`, `testPhoneRemoteNeverDecryptsOrStoresContent`) |

## Vaatimusten kattavuus

| Luku | MUST | SHOULD | COULD |
|---|---|---|---|
| 3 Kysymystyypit | T1 ✅ T2 ✅ T3 ✅ | T4 ✅ T5 ✅ | T6 Q&A ✖ (P6: korvattu avoimella tekstillä) |
| 4 Osallistuja | 1–7, 9 ✅ | 8 tulokset osallistujille ✅ | |
| 5 Esittäjä | 5.1, 5.2, 5.4 ✅ | 5.1 teemat ✅, 5.3 puhelinohjain ✅ (uusittu, [#63](https://github.com/hessuj/hessutalks/issues/63)), 5.4 CSV ✅ | |
| 6 Sisältö | luonti ja muokkaus etukäteen ✅ | JSON ✅, monistus ja siirto ✅ | esikatselu ✅ |
| 7 Tietoturva | 1–5, 7–9 ✅ | 6 kirosanasuodatin ✅ | |
| 8 Suorituskyky | 443 + varayhteys ✅ (lyhyt pollaus), julkaisujäädytys ✅, 150 osallistujaa ja tulokset alle 2 s ✅ (paikallisesti ja tuotannossa 29.10.) | kuormitustesti 200 ⏳ (siirretty) | |
| 9 Hyväksymistestit | H2–H12, H14 ✅; H1, H15 koeajossa 🧪; H13 ✅ (tuotanto 29.10.) | | |
