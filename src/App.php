<?php

declare(strict_types=1);

namespace HessuTalks;

use HessuTalks\Auth\AdminAuth;
use HessuTalks\Auth\WebAuthnAdapter;
use HessuTalks\Controller\AdminController;
use HessuTalks\Controller\ParticipantController;
use HessuTalks\Http\Request;
use HessuTalks\Http\Response;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\NicknameRepository;
use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\QuestionRepository;
use HessuTalks\Security\AuditLog;
use HessuTalks\Security\ClientId;
use HessuTalks\Security\Clock;
use HessuTalks\Security\FormToken;
use HessuTalks\Security\RateLimiter;
use HessuTalks\Security\SecurityHeaders;
use HessuTalks\Security\Session;

final class App
{
    private ParticipantController $participant;
    private AdminController $admin;
    private ?\Closure $errorLogger = null;

    public function __construct(
        private readonly Config $config,
        private readonly Database $db,
        private readonly Session $session,
        WebAuthnAdapter $webauthn,
        private readonly Clock $clock,
        string $appRoot,
    ) {
        $view = new View($appRoot . '/templates', $config, self::assetVersion($appRoot));
        $events = new EventRepository($db, $clock);
        $questions = new QuestionRepository($db, $clock);
        $keys = new KeyRepository($db, $clock);
        $passkeys = new PasskeyRepository($db, $clock);
        $limiter = new RateLimiter($db, $clock);
        $audit = new AuditLog($db, $clock);
        $clientId = new ClientId($config->appSecret);
        $auth = new AdminAuth($config, $session, $webauthn, $passkeys, $limiter, $audit, $clock);

        $nicknames = new NicknameRepository($db, $clock, $config->appSecret);
        $polls = new PollRepository($db, $clock, $config->appSecret);
        $this->participant = new ParticipantController(
            $config, $view, $events, $questions, $nicknames, $polls, $keys, $limiter, new FormToken($config->appSecret, $clock),
        );
        $this->admin = new AdminController($config, $view, $auth, $events, $questions, $polls, $keys, $passkeys, $audit, $clientId);
    }

    public function onError(\Closure $logger): void
    {
        $this->errorLogger = $logger;
    }

    public function handle(Request $req): Response
    {
        try {
            $response = $this->dispatch($req);
        } catch (\Throwable $e) {
            if ($this->errorLogger !== null) {
                ($this->errorLogger)($e);
            }
            // Ei yksityiskohtia käyttäjälle.
            $response = str_starts_with($req->path, '/api/') || str_starts_with($req->path, '/admin/api/')
                ? Response::error('Palvelinvirhe.', 500)
                : Response::html('<!doctype html><meta charset="utf-8"><title>Virhe</title><p>Palvelinvirhe.</p>', 500);
        }
        return SecurityHeaders::apply($response, str_starts_with($this->config->publicOrigin, 'https://'));
    }

    private function dispatch(Request $req): Response
    {
        $path = $req->path;
        if (strlen($path) > 200 || str_contains($path, "\0")) {
            return Response::error('Virheellinen polku.', 400);
        }

        if (str_starts_with($path, '/admin')) {
            $this->session->start();
            if ($path === '/admin' || $path === '/admin/') {
                return $req->method === 'GET' ? $this->admin->page() : Response::error('Metodia ei tueta.', 405);
            }
            if ($path === '/admin/esitys') {
                return $req->method === 'GET' ? $this->admin->presenter() : Response::error('Metodia ei tueta.', 405);
            }
            if (str_starts_with($path, '/admin/api/')) {
                $route = substr($path, strlen('/admin/api/'));
                if (preg_match('#^[a-z0-9/_-]{1,64}$#', $route) !== 1) {
                    return Response::error('Ei löytynyt.', 404);
                }
                return $this->admin->api($req, $route);
            }
            return Response::error('Ei löytynyt.', 404);
        }

        if ($path === '/' && $req->method === 'GET') {
            return $this->participant->home($req);
        }
        if ($path === '/tietosuoja' && $req->method === 'GET') {
            return $this->participant->privacy($req);
        }
        if (preg_match('#^/k/([A-Za-z0-9-]{1,12})/?$#', $path, $m) === 1 && $req->method === 'GET') {
            return $this->participant->event($m[1], $req);
        }
        if ($path === '/api/questions') {
            return $req->method === 'POST' ? $this->participant->submit($req) : Response::error('Metodia ei tueta.', 405);
        }
        if ($path === '/api/polls') {
            return $req->method === 'GET' ? $this->participant->polls($req) : Response::error('Metodia ei tueta.', 405);
        }
        if ($path === '/api/polls/answer') {
            return $req->method === 'POST' ? $this->participant->answerPoll($req) : Response::error('Metodia ei tueta.', 405);
        }
        if ($path === '/api/nickname') {
            return $req->method === 'POST' ? $this->participant->claimNickname($req) : Response::error('Metodia ei tueta.', 405);
        }
        if ($path === '/healthz' && $req->method === 'GET') {
            $this->db->one('SELECT 1');
            return Response::json(['ok' => true, 'time' => $this->clock->now()]);
        }

        return Response::html(
            '<!doctype html><meta charset="utf-8"><title>Ei löytynyt</title><p>Sivua ei löytynyt.</p>',
            404,
        );
    }

    private static function assetVersion(string $appRoot): string
    {
        $file = $appRoot . '/VERSION';
        if (is_file($file)) {
            return trim((string) file_get_contents($file));
        }
        // Kehityksessä ei ole VERSION-tiedostoa (CI kirjoittaa sen). Versio lasketaan resurssien
        // muokkausajoista, jotta selaimen välimuisti (immutable) ei tarjoa vanhaa JS:ää tai CSS:ää.
        $mtime = 0;
        foreach (['css', 'js'] as $dir) {
            $assets = glob($appRoot . '/public/assets/' . $dir . '/*');
            foreach ($assets === false ? [] : $assets as $asset) {
                $mtime = max($mtime, (int) filemtime($asset));
            }
        }
        return 'dev-' . $mtime;
    }
}
