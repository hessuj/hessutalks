# Kysymysten tuontitiedosto (JSON)

**Suomi** · [English](import-format.md)

Tämä on HessuTalksin kysymyssarjojen tiedostomuodon kuvaus. Hallinnan *Tuo JSON* lukee tiedoston, ja *Vie JSON*
tuottaa saman muodon. Kuvaus on kirjoitettu niin, että sen voi antaa sellaisenaan tekoälylle (ks. [Tiedoston luonti
tekoälyllä](#tiedoston-luonti-tekoälyllä)).

## Rakenne

Tiedosto on yksi JSON-objekti, jossa on luento (`event`) ja lista kysymyssarjoja (`sets`). Sarjat tuodaan
tiedoston järjestyksessä, samoin kysymykset sarjan sisällä.

```json
{
  "event": { "title": "Tietoturvan perusteet" },
  "sets": [
    {
      "id": "M1",
      "title": "M1 Uhkat ja riskit",
      "questions": [
        { "type": "wordcloud", "text": "Tietoturva yhdellä sanalla?", "maxWords": 1 },
        { "type": "single", "text": "Mikä näistä on kalasteluviestin tyypillisin tunnusmerkki?",
          "options": ["Kiireellisyys ja uhkailu", "Allekirjoitus", "Yrityksen logo"],
          "correct": [0],
          "explanations": ["Oikein: kiire saa toimimaan ajattelematta.", "Allekirjoituksen voi väärentää.", "Logon voi kopioida."] },
        { "type": "multi", "text": "Mitkä ovat henkilötietoja?",
          "options": ["Nimi", "IP-osoite", "Lämpötila"], "correct": [0, 1] },
        { "type": "scale", "text": "Tunnistan kalasteluviestin helposti.", "min": 1, "max": 5,
          "minLabel": "Täysin eri mieltä", "maxLabel": "Täysin samaa mieltä" },
        { "type": "scale", "text": "Kuinka todennäköisesti suosittelisit kurssia?", "min": 0, "max": 10 },
        { "type": "open", "text": "Pohdi: miten organisaatiosi varautuu kiristyshaittaohjelmaan?",
          "maxLength": 3500, "multipleAnswers": false }
      ]
    }
  ]
}
```

| Kenttä | Pakollinen | Sisältö |
|---|---|---|
| `event.title` | ei | Luennon tai kurssin nimi |
| `sets` | kyllä | Lista sarjoja, vähintään yksi |
| `sets[].id` | kyllä | Sarjan tunniste: 1–16 merkkiä `A–Z`, `0–9`, `-` tai `_`, alkaa kirjaimella tai numerolla. Pienet kirjaimet muutetaan isoiksi. Uniikki tiedostossa ja luennolla |
| `sets[].title` | kyllä | Sarjan nimi, enintään 120 merkkiä |
| `sets[].questions` | ei | Lista kysymyksiä (oletus tyhjä) |

Tuntemattomat kentät ohitetaan. Viennissä mukana olevat `format` ja `version` eivät vaikuta tuontiin.

## Kysymystyypit

Jokaisessa kysymyksessä on `type` ja `text` (kysymysteksti, 1–300 merkkiä).

| `type` | Lisäkentät |
|---|---|
| `single` | Monivalinta, yksi vastaus. `options`: 2–10 vaihtoehtoa, kukin enintään 120 merkkiä. `correct`: enintään yksi oikean vaihtoehdon indeksi (0-pohjainen). `explanations`: selitys jokaiselle vaihtoehdolle, kukin enintään 300 merkkiä |
| `multi` | Monivalinta, useita vastauksia. Kuten `single`, mutta `correct` voi sisältää useita indeksejä |
| `scale` | `min` ja `max`: 1–5 tai 1–7 (Likert) tai 0–10 (asteikko). Oletus 1–5. `minLabel` ja `maxLabel`: ääripäiden selitteet, enintään 40 merkkiä |
| `wordcloud` | Sanapilvi. `maxWords` 1–3 (sovellus sallii aina enintään 3 sanaa) |
| `open` | Avoin teksti. `maxLength`: 280–3500 merkkiä (oletus 280, pohdintatehtäviin 3500 eli noin 500 sanaa). `multipleAnswers`: `true` = osallistuja voi lähettää useita vastauksia |
| `qa` | Ei käytössä. Tuodaan `fallbackType`-kentän tyyppinä (esim. `"fallbackType": "open"`), muuten ohitetaan varoituksella |

`correct` ja `explanations` ovat valinnaisia. Niitä ei lähetetä osallistujille ennen kuin luennoitsija paljastaa
oikean vastauksen. Jos `explanations` annetaan, selityksiä on oltava täsmälleen yhtä monta kuin vaihtoehtoja
(tyhjä merkkijono käy selitykseksi).

## Rajat ja virheet

- Tiedosto on enintään 60 kt.
- Luennolla voi olla enintään 50 sarjaa ja 100 kysymystä.
- Tuonti on kaikki tai ei mitään: yksikin virhe estää koko tuonnin. Ennen tallennusta hallinta näyttää
  yhteenvedon tuotavista sarjoista, ohitettavista kysymyksistä ja virheistä.
- Luennolla jo käytössä oleva sarjan tunniste on virhe. Vaihda tunniste, jos tuot saman sarjan uudelleen.

## Tiedoston luonti tekoälyllä

Kysymyksiä ei tarvitse kirjoittaa käsin. Kun annat tekoälylle (esim. Claude tai ChatGPT) oppimateriaalin ja tämän
kuvauksen, se voi tuottaa tuontikelpoisen tiedoston suoraan. Muuta kuvausta tai esimerkkejä ei tarvita.

1. Liitä keskusteluun oppimateriaali (luentodiat, muistiinpanot, oppimistavoitteet) ja tämä tiedosto.
2. Kerro, millaisia kysymyksiä haluat. Esimerkkipyyntö:

   > Tee liitteenä olevan luentomateriaalin pohjalta HessuTalksin tuontitiedosto liitteenä olevan kuvauksen
   > mukaan. Yksi sarja jokaista luennon osaa kohden. Jokaisessa sarjassa yksi aloituskysymys (sanapilvi tai asteikko),
   > kaksi monivalintaa oikeine vastauksineen ja selityksineen sekä yksi pohdintakysymys. Kieli suomi.
   > Palauta pelkkä JSON.

3. Tallenna vastaus `.json`-tiedostoksi ja tuo se hallinnassa (*Tuo JSON*). Yhteenveto kertoo mahdolliset virheet,
   jotka voit antaa tekoälylle korjattaviksi.
4. Tarkista kysymykset ja oikeat vastaukset ennen luentoa *Esikatsele*-napilla. Tekoäly voi erehtyä.

Liitä materiaali, jonka saa antaa käyttämällesi tekoälypalvelulle. Älä liitä opiskelijoiden henkilötietoja.
