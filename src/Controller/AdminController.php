<?php

declare(strict_types=1);

namespace HessuTalks\Controller;

use HessuTalks\Auth\AdminAuth;
use HessuTalks\Config;
use HessuTalks\Http\Request;
use HessuTalks\Http\Response;
use HessuTalks\I18n;
use HessuTalks\Import\SetFormat;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\LiveRepository;
use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\QuestionRepository;
use HessuTalks\Repository\SetRepository;
use HessuTalks\Security\AuditLog;
use HessuTalks\Security\ClientId;
use HessuTalks\View;

final class AdminController
{
    public function __construct(
        private readonly Config $config,
        private readonly View $view,
        private readonly AdminAuth $auth,
        private readonly EventRepository $events,
        private readonly QuestionRepository $questions,
        private readonly PollRepository $polls,
        private readonly SetRepository $sets,
        private readonly LiveRepository $live,
        private readonly KeyRepository $keys,
        private readonly PasskeyRepository $passkeys,
        private readonly AuditLog $audit,
        private readonly ClientId $clientId,
    ) {
    }

    public function page(): Response
    {
        $mode = $this->auth->isAuthenticated() ? 'app' : ($this->auth->needsSetup() ? 'setup' : 'login');
        return Response::html($this->view->render('admin', [
            'pageTitle' => 'Hallinta',
            'csrf' => $this->auth->csrfToken(),
            'mode' => $mode,
            'origin' => $this->config->publicOrigin,
            'bodyClass' => 'admin',
            'scripts' => ['vendor/sodium-sumo.js', 'vendor/qrcode.js', 'js/results.js', 'js/admin.js'],
        ]));
    }

    /**
     * Esitysikkuna projektorille. Sivu ei sisällä dataa eikä salauskirjastoa: se näyttää vain sen,
     * minkä kirjautuneen ylläpitäjän ikkuna (avaaja) lähettää sille postMessagella.
     */
    public function presenter(): Response
    {
        if (!$this->auth->isAuthenticated()) {
            return Response::html('<!doctype html><meta charset="utf-8"><title>Kirjautuminen vaaditaan</title><p>Kirjautuminen vaaditaan.</p>', 401);
        }
        return Response::html($this->view->render('presenter', [
            'pageTitle' => 'Esitys',
            'scripts' => ['vendor/qrcode.js', 'js/results.js', 'js/presenter.js'],
        ], 'presenter_layout'));
    }

    /**
     * Esikatselu osallistujan ulkoasussa (vaatimus 6): sama kortti kuin osallistujalla, mutta vastausta ei
     * lähetetä. Vaatii kirjautumisen. Näytetään vain julkiset kentät (ei oikeita vastauksia).
     */
    public function preview(Request $req): Response
    {
        if (!$this->auth->isAuthenticated()) {
            return Response::html('<!doctype html><meta charset="utf-8"><title>Kirjautuminen vaaditaan</title><p>Kirjautuminen vaaditaan.</p>', 401);
        }
        $raw = $req->query['poll'] ?? '';
        $poll = is_string($raw) && ctype_digit($raw) ? $this->polls->find((int) $raw) : null;
        $event = $poll === null ? null : $this->events->find((int) $poll['event_id']);
        if ($poll === null || $event === null) {
            return Response::html('<!doctype html><meta charset="utf-8"><title>Ei löytynyt</title><p>Kysymystä ei löytynyt.</p>', 404);
        }
        $lang = is_string($event['lang'] ?? null) && in_array($event['lang'], I18n::LANGS, true) ? $event['lang'] : I18n::DEFAULT;
        $public = [
            'id' => (int) $poll['id'], 'type' => (string) $poll['type'], 'prompt' => (string) $poll['prompt'],
            'config' => (object) PollRepository::publicConfig(is_array($poll['config']) ? $poll['config'] : []),
            'generation' => 0, 'status' => 'open', 'results' => null, 'reveal' => null,
        ];
        return Response::html($this->view->render('preview', [
            'pageTitle' => 'Esikatselu',
            'lang' => $lang,
            'event' => $event,
            'pollJson' => (string) json_encode($public, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'jsStrings' => (string) json_encode(I18n::jsStrings($lang), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'scripts' => ['js/results.js', 'js/polls.js'],
        ]));
    }

    /**
     * Ohjaa /admin/api/* -pyynnöt. Kaikki POST-pyynnöt vaativat saman originin ja CSRF-tokenin;
     * kaikki paitsi kirjautumiseen liittyvät vaativat kirjautumisen.
     */
    public function api(Request $req, string $route): Response
    {
        if ($req->method === 'POST') {
            if (!$this->sameOrigin($req) || !$this->auth->verifyCsrf($req)) {
                return Response::error('CSRF-tarkistus epäonnistui.', 403);
            }
            if (!str_starts_with((string) $req->header('content-type'), 'application/json')) {
                return Response::error('Odotettiin JSON-dataa.', 415);
            }
        } elseif ($req->method !== 'GET') {
            return Response::error('Metodia ei tueta.', 405);
        }

        $client = $this->clientId->of($req->clientIp);
        $in = $req->json();

        // --- Julkiset (kirjautumattomat) reitit ---------------------------
        $public = match ([$req->method, $route]) {
            ['POST', 'setup/token'] => $this->setupToken($in, $client),
            ['POST', 'passkey/register-options'] => $this->registerOptions(),
            ['POST', 'passkey/register'] => $this->register($in, $client),
            ['POST', 'login/options'] => $this->loginOptions($client),
            ['POST', 'login'] => $this->login($in, $client),
            default => null,
        };
        if ($public !== null) {
            return $public;
        }

        if (!$this->auth->isAuthenticated()) {
            return Response::error('Kirjautuminen vaaditaan.', 401);
        }

        // --- Kirjautuneen ylläpitäjän reitit -------------------------------
        if (preg_match('#^events/(\d{1,10})/(questions|status|delete|lang|qr)$#', $route, $m) === 1) {
            return $this->eventAction($req, (int) $m[1], $m[2], $in, $client);
        }
        if (preg_match('#^events/(\d{1,10})/(polls|poll-answers|sets|live|import|export)$#', $route, $m) === 1) {
            return $this->eventPolls($req, (int) $m[1], $m[2], $in, $client);
        }
        if (preg_match('#^polls/(\d{1,10})/(update|status|delete|reset|move|moderation|results|reveal|summary|set)$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->pollAction((int) $m[1], $m[2], $in, $client);
        }
        if (preg_match('#^sets/(\d{1,10})/(update|move|skip|delete|duplicate)$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->setAction((int) $m[1], $m[2], $in, $client);
        }
        if (preg_match('#^questions/(\d{1,10})/(status|delete)$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->questionAction((int) $m[1], $m[2], $in);
        }
        if (preg_match('#^passkeys/(\d{1,10})/delete$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->passkeys->delete((int) $m[1])
                ? Response::json(['ok' => true])
                : Response::error('Viimeistä passkeyta ei voi poistaa.', 409);
        }
        if (preg_match('#^passkeys/(\d{1,10})/(prf|prf-delete)$#', $route, $m) === 1 && $req->method === 'POST') {
            return $m[2] === 'prf' ? $this->savePrfWrap((int) $m[1], $in, $client) : $this->deletePrfWrap((int) $m[1], $client);
        }

        return match ([$req->method, $route]) {
            ['GET', 'state'] => $this->state(),
            ['POST', 'logout'] => $this->logout($client),
            ['POST', 'keys'] => $this->saveKeys($in, $client),
            ['POST', 'keys/rewrap'] => $this->rewrapKeys($in, $client),
            ['GET', 'events'] => Response::json(['events' => array_map($this->eventOut(...), $this->events->all())]),
            ['POST', 'events'] => $this->createEvent($in, $client),
            ['GET', 'audit'] => Response::json(['entries' => $this->audit->recent()]),
            default => Response::error('Ei löytynyt.', 404),
        };
    }

    // ------------------------------------------------------------ autentikointi

    /** @param array<string, mixed> $in */
    private function setupToken(array $in, string $client): Response
    {
        $token = is_string($in['token'] ?? null) ? $in['token'] : '';
        return $this->auth->verifySetupToken($token, $client)
            ? Response::json(['ok' => true])
            : Response::error('Virheellinen käyttöönottotunnus.', 403);
    }

    private function registerOptions(): Response
    {
        $opts = $this->auth->registrationOptions();
        return $opts === null ? Response::error('Ei oikeutta.', 403) : Response::json($opts);
    }

    /** @param array<string, mixed> $in */
    private function register(array $in, string $client): Response
    {
        return $this->auth->completeRegistration($in, $client)
            ? Response::json(['ok' => true, 'csrf' => $this->auth->csrfToken()])
            : Response::error('Passkeyn rekisteröinti epäonnistui.', 400);
    }

    private function loginOptions(string $client): Response
    {
        $opts = $this->auth->loginOptions($client);
        return $opts === null ? Response::error('Kirjautuminen ei ole nyt mahdollista.', 429) : Response::json($opts);
    }

    /** @param array<string, mixed> $in */
    private function login(array $in, string $client): Response
    {
        if (!$this->auth->completeLogin($in, $client)) {
            return Response::error('Kirjautuminen epäonnistui.', 401);
        }
        $passkeyId = $this->auth->sessionPasskeyId();
        return Response::json([
            'ok' => true,
            'csrf' => $this->auth->csrfToken(),
            'passkey' => $passkeyId,
            // Salattu kopio yksityisestä avaimesta. Sen voi avata vain passkeyn PRF-arvolla selaimessa.
            'prf' => $passkeyId === null ? null : $this->passkeys->prfWrap($passkeyId),
        ]);
    }

    /**
     * Tallentaa passkey-kohtaisen salatun kopion yksityisestä avaimesta. Sallittu vain sille passkeylle,
     * jolla istunto kirjautui, koska vain se tuotti PRF-arvon tässä selaimessa.
     *
     * @param array<string, mixed> $in
     */
    private function savePrfWrap(int $id, array $in, string $client): Response
    {
        if ($this->auth->sessionPasskeyId() !== $id) {
            return Response::error('Avauksen voi ottaa käyttöön vain passkeylle, jolla kirjauduit.', 403);
        }
        $current = $this->keys->publicKey();
        $b64 = static function (mixed $v, int $len): ?string {
            $raw = is_string($v) ? base64_decode($v, true) : false;
            return $raw !== false && strlen($raw) === $len ? (string) $v : null;
        };
        $enc = $b64($in['enc_secret_key'] ?? null, SODIUM_CRYPTO_BOX_SECRETKEYBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES);
        $nonce = $b64($in['nonce'] ?? null, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        if ($enc === null || $nonce === null) {
            return Response::error('Virheellinen salattu avain.', 422);
        }
        if ($current === null || !is_string($in['public_key'] ?? null) || !hash_equals($current, $in['public_key'])) {
            return Response::error('Julkinen avain ei täsmää.', 409);
        }
        if (!$this->passkeys->setPrfWrap($id, $enc, $nonce)) {
            return Response::error('Ei löytynyt.', 404);
        }
        $this->audit->record('prf_unlock_enabled', $client, 'passkey #' . $id);
        return Response::json(['ok' => true]);
    }

    private function deletePrfWrap(int $id, string $client): Response
    {
        if (!$this->passkeys->clearPrfWrap($id)) {
            return Response::error('Ei löytynyt.', 404);
        }
        $this->audit->record('prf_unlock_disabled', $client, 'passkey #' . $id);
        return Response::json(['ok' => true]);
    }

    private function logout(string $client): Response
    {
        $this->audit->record('logout', $client);
        $this->auth->logout();
        return Response::json(['ok' => true]);
    }

    // ------------------------------------------------------------ tila ja avaimet

    private function state(): Response
    {
        $keys = $this->keys->get();
        return Response::json([
            'keys' => $keys === null ? null : $keys + ['fingerprint' => KeyRepository::fingerprint((string) $keys['public_key'])],
            'passkeys' => $this->passkeys->list(),
            'passkey' => $this->auth->sessionPasskeyId(),
            'events' => array_map($this->eventOut(...), $this->events->all()),
            'origin' => $this->config->publicOrigin,
            'basePath' => $this->config->basePath,
        ]);
    }

    /** @param array<string, mixed> $in */
    private function saveKeys(array $in, string $client): Response
    {
        $err = KeyRepository::validate($in);
        if ($err !== null) {
            return Response::error($err, 422);
        }
        if (!$this->keys->createOnce($in)) {
            return Response::error('Avaimet on jo luotu.', 409);
        }
        $this->audit->record('keys_created', $client, KeyRepository::fingerprint((string) $in['public_key']));
        return Response::json(['ok' => true], 201);
    }

    /** @param array<string, mixed> $in */
    private function rewrapKeys(array $in, string $client): Response
    {
        $err = KeyRepository::validate($in);
        if ($err !== null) {
            return Response::error($err, 422);
        }
        if (!$this->keys->rewrap($in)) {
            return Response::error('Julkinen avain ei täsmää.', 409);
        }
        $this->audit->record('passphrase_changed', $client);
        return Response::json(['ok' => true]);
    }

    // ------------------------------------------------------------ tapahtumat

    /** @param array<string, mixed> $in */
    private function createEvent(array $in, string $client): Response
    {
        $title = is_string($in['title'] ?? null) ? $in['title'] : '';
        $hours = $in['hours'] ?? null;
        if ($hours !== null && (!is_int($hours) || $hours < 1 || $hours > 24 * 30)) {
            return Response::error('Kesto 1–720 tuntia.', 422);
        }
        $lang = $in['lang'] ?? null;
        if ($lang !== null && !in_array($lang, ['fi', 'en'], true)) {
            return Response::error('Tuntematon kieli.', 422);
        }
        try {
            $event = $this->events->create($title, $hours, $lang);
        } catch (\InvalidArgumentException $e) {
            return Response::error($e->getMessage(), 422);
        }
        $this->audit->record('event_created', $client, (string) $event['code']);
        return Response::json(['event' => $this->eventOut($event)], 201);
    }

    /** @param array<string, mixed> $in */
    private function eventAction(Request $req, int $id, string $action, array $in, string $client): Response
    {
        $event = $this->events->find($id);
        if ($event === null) {
            return Response::error('Tapahtumaa ei löytynyt.', 404);
        }
        if ($action === 'questions' && $req->method === 'GET') {
            $after = isset($req->query['after']) && ctype_digit($req->query['after']) ? (int) $req->query['after'] : 0;
            return Response::json([
                'event' => $this->eventOut($event),
                'questions' => $this->questions->forEvent($id, $after),
                'statuses' => $this->questions->statusesForEvent($id),
            ]);
        }
        if ($req->method !== 'POST') {
            return Response::error('Metodia ei tueta.', 405);
        }
        if ($action === 'qr') {
            if (!is_bool($in['show'] ?? null)) {
                return Response::error('Virheellinen arvo.', 422);
            }
            $this->events->setShowQr($id, $in['show']);
            // Versio kertoo muille hallintaikkunoille (esim. läppärin projektori), että tila muuttui.
            $this->live->bump($id);
            return Response::json(['event' => $this->eventOut((array) $this->events->find($id))]);
        }
        if ($action === 'lang') {
            $lang = $in['lang'] ?? null;
            if ($lang !== null && !in_array($lang, ['fi', 'en'], true)) {
                return Response::error('Tuntematon kieli.', 422);
            }
            $this->events->setLang($id, $lang);
            return Response::json(['event' => $this->eventOut((array) $this->events->find($id))]);
        }
        if ($action === 'status') {
            $status = is_string($in['status'] ?? null) ? $in['status'] : '';
            try {
                $this->events->setStatus($id, $status);
            } catch (\InvalidArgumentException $e) {
                return Response::error($e->getMessage(), 422);
            }
            return Response::json(['event' => $this->eventOut((array) $this->events->find($id))]);
        }
        // delete
        $this->events->delete($id);
        $this->audit->record('event_deleted', $client, (string) $event['code']);
        return Response::json(['ok' => true]);
    }

    /** @param array<string, mixed> $in */
    private function questionAction(int $id, string $action, array $in): Response
    {
        if ($action === 'delete') {
            return $this->questions->delete($id) ? Response::json(['ok' => true]) : Response::error('Ei löytynyt.', 404);
        }
        $status = is_string($in['status'] ?? null) ? $in['status'] : '';
        try {
            $ok = $this->questions->setStatus($id, $status);
        } catch (\InvalidArgumentException $e) {
            return Response::error($e->getMessage(), 422);
        }
        return $ok ? Response::json(['ok' => true]) : Response::error('Ei löytynyt.', 404);
    }

    /**
     * Luennon kyselyt (GET), uusi kysely (POST) ja salatut vastaukset (poll-answers).
     * @param array<string, mixed> $in
     */
    private function eventPolls(Request $req, int $eventId, string $action, array $in, string $client): Response
    {
        $event = $this->events->find($eventId);
        if ($event === null) {
            return Response::error('Tapahtumaa ei löytynyt.', 404);
        }
        if ($action === 'poll-answers') {
            if ($req->method !== 'GET') {
                return Response::error('Metodia ei tueta.', 405);
            }
            $after = isset($req->query['after']) && ctype_digit($req->query['after']) ? (int) $req->query['after'] : 0;
            $generations = [];
            foreach ($this->polls->forEvent($eventId) as $p) {
                $generations[(string) $p['id']] = $p['generation'];
            }
            return Response::json([
                'answers' => $this->polls->answersForEvent($eventId, $after),
                'generations' => (object) $generations,
                'version' => (int) ($event['live_version'] ?? 0),
            ]);
        }
        if ($req->method === 'GET') {
            return match ($action) {
                'polls' => $this->pollsState($event),
                'export' => $this->export($event, $req->query['set'] ?? null),
                default => Response::error('Metodia ei tueta.', 405),
            };
        }
        if ($action === 'import') {
            return $this->import($event, $in, $client);
        }
        if ($action === 'sets') {
            $slug = SetRepository::cleanSlug($in['slug'] ?? null);
            $title = SetRepository::cleanTitle($in['title'] ?? null);
            if ($slug === null || $title === null) {
                return Response::error('Tunniste 1–16 merkkiä (A–Z, 0–9, - tai _) ja nimi 1–' . SetRepository::TITLE_MAX . ' merkkiä.', 422);
            }
            $created = $this->sets->create($eventId, $slug, $title);
            return is_string($created) ? Response::error($created, 409) : $this->pollsState($event, 201);
        }
        if ($action === 'live') {
            return $this->liveAction($event, $in);
        }
        $set = is_int($in['set_id'] ?? null) ? $this->sets->find($in['set_id']) : null;
        if ($set === null || $set['event_id'] !== $eventId) {
            return Response::error('Valitse kysymyssarja.', 422);
        }
        $valid = PollRepository::validate($in['type'] ?? null, $in['prompt'] ?? null, $in['config'] ?? null);
        if (is_string($valid)) {
            return Response::error($valid, 422);
        }
        $id = $this->polls->create($eventId, (int) $set['id'], (string) $in['type'], $valid[0], $valid[1]);
        if ($id === null) {
            return Response::error('Luennolla on jo enimmäismäärä kyselyitä.', 409);
        }
        return Response::json(['poll' => $this->pollOut((array) $this->polls->find($id), $event)], 201);
    }

    /** @param array<string, mixed> $in */
    private function pollAction(int $id, string $action, array $in, string $client): Response
    {
        $poll = $this->polls->find($id);
        $event = $poll === null ? null : $this->events->find((int) $poll['event_id']);
        if ($poll === null || $event === null) {
            return Response::error('Kyselyä ei löytynyt.', 404);
        }
        switch ($action) {
            case 'update':
                $valid = PollRepository::validate($poll['type'], $in['prompt'] ?? null, $in['config'] ?? null);
                if (is_string($valid)) {
                    return Response::error($valid, 422);
                }
                $error = $this->polls->update($id, $valid[0], $valid[1]);
                if ($error !== null) {
                    return Response::error($error, 409);
                }
                $this->live->bump((int) $event['id']);
                break;
            case 'status':
                // Avaaminen tekee kyselystä aktiivisen (vain aktiivinen voi olla auki).
                $status = is_string($in['status'] ?? null) ? $in['status'] : '';
                if ($status === 'open') {
                    $this->live->open((int) $event['id'], $id);
                    break;
                }
                try {
                    $this->polls->setStatus($id, $status);
                } catch (\InvalidArgumentException $e) {
                    return Response::error($e->getMessage(), 422);
                }
                $this->live->bump((int) $event['id']);
                break;
            case 'move':
                $dir = $in['dir'] ?? null;
                if (!is_int($dir) || !$this->polls->move($id, $dir)) {
                    return Response::error('Kyselyä ei voi siirtää.', 409);
                }
                return $this->pollsState($event);
            case 'results':
                if (!is_bool($in['visible'] ?? null)) {
                    return Response::error('Virheellinen arvo.', 422);
                }
                $this->polls->setResultsVisible($id, $in['visible']);
                $this->live->bump((int) $event['id']);
                break;
            case 'reveal':
                if (!is_bool($in['revealed'] ?? null)) {
                    return Response::error('Virheellinen arvo.', 422);
                }
                if ($in['revealed'] && !isset($poll['config']['correct'])) {
                    return Response::error('Kysymyksellä ei ole oikeaa vastausta.', 409);
                }
                $this->polls->setRevealed($id, $in['revealed']);
                $this->live->bump((int) $event['id']);
                break;
            case 'summary':
                // Kooste julkaistaan osallistujille vain, kun tulokset ovat näkyvissä (P2).
                if ($poll['results_visible'] !== true) {
                    return Response::error('Tulokset eivät ole näkyvissä.', 409);
                }
                $summary = PollRepository::validSummary($poll, $in['summary'] ?? null);
                if ($summary === null) {
                    return Response::error('Virheellinen tuloskooste.', 422);
                }
                $this->polls->setSummary($id, $summary);
                $this->live->bump((int) $event['id']);
                return Response::json(['ok' => true]);
            case 'set':
                $target = is_int($in['set_id'] ?? null) ? $this->sets->find($in['set_id']) : null;
                if ($target === null || $target['event_id'] !== (int) $event['id'] || !$this->polls->moveToSet($id, (int) $target['id'])) {
                    return Response::error('Sarjaa ei löytynyt.', 404);
                }
                return $this->pollsState($event);
            case 'moderation':
                // Salattu luennoitsijan omalla julkisella avaimella: palvelin ei näe piilotettuja sanoja.
                $ct = $in['ciphertext'] ?? null;
                if ($ct !== null && !PollRepository::isValidModeration($ct)) {
                    return Response::error('Virheellinen moderointitieto.', 422);
                }
                $this->polls->setModeration($id, $ct);
                return Response::json(['ok' => true]);
            case 'reset':
                $this->polls->reset($id);
                $this->live->bump((int) $event['id']);
                $this->audit->record('poll_reset', $client, (string) $event['code'] . '#' . $id);
                break;
            default: // delete
                $this->live->forgetPoll((int) $event['id'], $id);
                $this->polls->delete($id);
                $this->audit->record('poll_deleted', $client, (string) $event['code'] . '#' . $id);
                return Response::json(['ok' => true]);
        }
        return Response::json(['poll' => $this->pollOut((array) $this->polls->find($id), $event)]);
    }

    /**
     * @param array<string, mixed> $poll
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    private function pollOut(array $poll, array $event): array
    {
        return [
            'id' => (int) ($poll['id'] ?? 0),
            'type' => (string) ($poll['type'] ?? ''),
            'prompt' => (string) ($poll['prompt'] ?? ''),
            'config' => (object) (is_array($poll['config'] ?? null) ? $poll['config'] : []),
            'status' => (string) ($poll['status'] ?? ''),
            'generation' => (int) ($poll['generation'] ?? 1),
            'answer_count' => $this->polls->countAnswers((int) ($poll['id'] ?? 0)),
            'set_id' => (int) ($poll['set_id'] ?? 0),
            'moderation' => is_string($poll['moderation'] ?? null) ? $poll['moderation'] : null,
            'results_visible' => ($poll['results_visible'] ?? false) === true,
            'revealed' => ($poll['revealed'] ?? false) === true,
            'position' => (int) ($poll['position'] ?? 0),
            'url' => $this->config->publicOrigin . $this->config->url('/k/' . (string) ($event['code'] ?? '')),
        ];
    }

    /**
     * Luennon sarjat, kyselyt ja aktiivinen kysymys hallinnan näkymälle.
     * @param array<string, mixed> $event
     */
    private function pollsState(array $event, int $status = 200): Response
    {
        $eventId = (int) $event['id'];
        $fresh = $this->events->find($eventId) ?? $event;
        return Response::json([
            'sets' => array_map(static fn (array $s): array => [
                'id' => $s['id'], 'slug' => $s['slug'], 'title' => $s['title'], 'position' => $s['position'], 'skipped' => $s['skipped'],
            ], $this->sets->forEvent($eventId)),
            'polls' => array_map(fn (array $p): array => $this->pollOut($p, $event), $this->polls->forEvent($eventId)),
            'active' => $this->live->activeId($eventId),
            // Ohjaustila: versio muuttuu, kun toinen hallintaikkuna (esim. puhelimen ohjain) muuttaa jotain.
            'version' => (int) ($fresh['live_version'] ?? 0),
            'show_qr' => (int) ($fresh['show_qr'] ?? 0) === 1,
        ], $status);
    }

    /**
     * Aktiivisen kysymyksen ohjaus: activate (poll tai null = odotusnäkymä), next, prev.
     * @param array<string, mixed> $event
     * @param array<string, mixed> $in
     */
    private function liveAction(array $event, array $in): Response
    {
        $eventId = (int) $event['id'];
        switch ($in['action'] ?? null) {
            case 'activate':
                $poll = $in['poll'] ?? null;
                if (($poll !== null && !is_int($poll)) || !$this->live->activate($eventId, $poll)) {
                    return Response::error('Kyselyä ei löytynyt.', 404);
                }
                break;
            case 'next':
            case 'prev':
                if ($this->live->step($eventId, $in['action'] === 'next' ? 1 : -1) === null) {
                    return Response::error($in['action'] === 'next' ? 'Ei enempää kysymyksiä.' : 'Tämä on ensimmäinen kysymys.', 409);
                }
                break;
            default:
                return Response::error('Tuntematon toiminto.', 422);
        }
        return $this->pollsState($event);
    }

    /**
     * Tuo sarjat JSON-tiedostosta. dry_run = vain tarkistus ja yhteenveto. Kaikki tai ei mitään:
     * virheet (myös luennolla jo oleva sarjan tunniste) estävät tuonnin, ohitetut kysymykset ovat varoituksia.
     * @param array<string, mixed> $event
     * @param array<string, mixed> $in
     */
    private function import(array $event, array $in, string $client): Response
    {
        $eventId = (int) $event['id'];
        $raw = $in['json'] ?? null;
        if (!is_string($raw)) {
            return Response::error('Tiedosto puuttuu.', 422);
        }
        $parsed = SetFormat::parse($raw);
        $errors = $parsed['errors'];
        $existing = array_column($this->sets->forEvent($eventId), 'slug');
        foreach ($parsed['sets'] as $set) {
            if (in_array($set['slug'], $existing, true)) {
                $errors[] = 'Sarja ' . $set['slug'] . ' on jo luennolla. Poista tai nimeä se uudelleen ennen tuontia.';
            }
        }
        $pollCount = array_sum(array_map(static fn (array $s): int => count($s['polls']), $parsed['sets']));
        if (count($existing) + count($parsed['sets']) > SetRepository::MAX_PER_EVENT) {
            $errors[] = 'Luennolla voi olla enintään ' . SetRepository::MAX_PER_EVENT . ' sarjaa.';
        }
        if ($this->polls->countForEvent($eventId) + $pollCount > PollRepository::MAX_PER_EVENT) {
            $errors[] = 'Luennolla voi olla enintään ' . PollRepository::MAX_PER_EVENT . ' kysymystä.';
        }
        $summary = [
            'sets' => array_map(static fn (array $s): array => ['slug' => $s['slug'], 'title' => $s['title'], 'questions' => count($s['polls'])], $parsed['sets']),
            'questions' => $pollCount,
            'warnings' => $parsed['warnings'],
            'errors' => $errors,
        ];
        if ($errors !== []) {
            return Response::json(['error' => 'Tiedostoa ei voi tuoda.'] + $summary, 422);
        }
        if (($in['dry_run'] ?? false) === true) {
            return Response::json($summary);
        }
        try {
            $this->sets->import($eventId, $parsed['sets'], $this->polls);
        } catch (\RuntimeException $e) {
            return Response::error('Tuonti epäonnistui: ' . $e->getMessage(), 409);
        }
        $this->audit->record('sets_imported', $client, (string) $event['code'] . ': ' . count($parsed['sets']) . ' sarjaa, ' . $pollCount . ' kysymystä');
        $state = json_decode($this->pollsState($event)->body, true);
        return Response::json(['import' => $summary] + (is_array($state) ? $state : []), 201);
    }

    /**
     * Vie luennon sarjat (tai yhden sarjan, ?set=id) JSONina tuontimuodossa.
     * @param array<string, mixed> $event
     */
    private function export(array $event, mixed $setParam): Response
    {
        $eventId = (int) $event['id'];
        $sets = $this->sets->forEvent($eventId);
        if (is_string($setParam) && $setParam !== '') {
            $sets = array_values(array_filter($sets, static fn (array $s): bool => (string) $s['id'] === $setParam));
            if ($sets === []) {
                return Response::error('Sarjaa ei löytynyt.', 404);
            }
        }
        return Response::json(SetFormat::export((string) $event['title'], $sets, $this->polls->forEvent($eventId)));
    }

    /** @param array<string, mixed> $in */
    private function setAction(int $id, string $action, array $in, string $client): Response
    {
        $set = $this->sets->find($id);
        $event = $set === null ? null : $this->events->find((int) $set['event_id']);
        if ($set === null || $event === null) {
            return Response::error('Sarjaa ei löytynyt.', 404);
        }
        switch ($action) {
            case 'update':
                $slug = SetRepository::cleanSlug($in['slug'] ?? null);
                $title = SetRepository::cleanTitle($in['title'] ?? null);
                if ($slug === null || $title === null) {
                    return Response::error('Tunniste 1–16 merkkiä (A–Z, 0–9, - tai _) ja nimi 1–' . SetRepository::TITLE_MAX . ' merkkiä.', 422);
                }
                $error = $this->sets->update($id, $slug, $title);
                if ($error !== null) {
                    return Response::error($error, 409);
                }
                break;
            case 'move':
                $dir = $in['dir'] ?? null;
                if (!is_int($dir) || !$this->sets->move($id, $dir)) {
                    return Response::error('Sarjaa ei voi siirtää.', 409);
                }
                break;
            case 'duplicate':
                $copy = $this->sets->duplicate($id, $this->polls);
                if (is_string($copy)) {
                    return Response::error($copy, 409);
                }
                break;
            case 'skip':
                if (!is_bool($in['skipped'] ?? null)) {
                    return Response::error('Virheellinen arvo.', 422);
                }
                $this->sets->setSkipped($id, $in['skipped']);
                break;
            default: // delete
                $this->live->forgetSet((int) $event['id'], $id);
                $this->sets->delete($id);
                $this->audit->record('set_deleted', $client, (string) $event['code'] . '/' . (string) $set['slug']);
        }
        return $this->pollsState($event);
    }

    /**
     * @param array<string, mixed> $event
     * @return array<string, mixed>
     */
    private function eventOut(array $event): array
    {
        return [
            'id' => (int) ($event['id'] ?? 0),
            'code' => (string) ($event['code'] ?? ''),
            'title' => (string) ($event['title'] ?? ''),
            'status' => (string) ($event['status'] ?? ''),
            'open' => $this->events->isOpen($event),
            'created_at' => (int) ($event['created_at'] ?? 0),
            'closes_at' => isset($event['closes_at']) ? (int) $event['closes_at'] : null,
            'question_count' => (int) ($event['question_count'] ?? 0),
            'new_count' => (int) ($event['new_count'] ?? 0),
            'url' => $this->config->publicOrigin . $this->config->url('/k/' . (string) ($event['code'] ?? '')),
            'lang' => is_string($event['lang'] ?? null) ? $event['lang'] : null,
        ];
    }

    private function sameOrigin(Request $req): bool
    {
        $origin = $req->header('origin');
        $site = $req->header('sec-fetch-site');
        if ($site !== null && $site !== 'same-origin') {
            return false;
        }
        return $origin !== null && hash_equals($this->config->publicOrigin, $origin);
    }
}
