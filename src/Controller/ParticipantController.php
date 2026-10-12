<?php

declare(strict_types=1);

namespace HessuTalks\Controller;

use HessuTalks\Config;
use HessuTalks\Http\Request;
use HessuTalks\Http\Response;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\NicknameRepository;
use HessuTalks\Repository\QuestionRepository;
use HessuTalks\Security\FormToken;
use HessuTalks\Security\RateLimiter;
use HessuTalks\View;

/**
 * Osallistujan reitit. Osallistujista ei käsitellä henkilötietoja:
 * ei evästeitä, ei IP-osoitteita, ei nimiä eikä sähköposteja.
 * Väärinkäytösten rajoitus perustuu nimimerkkiin ja luentokohtaisiin kattoihin.
 */
final class ParticipantController
{
    public const WINDOW = 600;
    public const FAILED_LOOKUP_LIMIT = 1000;      // koko palvelu, 10 min
    public const CLAIM_LIMIT_PER_EVENT = 300;     // nimimerkkivarauksia / luento / 10 min
    public const SUBMIT_LIMIT_PER_NICK = 20;      // viestejä / nimimerkki / 10 min
    public const EVENT_MAX_QUESTIONS = 2000;

    public function __construct(
        private readonly Config $config,
        private readonly View $view,
        private readonly EventRepository $events,
        private readonly QuestionRepository $questions,
        private readonly NicknameRepository $nicknames,
        private readonly KeyRepository $keys,
        private readonly RateLimiter $limiter,
        private readonly FormToken $formToken,
    ) {
    }

    public function home(Request $req): Response
    {
        $input = $req->query['k'] ?? null;
        if (is_string($input) && $input !== '') {
            $code = EventRepository::normalizeCode($input);
            if ($code !== null) {
                return Response::redirect($this->config->url('/k/' . $code));
            }
            return Response::html($this->view->render('home', [
                'pageTitle' => 'Liity',
                'error' => 'Koodissa on 6 merkkiä, esimerkiksi ABC234.',
            ]), 400);
        }
        return Response::html($this->view->render('home', ['pageTitle' => 'Liity']));
    }

    public function privacy(): Response
    {
        return Response::html($this->view->render('privacy', ['pageTitle' => 'Tietosuoja']));
    }

    public function event(string $rawCode): Response
    {
        $code = EventRepository::normalizeCode($rawCode);
        $event = $code === null ? null : $this->events->findByCode($code);
        // Sama vastaus tuntemattomalle ja virheelliselle koodille (ei vihjeitä arvailijalle).
        if ($event === null) {
            if (!$this->limiter->hit('lookup_fail', self::FAILED_LOOKUP_LIMIT, self::WINDOW)) {
                return $this->message('Liian monta yritystä', 'Odota hetki ja yritä uudelleen.', 429);
            }
            return $this->message('Luentoa ei löytynyt', 'Tarkista koodi luennoitsijan diasta.', 404);
        }
        if (!$this->events->isOpen($event)) {
            return $this->message('Kysymykset on suljettu', 'Tämän luennon kysymysten vastaanotto on päättynyt. Kiitos osallistumisesta!', 410);
        }
        $pk = $this->keys->publicKey();
        if ($pk === null) {
            return $this->message('Ei vielä käytössä', 'Luennoitsija ei ole vielä viimeistellyt salausasetuksia.', 503);
        }
        return Response::html($this->view->render('event', [
            'pageTitle' => (string) $event['title'],
            'event' => $event,
            'publicKey' => $pk,
            'formToken' => $this->formToken->issue((int) $event['id']),
            'scripts' => ['vendor/sodium.js', 'js/participant.js'],
        ]));
    }

    /** Varaa nimimerkin luennolle. Palauttaa omistajatunnisteen, jonka selain tallentaa. */
    public function claimNickname(Request $req): Response
    {
        $ctx = $this->openEventFromRequest($req);
        if ($ctx instanceof Response) {
            return $ctx;
        }
        [$eventId, $in] = $ctx;

        $nick = NicknameRepository::clean($in['nickname'] ?? null);
        if ($nick === null) {
            return Response::error('Nimimerkissä pitää olla 2–24 merkkiä: kirjaimia, numeroita, välilyöntejä tai merkkejä _ . -', 422);
        }
        if (!$this->limiter->hit('claim|' . $eventId, self::CLAIM_LIMIT_PER_EVENT, self::WINDOW)
            || $this->nicknames->countForEvent($eventId) >= NicknameRepository::MAX_PER_EVENT) {
            return Response::error('Liian monta nimimerkkivarausta juuri nyt. Odota hetki.', 429);
        }
        $claim = $this->nicknames->claim($eventId, $nick);
        if ($claim === null) {
            return Response::error('Nimimerkki on jo käytössä tällä luennolla. Valitse toinen.', 409);
        }
        return Response::json(['nickname' => $nick, 'secret' => $claim['secret']], 201);
    }

    public function submit(Request $req): Response
    {
        $ctx = $this->openEventFromRequest($req);
        if ($ctx instanceof Response) {
            return $ctx;
        }
        [$eventId, $in] = $ctx;

        $nick = NicknameRepository::clean($in['nickname'] ?? null);
        $secret = is_string($in['secret'] ?? null) ? $in['secret'] : '';
        $nicknameId = $nick === null ? null : $this->nicknames->verify($eventId, $nick, $secret);
        if ($nicknameId === null) {
            return Response::json(['error' => 'Nimimerkkiä ei ole varattu tälle selaimelle. Valitse nimimerkki uudelleen.', 'reason' => 'nickname'], 403);
        }
        if (!QuestionRepository::isValidCiphertext($in['ciphertext'] ?? null)) {
            return Response::error('Virheellinen viesti.', 422);
        }
        if (!$this->limiter->hit('submit|' . $nicknameId, self::SUBMIT_LIMIT_PER_NICK, self::WINDOW)) {
            return Response::error('Liian monta viestiä lyhyessä ajassa. Odota hetki.', 429);
        }
        if ($this->questions->countForEvent($eventId) >= self::EVENT_MAX_QUESTIONS) {
            return Response::error('Luennon viestikiintiö on täynnä.', 429);
        }
        $this->questions->add($eventId, $nicknameId, (string) $in['ciphertext']);
        return Response::json(['ok' => true], 201);
    }

    /**
     * Yhteiset tarkistukset: sama origin, JSON, avoin luento ja voimassa oleva lomaketoken.
     * @return array{0: int, 1: array<string, mixed>}|Response
     */
    private function openEventFromRequest(Request $req): array|Response
    {
        if (!$this->sameOrigin($req)) {
            return Response::error('Virheellinen alkuperä.', 403);
        }
        if (!str_starts_with((string) $req->header('content-type'), 'application/json')) {
            return Response::error('Odotettiin JSON-dataa.', 415);
        }
        $in = $req->json();
        $code = is_string($in['code'] ?? null) ? EventRepository::normalizeCode($in['code']) : null;
        $event = $code === null ? null : $this->events->findByCode($code);
        if ($event === null) {
            return Response::error('Luentoa ei löytynyt.', 404);
        }
        $eventId = (int) $event['id'];
        if (!$this->events->isOpen($event)) {
            return Response::error('Kysymysten vastaanotto on päättynyt.', 410);
        }
        if (!is_string($in['token'] ?? null) || !$this->formToken->verify($in['token'], $eventId)) {
            return Response::error('Lomake on vanhentunut. Lataa sivu uudelleen.', 403);
        }
        return [$eventId, $in];
    }

    /**
     * Hyväksytään vain saman originin pyynnöt (CSRF-suoja). Selaimet lähettävät
     * Origin-otsakkeen aina fetch-POST-pyynnöissä.
     */
    private function sameOrigin(Request $req): bool
    {
        $origin = $req->header('origin');
        $site = $req->header('sec-fetch-site');
        if ($site !== null && !in_array($site, ['same-origin', 'none'], true)) {
            return false;
        }
        return $origin !== null && hash_equals($this->config->publicOrigin, $origin);
    }

    private function message(string $heading, string $message, int $status): Response
    {
        return Response::html($this->view->render('message', [
            'pageTitle' => $heading,
            'heading' => $heading,
            'message' => $message,
        ]), $status);
    }
}
