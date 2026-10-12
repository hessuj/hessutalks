<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Support;

use HessuTalks\App;
use HessuTalks\Config;
use HessuTalks\Database;
use HessuTalks\Http\Request;
use HessuTalks\Http\Response;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Security\ArraySession;
use HessuTalks\Security\Clock;
use PHPUnit\Framework\TestCase;

abstract class AppTestCase extends TestCase
{
    protected const ORIGIN = 'https://hessutalks.test';
    protected const SETUP_TOKEN = 'TESTI-TOKEN-1234';

    protected Config $config;
    protected Database $db;
    protected ArraySession $session;
    protected Clock $clock;
    protected FakeWebAuthn $webauthn;
    protected App $app;
    /** @var string sealed box -avainpari (testin "ylläpitäjän selain") */
    protected string $keypair;

    protected function setUp(): void
    {
        $root = dirname(__DIR__, 2);
        $this->config = new Config(
            basePath: '/softa/hessutalks',
            publicOrigin: self::ORIGIN,
            rpId: 'hessutalks.test',
            dbPath: ':memory:',
            sessionPath: sys_get_temp_dir(),
            appSecret: str_repeat('ab', 32),
            setupTokenHash: password_hash(self::SETUP_TOKEN, PASSWORD_DEFAULT),
        );
        $this->db = new Database(':memory:', $root . '/migrations');
        $this->session = new ArraySession();
        $this->clock = new Clock();
        $this->clock->freeze(1_800_000_000);
        $this->webauthn = new FakeWebAuthn();
        $this->app = new App($this->config, $this->db, $this->session, $this->webauthn, $this->clock, $root);
        $this->keypair = sodium_crypto_box_keypair();
    }

    /**
     * @param array<string, mixed>|null $json
     * @param array<string, string> $headers
     */
    protected function request(string $method, string $path, ?array $json = null, array $headers = []): Response
    {
        $parts = explode('?', $path, 2);
        parse_str($parts[1] ?? '', $query);
        /** @var array<string, string> $query */
        $h = $method === 'POST'
            ? ['origin' => self::ORIGIN, 'content-type' => 'application/json', 'sec-fetch-site' => 'same-origin']
            : [];
        foreach ($headers as $k => $v) {
            $h[strtolower($k)] = $v;
        }
        $h = array_filter($h, static fn (string $v): bool => $v !== '');
        return $this->app->handle(new Request(
            $method,
            $parts[0],
            $query,
            $h,
            $json === null ? '' : (string) json_encode($json),
            '203.0.113.7',
        ));
    }

    /** @return array<string, mixed> */
    protected function json(Response $r): array
    {
        $d = json_decode($r->body, true);
        return is_array($d) ? $d : [];
    }

    protected function createKeys(): void
    {
        (new KeyRepository($this->db, $this->clock))->createOnce([
            'public_key' => base64_encode(sodium_crypto_box_publickey($this->keypair)),
            'enc_secret_key' => base64_encode(random_bytes(48)),
            'nonce' => base64_encode(random_bytes(24)),
            'salt' => base64_encode(random_bytes(16)),
            'opslimit' => 3,
            'memlimit' => 67108864,
        ]);
    }

    /** @return array<string, mixed> */
    protected function createEvent(string $title = 'Testiluento'): array
    {
        return (new EventRepository($this->db, $this->clock))->create($title, null);
    }

    protected function seal(string $plain): string
    {
        return base64_encode(sodium_crypto_box_seal($plain, sodium_crypto_box_publickey($this->keypair)));
    }

    /** Hakee osallistujasivulta lomaketokenin. */
    protected function formToken(string $code): string
    {
        $r = $this->request('GET', '/k/' . $code);
        self::assertSame(200, $r->status, $r->body);
        self::assertSame(1, preg_match('/data-token="([^"]+)"/', $r->body, $m));
        return html_entity_decode($m[1]);
    }

    /** @return array{nickname: string, secret: string} */
    protected function claim(string $code, string $token, string $nick): array
    {
        $r = $this->request('POST', '/api/nickname', ['code' => $code, 'token' => $token, 'nickname' => $nick]);
        self::assertSame(201, $r->status, $r->body);
        /** @var array{nickname: string, secret: string} */
        return $this->json($r);
    }

    /** Kirjaa ylläpitäjän sisään suoraan istuntoon ja palauttaa CSRF-tokenin. */
    protected function loginAdmin(): string
    {
        $passkeys = new PasskeyRepository($this->db, $this->clock);
        if ($passkeys->count() === 0) {
            $passkeys->add('cred-1', 'PEM', 0, 'Testi');
        }
        $this->session->start();
        $this->session->set('admin_auth_at', $this->clock->now());
        $this->session->set('admin_last_seen', $this->clock->now());
        $csrf = bin2hex(random_bytes(32));
        $this->session->set('csrf', $csrf);
        return $csrf;
    }
}
