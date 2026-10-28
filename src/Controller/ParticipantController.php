<?php

declare(strict_types=1);

namespace HessuTalks\Controller;

use HessuTalks\Config;
use HessuTalks\Http\Request;
use HessuTalks\I18n;
use HessuTalks\Http\Response;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\LiveRepository;
use HessuTalks\Repository\NicknameRepository;
use HessuTalks\Repository\PollRepository;
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
    public const VOTE_LIMIT_PER_VOTER = 30;       // vastauksia (myös muutoksia) / vastaaja / kysely / 10 min

    public function __construct(
        private readonly Config $config,
        private readonly View $view,
        private readonly EventRepository $events,
        private readonly QuestionRepository $questions,
        private readonly NicknameRepository $nicknames,
        private readonly PollRepository $polls,
        private readonly LiveRepository $live,
        private readonly KeyRepository $keys,
        private readonly RateLimiter $limiter,
        private readonly FormToken $formToken,
    ) {
    }

    public function home(Request $req): Response
    {
        $lang = I18n::fromRequest($req);
        $input = $req->query['k'] ?? null;
        if (is_string($input) && $input !== '') {
            $code = EventRepository::normalizeCode($input);
            if ($code !== null) {
                return Response::redirect($this->config->url('/k/' . $code) . self::langQuery($req));
            }
            return $this->page($req, 'home', [
                'pageTitle' => I18n::t($lang, 'home.title'),
                'error' => I18n::t($lang, 'home.code_error'),
            ], 400);
        }
        return $this->page($req, 'home', ['pageTitle' => I18n::t($lang, 'home.title')]);
    }

    public function privacy(Request $req): Response
    {
        $lang = I18n::fromRequest($req);
        return $this->page($req, 'privacy_' . $lang, ['pageTitle' => I18n::t($lang, 'privacy.title')]);
    }

    public function event(string $rawCode, Request $req): Response
    {
        $code = EventRepository::normalizeCode($rawCode);
        $event = $code === null ? null : $this->events->findByCode($code);
        // Sama vastaus tuntemattomalle ja virheelliselle koodille (ei vihjeitä arvailijalle).
        if ($event === null) {
            if (!$this->limiter->hit('lookup_fail', self::FAILED_LOOKUP_LIMIT, self::WINDOW)) {
                return $this->message($req, 'page.too_many', 429);
            }
            return $this->message($req, 'page.not_found', 404);
        }
        if (!$this->events->isOpen($event)) {
            return $this->message($req, 'page.closed', 410);
        }
        $pk = $this->keys->publicKey();
        if ($pk === null) {
            return $this->message($req, 'page.not_ready', 503);
        }
        $lang = self::eventLang($req, $event);
        return $this->page($req, 'event', [
            'lang' => $lang,
            'pageTitle' => (string) $event['title'],
            'event' => $event,
            'publicKey' => $pk,
            'formToken' => $this->formToken->issue((int) $event['id']),
            'jsStrings' => (string) json_encode(I18n::jsStrings($lang), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'liveEndpoint' => $this->config->url('/api/live'),
            'answerEndpoint' => $this->config->url('/api/polls/answer'),
            'scripts' => ['vendor/sodium.js', 'js/lang.js', 'js/participant.js', 'js/results.js', 'js/polls.js'],
        ]);
    }

    /** Varaa nimimerkin luennolle. Palauttaa omistajatunnisteen, jonka selain tallentaa. */
    public function claimNickname(Request $req): Response
    {
        $ctx = $this->openEventFromRequest($req);
        if ($ctx instanceof Response) {
            return $ctx;
        }
        [$eventId, $in, $lang] = $ctx;

        $nick = NicknameRepository::clean($in['nickname'] ?? null);
        if ($nick === null) {
            return Response::error(I18n::t($lang, 'err.nickname_format'), 422);
        }
        if (!$this->limiter->hit('claim|' . $eventId, self::CLAIM_LIMIT_PER_EVENT, self::WINDOW)
            || $this->nicknames->countForEvent($eventId) >= NicknameRepository::MAX_PER_EVENT) {
            return Response::error(I18n::t($lang, 'err.claim_rate'), 429);
        }
        $claim = $this->nicknames->claim($eventId, $nick);
        if ($claim === null) {
            return Response::error(I18n::t($lang, 'err.nickname_taken'), 409);
        }
        return Response::json(['nickname' => $nick, 'secret' => $claim['secret']], 201);
    }

    public function submit(Request $req): Response
    {
        $ctx = $this->openEventFromRequest($req);
        if ($ctx instanceof Response) {
            return $ctx;
        }
        [$eventId, $in, $lang] = $ctx;

        $nick = NicknameRepository::clean($in['nickname'] ?? null);
        $secret = is_string($in['secret'] ?? null) ? $in['secret'] : '';
        $nicknameId = $nick === null ? null : $this->nicknames->verify($eventId, $nick, $secret);
        if ($nicknameId === null) {
            return Response::json(['error' => I18n::t($lang, 'err.nickname_not_claimed'), 'reason' => 'nickname'], 403);
        }
        if (!QuestionRepository::isValidCiphertext($in['ciphertext'] ?? null)) {
            return Response::error(I18n::t($lang, 'err.invalid_message'), 422);
        }
        if (!$this->limiter->hit('submit|' . $nicknameId, self::SUBMIT_LIMIT_PER_NICK, self::WINDOW)) {
            return Response::error(I18n::t($lang, 'err.submit_rate'), 429);
        }
        if ($this->questions->countForEvent($eventId) >= self::EVENT_MAX_QUESTIONS) {
            return Response::error(I18n::t($lang, 'err.quota'), 429);
        }
        $this->questions->add($eventId, $nicknameId, (string) $in['ciphertext']);
        return Response::json(['ok' => true], 201);
    }

    /**
     * Luennon aktiivinen kysymys. Selain kysyy tätä noin sekunnin välein. Jos ?v vastaa luennon
     * live_versionia, palautetaan vain {"unchanged": true}: yksi tietokantakysely, pieni vastaus.
     * poll = null tarkoittaa odotusnäkymää.
     */
    public function live(Request $req): Response
    {
        $lang = I18n::fromRequest($req);
        $raw = $req->query['code'] ?? '';
        $code = is_string($raw) ? EventRepository::normalizeCode($raw) : null;
        $event = $code === null ? null : $this->events->findByCode($code);
        if ($event === null) {
            $this->limiter->hit('lookup_fail', self::FAILED_LOOKUP_LIMIT, self::WINDOW);
            return Response::error(I18n::t($lang, 'err.event_not_found'), 404);
        }
        if (!$this->events->isOpen($event)) {
            return Response::json(['poll' => null, 'closed' => true, 'error' => I18n::t($lang, 'err.closed')], 410);
        }
        $version = (int) $event['live_version'];
        if (($req->query['v'] ?? null) === (string) $version) {
            return Response::json(['v' => $version, 'unchanged' => true]);
        }
        return Response::json(['v' => $version, 'poll' => $this->live->participantPoll($event)]);
    }

    /** Tallentaa salatun kyselyvastauksen. Saman selaimen uusi vastaus korvaa aiemman. */
    public function answerPoll(Request $req): Response
    {
        $ctx = $this->openEventFromRequest($req);
        if ($ctx instanceof Response) {
            return $ctx;
        }
        [$eventId, $in, $lang] = $ctx;

        $pollId = $in['poll'] ?? null;
        $poll = is_int($pollId) ? $this->polls->find($pollId) : null;
        // Vain aktiivinen ja avoin kysymys ottaa vastaan vastauksia.
        if ($poll === null || $poll['event_id'] !== $eventId || $poll['status'] !== 'open' || $this->live->activeId($eventId) !== $poll['id']) {
            return Response::error(I18n::t($lang, 'err.poll_closed'), 409);
        }
        if (!PollRepository::isValidVoter($in['voter'] ?? null) || !PollRepository::isValidCiphertext($in['ciphertext'] ?? null)) {
            return Response::error(I18n::t($lang, 'err.invalid_answer'), 422);
        }
        $bucket = 'vote|' . $poll['id'] . '|' . hash('sha256', (string) $in['voter']);
        if (!$this->limiter->hit($bucket, self::VOTE_LIMIT_PER_VOTER, self::WINDOW)) {
            return Response::error(I18n::t($lang, 'err.vote_rate'), 429);
        }
        $multiple = $poll['type'] === 'open' && ($poll['config']['multiple'] ?? false) === true;
        if (!$this->polls->answer((int) $poll['id'], (string) $in['voter'], (string) $in['ciphertext'], $multiple)) {
            return Response::error(I18n::t($lang, 'err.poll_quota'), 429);
        }
        return Response::json(['ok' => true], 201);
    }

    /**
     * Yhteiset tarkistukset: sama origin, JSON, avoin luento ja voimassa oleva lomaketoken.
     * Virheilmoitusten kieli: JSON-kenttä lang, muuten Accept-Language.
     * @return array{0: int, 1: array<string, mixed>, 2: string}|Response
     */
    private function openEventFromRequest(Request $req): array|Response
    {
        $in = $req->json();
        $lang = I18n::fromRequest($req, $in['lang'] ?? null);
        if (!$this->sameOrigin($req)) {
            return Response::error(I18n::t($lang, 'err.origin'), 403);
        }
        if (!str_starts_with((string) $req->header('content-type'), 'application/json')) {
            return Response::error(I18n::t($lang, 'err.json'), 415);
        }
        $code = is_string($in['code'] ?? null) ? EventRepository::normalizeCode($in['code']) : null;
        $event = $code === null ? null : $this->events->findByCode($code);
        if ($event === null) {
            return Response::error(I18n::t($lang, 'err.event_not_found'), 404);
        }
        $eventId = (int) $event['id'];
        if (!$this->events->isOpen($event)) {
            return Response::error(I18n::t($lang, 'err.closed'), 410);
        }
        if (!is_string($in['token'] ?? null) || !$this->formToken->verify($in['token'], $eventId)) {
            return Response::error(I18n::t($lang, 'err.token'), 403);
        }
        return [$eventId, $in, $lang];
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

    /** Ilmoitussivu: otsikko avaimesta $key ja teksti avaimesta $key . '_text'. */
    private function message(Request $req, string $key, int $status): Response
    {
        $lang = I18n::fromRequest($req);
        return $this->page($req, 'message', [
            'pageTitle' => I18n::t($lang, $key),
            'heading' => I18n::t($lang, $key),
            'message' => I18n::t($lang, $key . '_text'),
        ], $status);
    }

    /**
     * Osallistujan sivu valitulla kielellä ja kielikytkimellä.
     * @param array<string, mixed> $vars
     */
    private function page(Request $req, string $template, array $vars, int $status = 200): Response
    {
        return Response::html($this->view->render($template, $vars + [
            'lang' => I18n::fromRequest($req),
            'langQuery' => self::langQuery($req),
            'langSwitch' => true,
            'scripts' => ['js/lang.js'],
        ]), $status);
    }

    /**
     * Luennon sivun kieli: käyttäjän valinta (?lang), muuten luennon oletuskieli, muuten selaimen kieli.
     * @param array<string, mixed> $event
     */
    private static function eventLang(Request $req, array $event): string
    {
        $default = $event['lang'] ?? null;
        return I18n::explicit($req) ?? (is_string($default) && in_array($default, I18n::LANGS, true) ? $default : I18n::fromRequest($req));
    }

    /** '?lang=xx', jos käyttäjä on valinnut kielen; sisäiset linkit säilyttävät valinnan. */
    private static function langQuery(Request $req): string
    {
        $lang = I18n::explicit($req);
        return $lang === null ? '' : '?lang=' . $lang;
    }
}
