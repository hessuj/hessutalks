<?php

declare(strict_types=1);

namespace HessuTalks\Controller;

use HessuTalks\Auth\AdminAuth;
use HessuTalks\Config;
use HessuTalks\Http\Request;
use HessuTalks\Http\Response;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Repository\QuestionRepository;
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
            'scripts' => ['vendor/sodium-sumo.js', 'vendor/qrcode.js', 'js/admin.js'],
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
        if (preg_match('#^events/(\d{1,10})/(questions|status|delete)$#', $route, $m) === 1) {
            return $this->eventAction($req, (int) $m[1], $m[2], $in, $client);
        }
        if (preg_match('#^questions/(\d{1,10})/(status|delete)$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->questionAction((int) $m[1], $m[2], $in);
        }
        if (preg_match('#^passkeys/(\d{1,10})/delete$#', $route, $m) === 1 && $req->method === 'POST') {
            return $this->passkeys->delete((int) $m[1])
                ? Response::json(['ok' => true])
                : Response::error('Viimeistä passkeyta ei voi poistaa.', 409);
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
        return $this->auth->completeLogin($in, $client)
            ? Response::json(['ok' => true, 'csrf' => $this->auth->csrfToken()])
            : Response::error('Kirjautuminen epäonnistui.', 401);
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
        try {
            $event = $this->events->create($title, $hours);
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
