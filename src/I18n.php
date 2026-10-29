<?php

declare(strict_types=1);

namespace HessuTalks;

use HessuTalks\Http\Request;

/**
 * Osallistujan käyttöliittymän kielet (suomi ja englanti). Hallinta on aina suomeksi.
 *
 * Kieli valitaan: 1) ?lang=fi|en (käyttäjän valinta), 2) selaimen Accept-Language, 3) suomi.
 * Valinta muistetaan vain selaimessa (localStorage, lang.js), ei evästeissä eikä palvelimella.
 * Avaimet, jotka alkavat "js.", välitetään selaimen skriptille sivun data-attribuutissa.
 */
final class I18n
{
    public const LANGS = ['fi', 'en'];
    public const DEFAULT = 'fi';

    private const STRINGS = [
        'fi' => [
            'lang.label' => 'Kieli',
            'foot.encrypted' => 'Viestit salataan selaimessasi ennen lähetystä.',
            'foot.privacy' => 'Tietosuoja',

            'home.title' => 'Liity',
            'home.heading' => 'Liity luennolle',
            'home.intro' => 'Syötä luennoitsijan näyttämä koodi tai skannaa QR-koodi.',
            'home.code_label' => 'Luennon koodi',
            'home.continue' => 'Jatka',
            'home.code_error' => 'Koodissa on 6 merkkiä, esimerkiksi ABC234.',

            'event.code' => 'Koodi',
            'event.noscript' => 'Lomake vaatii JavaScriptin, koska viesti salataan selaimessasi ennen lähetystä.',
            'event.nickname' => 'Nimimerkki',
            'event.zone_live' => 'Luennon kysymykset',
            'event.zone_live_hint' => 'Luennoitsijan kysymykset tulevat tähän itsestään.',
            'event.zone_nick' => 'Nimimerkkisi',
            'event.zone_nick_hint' => 'Nimimerkki näkyy vain omien kysymystesi ja palautteesi yhteydessä.',
            'event.zone_ask' => 'Kysy tai anna palautetta',
            'event.nick_placeholder' => 'esim. Kahvikuppi42',
            'event.nick_hint' => 'Pakollinen ja luennolla uniikki. Älä käytä omaa nimeäsi tai muuta tunnistettavaa tietoa.',
            'event.nick_owned' => 'Kirjoitat nimimerkillä',
            'event.nick_change' => 'Vaihda nimimerkki',
            'event.kind' => 'Viestin tyyppi',
            'event.question' => 'Kysymys',
            'event.feedback' => 'Palaute',
            'event.message' => 'Viestisi',
            'event.message_placeholder' => 'Kirjoita kysymys tai palaute',
            'event.send' => 'Lähetä salattuna',
            'event.lock_hint' => 'Viesti ja nimimerkki salataan laitteellasi. Palvelin tallentaa vain salatun datan, jonka voi avata ainoastaan luennoitsija.',

            'page.too_many' => 'Liian monta yritystä',
            'page.too_many_text' => 'Odota hetki ja yritä uudelleen.',
            'page.not_found' => 'Luentoa ei löytynyt',
            'page.not_found_text' => 'Tarkista koodi luennoitsijan diasta.',
            'page.closed' => 'Kysymykset on suljettu',
            'page.closed_text' => 'Tämän luennon kysymysten vastaanotto on päättynyt. Kiitos osallistumisesta!',
            'page.not_ready' => 'Ei vielä käytössä',
            'page.not_ready_text' => 'Luennoitsija ei ole vielä viimeistellyt salausasetuksia.',
            'page.home' => 'Etusivulle',
            'page.back' => 'Takaisin',
            'privacy.title' => 'Tietosuoja',

            'err.nickname_format' => 'Nimimerkissä pitää olla 2–24 merkkiä: kirjaimia, numeroita, välilyöntejä tai merkkejä _ . -',
            'err.claim_rate' => 'Liian monta nimimerkkivarausta juuri nyt. Odota hetki.',
            'err.nickname_taken' => 'Nimimerkki on jo käytössä tällä luennolla. Valitse toinen.',
            'err.nickname_not_claimed' => 'Nimimerkkiä ei ole varattu tälle selaimelle. Valitse nimimerkki uudelleen.',
            'err.invalid_message' => 'Virheellinen viesti.',
            'err.submit_rate' => 'Liian monta viestiä lyhyessä ajassa. Odota hetki.',
            'err.quota' => 'Luennon viestikiintiö on täynnä.',
            'err.origin' => 'Virheellinen alkuperä.',
            'err.json' => 'Odotettiin JSON-dataa.',
            'err.event_not_found' => 'Luentoa ei löytynyt.',
            'err.closed' => 'Kysymysten vastaanotto on päättynyt.',
            'err.token' => 'Lomake on vanhentunut. Lataa sivu uudelleen.',
            'err.poll_closed' => 'Kysely ei ole auki.',
            'err.invalid_answer' => 'Virheellinen vastaus.',
            'err.vote_rate' => 'Liian monta vastausta lyhyessä ajassa. Odota hetki.',
            'err.poll_quota' => 'Kyselyn vastauskiintiö on täynnä.',

            'js.nickname_format' => 'Nimimerkissä pitää olla 2–24 merkkiä: kirjaimia, numeroita, välilyöntejä tai merkkejä _ . -',
            'js.claim_failed' => 'Nimimerkin varaus epäonnistui ({status}).',
            'js.no_storage' => 'Selaimesi ei salli tietojen tallennusta, joten nimimerkki muistetaan vain tämän sivun ajan.',
            'js.confirm_change' => 'Vaihdetaanko nimimerkki? Nykyinen nimimerkki pysyy varattuna tällä luennolla, eikä sitä voi enää käyttää.',
            'js.empty' => 'Kirjoita viesti ennen lähettämistä.',
            'js.too_long' => 'Viesti on liian pitkä. Enintään 2000 merkkiä.',
            'js.sending' => 'Lähetetään…',
            'js.send_failed' => 'Lähetys epäonnistui ({status}).',
            'js.sent_feedback' => 'Palaute lähetetty. Kiitos!',
            'js.sent_question' => 'Kysymys lähetetty. Kiitos!',
            'js.crypto_failed' => 'Salausta ei voitu alustaa: {error}',
            'js.crypto_missing' => 'Salauskirjasto puuttuu.',
            'js.bad_key' => 'Virheellinen avain.',
            'js.poll_heading' => 'Kysely',
            'js.poll_submit' => 'Vastaa',
            'js.poll_change' => 'Muuta vastausta',
            'js.poll_saved' => 'Kiitos! Voit muuttaa vastaustasi, kunnes kysely suljetaan.',
            'js.poll_waiting' => 'Odotetaan seuraavaa kysymystä…',
            'js.poll_closed_state' => 'Kysely on suljettu. Vastauksia ei enää oteta vastaan.',
            'js.poll_your_answer' => 'Vastauksesi on tallessa.',
            'js.reconnecting' => 'Yhteys katkesi. Yhdistetään uudelleen…',
            'js.poll_choose_one' => 'Valitse vaihtoehto.',
            'js.poll_choose_many' => 'Valitse yksi tai useampi vaihtoehto.',
            'js.poll_multi_hint' => 'Voit valita useita.',
            'js.poll_words_placeholder' => 'Kirjoita vastauksesi',
            'js.poll_words_hint' => 'Enintään 3 sanaa ja 30 merkkiä.',
            'js.poll_words_empty' => 'Kirjoita vastaus ennen lähettämistä.',
            'js.poll_words_long' => 'Vastaus on liian pitkä: enintään 3 sanaa ja 30 merkkiä.',
            'js.poll_open_placeholder' => 'Kirjoita vastauksesi',
            'js.poll_open_hint' => 'Älä kirjoita vastaukseen henkilötietoja.',
            'js.poll_open_empty' => 'Kirjoita vastaus ennen lähettämistä.',
            'js.poll_open_long' => 'Vastaus on liian pitkä: enintään {n} merkkiä.',
            'js.poll_saved_more' => 'Kiitos! Voit lähettää myös toisen vastauksen.',
            'js.poll_results' => 'Tulokset',
            'js.preview_no_send' => 'Esikatselu: vastausta ei lähetetä.',
            'js.poll_mean' => 'Keskiarvo',
            'js.poll_median' => 'mediaani',
            'js.poll_sent_count' => 'Lähetetty {n}.',
            'js.poll_failed' => 'Vastauksen lähetys epäonnistui ({status}).',
            'js.poll_anonymous' => 'Vastaat nimettömästi. Vastaus salataan laitteellasi ennen lähetystä.',
        ],
        'en' => [
            'lang.label' => 'Language',
            'foot.encrypted' => 'Messages are encrypted in your browser before sending.',
            'foot.privacy' => 'Privacy',

            'home.title' => 'Join',
            'home.heading' => 'Join a lecture',
            'home.intro' => 'Enter the code shown by the lecturer or scan the QR code.',
            'home.code_label' => 'Lecture code',
            'home.continue' => 'Continue',
            'home.code_error' => 'The code has 6 characters, for example ABC234.',

            'event.code' => 'Code',
            'event.noscript' => 'The form requires JavaScript because your message is encrypted in your browser before sending.',
            'event.nickname' => 'Nickname',
            'event.zone_live' => 'Lecture questions',
            'event.zone_live_hint' => 'The lecturer\'s questions appear here automatically.',
            'event.zone_nick' => 'Your nickname',
            'event.zone_nick_hint' => 'Your nickname is shown only with your own questions and feedback.',
            'event.zone_ask' => 'Ask a question or give feedback',
            'event.nick_placeholder' => 'e.g. CoffeeCup42',
            'event.nick_hint' => 'Required and unique within the lecture. Do not use your own name or other identifying information.',
            'event.nick_owned' => 'You are writing as',
            'event.nick_change' => 'Change nickname',
            'event.kind' => 'Message type',
            'event.question' => 'Question',
            'event.feedback' => 'Feedback',
            'event.message' => 'Your message',
            'event.message_placeholder' => 'Write a question or feedback',
            'event.send' => 'Send encrypted',
            'event.lock_hint' => 'Your message and nickname are encrypted on your device. The server stores only encrypted data that only the lecturer can open.',

            'page.too_many' => 'Too many attempts',
            'page.too_many_text' => 'Please wait a moment and try again.',
            'page.not_found' => 'Lecture not found',
            'page.not_found_text' => 'Check the code on the lecturer\'s slide.',
            'page.closed' => 'Questions are closed',
            'page.closed_text' => 'This lecture is no longer accepting questions. Thank you for participating!',
            'page.not_ready' => 'Not available yet',
            'page.not_ready_text' => 'The lecturer has not finished setting up encryption yet.',
            'page.home' => 'Front page',
            'page.back' => 'Back',
            'privacy.title' => 'Privacy',

            'err.nickname_format' => 'The nickname must be 2–24 characters: letters, numbers, spaces or the characters _ . -',
            'err.claim_rate' => 'Too many nickname reservations right now. Please wait a moment.',
            'err.nickname_taken' => 'This nickname is already taken in this lecture. Please choose another.',
            'err.nickname_not_claimed' => 'This nickname is not reserved for this browser. Please choose a nickname again.',
            'err.invalid_message' => 'Invalid message.',
            'err.submit_rate' => 'Too many messages in a short time. Please wait a moment.',
            'err.quota' => 'The message quota for this lecture is full.',
            'err.origin' => 'Invalid origin.',
            'err.json' => 'Expected JSON data.',
            'err.event_not_found' => 'Lecture not found.',
            'err.closed' => 'This lecture is no longer accepting messages.',
            'err.token' => 'The form has expired. Please reload the page.',
            'err.poll_closed' => 'This poll is not open.',
            'err.invalid_answer' => 'Invalid answer.',
            'err.vote_rate' => 'Too many answers in a short time. Please wait a moment.',
            'err.poll_quota' => 'This poll has reached its answer limit.',

            'js.nickname_format' => 'The nickname must be 2–24 characters: letters, numbers, spaces or the characters _ . -',
            'js.claim_failed' => 'Reserving the nickname failed ({status}).',
            'js.no_storage' => 'Your browser does not allow storing data, so your nickname is remembered only while this page is open.',
            'js.confirm_change' => 'Change your nickname? The current nickname stays reserved in this lecture and cannot be used again.',
            'js.empty' => 'Write a message before sending.',
            'js.too_long' => 'The message is too long. Maximum 2000 characters.',
            'js.sending' => 'Sending…',
            'js.send_failed' => 'Sending failed ({status}).',
            'js.sent_feedback' => 'Feedback sent. Thank you!',
            'js.sent_question' => 'Question sent. Thank you!',
            'js.crypto_failed' => 'Encryption could not be initialised: {error}',
            'js.crypto_missing' => 'The encryption library is missing.',
            'js.bad_key' => 'Invalid key.',
            'js.poll_heading' => 'Poll',
            'js.poll_submit' => 'Submit',
            'js.poll_change' => 'Change answer',
            'js.poll_saved' => 'Thanks! You can change your answer until the poll closes.',
            'js.poll_waiting' => 'Waiting for the next question…',
            'js.poll_closed_state' => 'This poll is closed. No more answers are accepted.',
            'js.poll_your_answer' => 'Your answer has been saved.',
            'js.reconnecting' => 'Connection lost. Reconnecting…',
            'js.poll_choose_one' => 'Choose an option.',
            'js.poll_choose_many' => 'Choose one or more options.',
            'js.poll_multi_hint' => 'You can choose several.',
            'js.poll_words_placeholder' => 'Type your answer',
            'js.poll_words_hint' => 'Up to 3 words and 30 characters.',
            'js.poll_words_empty' => 'Write an answer before sending.',
            'js.poll_words_long' => 'The answer is too long: up to 3 words and 30 characters.',
            'js.poll_open_placeholder' => 'Type your answer',
            'js.poll_open_hint' => 'Please do not include personal data.',
            'js.poll_open_empty' => 'Write an answer before sending.',
            'js.poll_open_long' => 'The answer is too long: up to {n} characters.',
            'js.poll_saved_more' => 'Thanks! You can send another answer.',
            'js.poll_results' => 'Results',
            'js.preview_no_send' => 'Preview: the answer is not sent.',
            'js.poll_mean' => 'Average',
            'js.poll_median' => 'median',
            'js.poll_sent_count' => 'Sent: {n}.',
            'js.poll_failed' => 'Sending the answer failed ({status}).',
            'js.poll_anonymous' => 'You answer anonymously. Your answer is encrypted on your device before sending.',
        ],
    ];

    /** Kieli pyynnöstä: ?lang (tai JSON-kentän lang) ensin, sitten Accept-Language, muuten suomi. */
    public static function fromRequest(Request $req, mixed $explicit = null): string
    {
        $explicit ??= $req->query['lang'] ?? null;
        if (is_string($explicit) && in_array($explicit, self::LANGS, true)) {
            return $explicit;
        }
        return self::fromAcceptLanguage((string) $req->header('accept-language'));
    }

    /** Käyttäjän nimenomaisesti valitsema kieli (?lang), tai null. */
    public static function explicit(Request $req): ?string
    {
        $q = $req->query['lang'] ?? null;
        return is_string($q) && in_array($q, self::LANGS, true) ? $q : null;
    }

    /** Valitsee tuetuista kielistä sen, jolla on suurin q-arvo. Tasatilanteessa aiempi voittaa. */
    public static function fromAcceptLanguage(string $header): string
    {
        $best = self::DEFAULT;
        $bestQ = 0.0;
        foreach (array_slice(explode(',', substr($header, 0, 512)), 0, 20) as $part) {
            $pieces = explode(';', trim($part));
            $primary = strtolower(explode('-', trim($pieces[0]))[0]);
            if (!in_array($primary, self::LANGS, true)) {
                continue;
            }
            $q = 1.0;
            foreach (array_slice($pieces, 1) as $param) {
                if (preg_match('/^\s*q\s*=\s*([01](?:\.\d{1,3})?)\s*$/', $param, $m) === 1) {
                    $q = (float) $m[1];
                }
            }
            if ($q > $bestQ) {
                $best = $primary;
                $bestQ = $q;
            }
        }
        return $best;
    }

    /** @param array<string, string|int> $params */
    public static function t(string $lang, string $key, array $params = []): string
    {
        $text = self::STRINGS[$lang][$key] ?? self::STRINGS[self::DEFAULT][$key] ?? $key;
        foreach ($params as $k => $v) {
            $text = str_replace('{' . $k . '}', (string) $v, $text);
        }
        return $text;
    }

    /** @return array<string, string> selaimen skriptin tekstit ilman "js."-etuliitettä */
    public static function jsStrings(string $lang): array
    {
        $out = [];
        foreach (self::STRINGS[$lang] ?? self::STRINGS[self::DEFAULT] as $key => $text) {
            if (str_starts_with($key, 'js.')) {
                $out[substr($key, 3)] = $text;
            }
        }
        return $out;
    }

    /** @return list<string> */
    public static function keys(string $lang): array
    {
        return array_keys(self::STRINGS[$lang] ?? []);
    }
}
