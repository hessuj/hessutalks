<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Security\SecurityHeaders;
use HessuTalks\Tests\Support\AppTestCase;

/**
 * Hallintarajapinnan tietoturvatestit: pääsynhallinta, CSRF, passkey-käyttöönotto,
 * haasteiden kertakäyttöisyys, istuntojen aikakatkaisut ja turvaotsakkeet.
 */
final class AdminSecurityTest extends AppTestCase
{
    private static function b64u(string $s): string
    {
        return PasskeyRepository::b64urlEncode($s);
    }

    private function clientData(string $origin = self::ORIGIN): string
    {
        return self::b64u((string) json_encode(['type' => 'webauthn.get', 'origin' => $origin, 'challenge' => 'x']));
    }

    // ------------------------------------------------------------ pääsynhallinta

    /** @return iterable<array{string, string}> */
    public static function protectedRoutes(): iterable
    {
        yield ['GET', '/admin/api/state'];
        yield ['GET', '/admin/api/events'];
        yield ['GET', '/admin/api/events/1/questions'];
        yield ['GET', '/admin/api/audit'];
        yield ['POST', '/admin/api/events'];
        yield ['POST', '/admin/api/events/1/status'];
        yield ['POST', '/admin/api/events/1/delete'];
        yield ['POST', '/admin/api/questions/1/status'];
        yield ['POST', '/admin/api/questions/1/delete'];
        yield ['POST', '/admin/api/keys'];
        yield ['POST', '/admin/api/keys/rewrap'];
        yield ['POST', '/admin/api/passkeys/1/delete'];
        yield ['POST', '/admin/api/passkeys/1/prf'];
        yield ['POST', '/admin/api/passkeys/1/prf-delete'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('protectedRoutes')]
    public function testProtectedRoutesRequireLogin(string $method, string $path): void
    {
        $this->createEvent();
        // Kirjautumaton käyttäjä, jolla on voimassa oleva CSRF-token (sivu ladattu).
        $this->session->start();
        $this->session->set('csrf', str_repeat('c', 64));
        $r = $this->request($method, $path, $method === 'POST' ? ['title' => 'x'] : null, ['X-CSRF-Token' => str_repeat('c', 64)]);
        self::assertSame(401, $r->status, $path);
        self::assertStringNotContainsString('ciphertext', $r->body);
    }

    public function testPostWithoutCsrfTokenIsRejected(): void
    {
        $csrf = $this->loginAdmin();
        self::assertSame(403, $this->request('POST', '/admin/api/events', ['title' => 'x'])->status);
        self::assertSame(403, $this->request('POST', '/admin/api/events', ['title' => 'x'], ['X-CSRF-Token' => strrev($csrf)])->status);
        self::assertSame(403, $this->request('POST', '/admin/api/events', ['title' => 'x'], ['X-CSRF-Token' => $csrf, 'Origin' => 'https://evil.example'])->status);
        self::assertSame(201, $this->request('POST', '/admin/api/events', ['title' => 'x'], ['X-CSRF-Token' => $csrf])->status);
    }

    public function testAuthenticatedAdminCanReadCiphertexts(): void
    {
        $this->createKeys();
        $event = $this->createEvent();
        $token = $this->formToken((string) $event['code']);
        $claim = $this->claim((string) $event['code'], $token, 'Lukija');
        $this->request('POST', '/api/questions', [
            'code' => $event['code'], 'token' => $token, 'nickname' => 'Lukija', 'secret' => $claim['secret'],
            'ciphertext' => $this->seal('{"t":"hei"}'),
        ]);
        $this->loginAdmin();
        $r = $this->request('GET', '/admin/api/events/' . (int) $event['id'] . '/questions');
        self::assertSame(200, $r->status);
        $q = $this->json($r)['questions'][0] ?? null;
        self::assertIsArray($q);
        self::assertSame('{"t":"hei"}', sodium_crypto_box_seal_open((string) base64_decode((string) $q['ciphertext'], true), $this->keypair));
    }

    // ------------------------------------------------------------ istunto

    public function testIdleAndAbsoluteTimeouts(): void
    {
        $this->loginAdmin();
        self::assertSame(200, $this->request('GET', '/admin/api/state')->status);
        $this->clock->advance($this->config->adminIdleTimeout + 1);
        self::assertSame(401, $this->request('GET', '/admin/api/state')->status, 'Toimettomuus');

        $this->loginAdmin();
        for ($t = 0; $t < $this->config->adminAbsoluteTimeout; $t += 1200) {
            $this->clock->advance(1200);
            $this->request('GET', '/admin/api/state');
        }
        $this->clock->advance(1200);
        self::assertSame(401, $this->request('GET', '/admin/api/state')->status, 'Absoluuttinen aikaraja');
    }

    public function testLogoutDestroysSession(): void
    {
        $csrf = $this->loginAdmin();
        self::assertSame(200, $this->request('POST', '/admin/api/logout', [], ['X-CSRF-Token' => $csrf])->status);
        self::assertSame(401, $this->request('GET', '/admin/api/state')->status);
    }

    // ------------------------------------------------------------ käyttöönotto

    private function pageCsrf(): string
    {
        $r = $this->request('GET', '/admin');
        self::assertSame(1, preg_match('/data-csrf="([a-f0-9]{64})"/', $r->body, $m));
        return $m[1];
    }

    public function testSetupRequiresCorrectTokenAndIsRateLimited(): void
    {
        $csrf = $this->pageCsrf();
        $h = ['X-CSRF-Token' => $csrf];
        self::assertSame(403, $this->request('POST', '/admin/api/passkey/register-options', [], $h)->status, 'Ilman tokenia ei rekisteröintiä');
        for ($i = 0; $i < 5; $i++) {
            self::assertSame(403, $this->request('POST', '/admin/api/setup/token', ['token' => 'väärä'], $h)->status);
        }
        // Oikeakin token hylätään, kun yrityksiä on liikaa.
        self::assertSame(403, $this->request('POST', '/admin/api/setup/token', ['token' => self::SETUP_TOKEN], $h)->status);
        $this->clock->advance(901);
        self::assertSame(200, $this->request('POST', '/admin/api/setup/token', ['token' => self::SETUP_TOKEN], $h)->status);
    }

    public function testFullSetupFlowLogsInAndDisablesSetup(): void
    {
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        self::assertSame(200, $this->request('POST', '/admin/api/setup/token', ['token' => self::SETUP_TOKEN], $h)->status);
        self::assertSame(200, $this->request('POST', '/admin/api/passkey/register-options', [], $h)->status);
        $r = $this->request('POST', '/admin/api/passkey/register', [
            'clientDataJSON' => $this->clientData(), 'attestationObject' => self::b64u('good'), 'name' => 'Mac',
        ], $h);
        self::assertSame(200, $r->status, $r->body);
        self::assertGreaterThan(0, $this->session->regenerations, 'Istuntotunniste vaihdetaan');
        $newCsrf = (string) ($this->json($r)['csrf'] ?? '');
        self::assertNotSame($h['X-CSRF-Token'], $newCsrf, 'CSRF-token vaihdetaan kirjautuessa');
        self::assertSame(200, $this->request('GET', '/admin/api/state')->status);

        // Kun passkey on olemassa, setup-tokenilla ei saa uutta pääsyä.
        $this->session->destroy();
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        self::assertSame(403, $this->request('POST', '/admin/api/setup/token', ['token' => self::SETUP_TOKEN], $h)->status);
        self::assertSame(403, $this->request('POST', '/admin/api/passkey/register-options', [], $h)->status);
    }

    public function testRegistrationWithWrongOriginFails(): void
    {
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        $this->request('POST', '/admin/api/setup/token', ['token' => self::SETUP_TOKEN], $h);
        $this->request('POST', '/admin/api/passkey/register-options', [], $h);
        $r = $this->request('POST', '/admin/api/passkey/register', [
            'clientDataJSON' => $this->clientData('https://evil.hessutalks.test'), 'attestationObject' => self::b64u('good'),
        ], $h);
        self::assertSame(400, $r->status);
    }

    // ------------------------------------------------------------ kirjautuminen

    /** @return array<string, mixed> */
    private function assertion(string $signature = 'good', string $origin = self::ORIGIN): array
    {
        return [
            'id' => self::b64u('cred-1'),
            'clientDataJSON' => $this->clientData($origin),
            'authenticatorData' => self::b64u('auth'),
            'signature' => self::b64u($signature),
            'userHandle' => self::b64u('hessutalks-admin'),
        ];
    }

    public function testLoginChallengeIsSingleUse(): void
    {
        (new PasskeyRepository($this->db, $this->clock))->add('cred-1', 'PEM', 0, 'Testi');
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        self::assertSame(200, $this->request('POST', '/admin/api/login/options', [], $h)->status);
        $r = $this->request('POST', '/admin/api/login', $this->assertion(), $h);
        self::assertSame(200, $r->status, $r->body);
        $h = ['X-CSRF-Token' => (string) $this->json($r)['csrf']];

        $this->session->remove('admin_auth_at');
        self::assertSame(401, $this->request('POST', '/admin/api/login', $this->assertion(), $h)->status, 'Haastetta ei voi käyttää uudelleen');
    }

    public function testLoginFailures(): void
    {
        (new PasskeyRepository($this->db, $this->clock))->add('cred-1', 'PEM', 0, 'Testi');
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        $cases = [
            'väärä allekirjoitus' => $this->assertion('bad'),
            'väärä origin' => $this->assertion('good', 'https://evil.example'),
            'tuntematon avain' => ['id' => self::b64u('cred-x')] + $this->assertion(),
            'väärä käyttäjä' => ['userHandle' => self::b64u('joku-muu')] + $this->assertion(),
        ];
        foreach ($cases as $name => $assertion) {
            $this->request('POST', '/admin/api/login/options', [], $h);
            self::assertSame(401, $this->request('POST', '/admin/api/login', $assertion, $h)->status, $name);
        }
        // Vanhentunut haaste
        $this->request('POST', '/admin/api/login/options', [], $h);
        $this->clock->advance(181);
        self::assertSame(401, $this->request('POST', '/admin/api/login', $this->assertion(), $h)->status, 'vanhentunut haaste');

        $fails = $this->db->one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'login_fail'");
        self::assertSame(5, (int) ($fails['n'] ?? 0), 'Epäonnistumiset kirjataan');
    }

    public function testLoginIsRateLimited(): void
    {
        (new PasskeyRepository($this->db, $this->clock))->add('cred-1', 'PEM', 0, 'Testi');
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        for ($i = 0; $i < 10; $i++) {
            $this->request('POST', '/admin/api/login/options', [], $h);
            $this->request('POST', '/admin/api/login', $this->assertion('bad'), $h);
        }
        $this->request('POST', '/admin/api/login/options', [], $h);
        self::assertSame(401, $this->request('POST', '/admin/api/login', $this->assertion(), $h)->status, 'Oikeakin yritys estetään hetkeksi');
    }

    public function testLastPasskeyCannotBeDeleted(): void
    {
        $csrf = $this->loginAdmin();
        self::assertSame(409, $this->request('POST', '/admin/api/passkeys/1/delete', [], ['X-CSRF-Token' => $csrf])->status);
    }

    // ------------------------------------------------------------ avaus passkeylla (PRF)

    /** Kirjautuu oikean kirjautumisvirran läpi passkeylla cred-1 ja palauttaa vastauksen. */
    private function passkeyLogin(): array
    {
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        $opts = $this->json($this->request('POST', '/admin/api/login/options', [], $h));
        $r = $this->request('POST', '/admin/api/login', $this->assertion(), $h);
        self::assertSame(200, $r->status, $r->body);
        return ['options' => $opts] + $this->json($r);
    }

    /** @return array{public_key: string, enc_secret_key: string, nonce: string} */
    private function prfWrap(): array
    {
        return [
            'public_key' => base64_encode(sodium_crypto_box_publickey($this->keypair)),
            'enc_secret_key' => base64_encode(random_bytes(48)),
            'nonce' => base64_encode(random_bytes(24)),
        ];
    }

    public function testLoginOptionsContainStablePrfSalt(): void
    {
        $repo = new PasskeyRepository($this->db, $this->clock);
        $repo->add('cred-1', 'PEM', 0, 'MacBook');
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        $first = $this->json($this->request('POST', '/admin/api/login/options', [], $h))['prfSalt'] ?? null;
        $repo->add('cred-2', 'PEM', 0, 'iPhone');
        $second = $this->json($this->request('POST', '/admin/api/login/options', [], $h))['prfSalt'] ?? null;

        self::assertIsString($first);
        self::assertSame(32, strlen((string) PasskeyRepository::b64urlDecode($first)), 'Suola on 32 tavua');
        self::assertSame($first, $second, 'Suola pysyy samana (myös uuden passkeyn jälkeen), muuten PRF-arvo muuttuisi');
        self::assertStringNotContainsString(bin2hex((string) PasskeyRepository::b64urlDecode($first)), $this->config->appSecret);
    }

    public function testPrfWrapRoundTripThroughLogin(): void
    {
        $this->createKeys();
        (new PasskeyRepository($this->db, $this->clock))->add('cred-1', 'PEM', 0, 'MacBook');
        $login = $this->passkeyLogin();
        self::assertSame(1, $login['passkey']);
        self::assertNull($login['prf'], 'Ei kopiota ennen käyttöönottoa');

        $wrap = $this->prfWrap();
        $r = $this->request('POST', '/admin/api/passkeys/1/prf', $wrap, ['X-CSRF-Token' => (string) $login['csrf']]);
        self::assertSame(200, $r->status, $r->body);
        $state = $this->json($this->request('GET', '/admin/api/state'));
        self::assertTrue($state['passkeys'][0]['prf']);
        self::assertSame(1, $state['passkey']);

        $this->session->destroy();
        $again = $this->passkeyLogin();
        self::assertSame(['enc_secret_key' => $wrap['enc_secret_key'], 'nonce' => $wrap['nonce']], $again['prf']);
        $audit = $this->db->one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'prf_unlock_enabled'");
        self::assertSame(1, (int) ($audit['n'] ?? 0));
    }

    public function testPrfWrapIsNotRevealedWithoutSuccessfulLogin(): void
    {
        $repo = new PasskeyRepository($this->db, $this->clock);
        $repo->add('cred-1', 'PEM', 0, 'MacBook');
        $repo->setPrfWrap(1, base64_encode(random_bytes(48)), base64_encode(random_bytes(24)));
        $h = ['X-CSRF-Token' => $this->pageCsrf()];
        $opts = $this->request('POST', '/admin/api/login/options', [], $h);
        self::assertStringNotContainsString('enc_secret_key', $opts->body);
        $r = $this->request('POST', '/admin/api/login', $this->assertion('bad'), $h);
        self::assertSame(401, $r->status);
        self::assertStringNotContainsString('enc_secret_key', $r->body);
    }

    public function testPrfWrapOnlyForTheSessionsOwnPasskey(): void
    {
        $this->createKeys();
        $repo = new PasskeyRepository($this->db, $this->clock);
        $repo->add('cred-1', 'PEM', 0, 'MacBook');
        $repo->add('cred-2', 'PEM', 0, 'iPhone');
        $login = $this->passkeyLogin();
        $h = ['X-CSRF-Token' => (string) $login['csrf']];
        self::assertSame(403, $this->request('POST', '/admin/api/passkeys/2/prf', $this->prfWrap(), $h)->status, 'Toisen passkeyn kopio');

        // Istunto ilman passkeyta (esim. käyttöönotto) ei voi tallentaa kopiota millekään passkeylle.
        $this->session->destroy();
        $csrf = $this->loginAdmin();
        self::assertSame(403, $this->request('POST', '/admin/api/passkeys/1/prf', $this->prfWrap(), ['X-CSRF-Token' => $csrf])->status);
    }

    public function testPrfWrapIsValidated(): void
    {
        $this->createKeys();
        (new PasskeyRepository($this->db, $this->clock))->add('cred-1', 'PEM', 0, 'MacBook');
        $h = ['X-CSRF-Token' => (string) $this->passkeyLogin()['csrf']];
        $cases = [
            'liian lyhyt' => ['enc_secret_key' => base64_encode(random_bytes(32))] + $this->prfWrap(),
            'väärä nonce' => ['nonce' => base64_encode(random_bytes(12))] + $this->prfWrap(),
            'ei base64' => ['enc_secret_key' => '<script>'] + $this->prfWrap(),
        ];
        foreach ($cases as $name => $body) {
            self::assertSame(422, $this->request('POST', '/admin/api/passkeys/1/prf', $body, $h)->status, $name);
        }
        $other = ['public_key' => base64_encode(random_bytes(32))] + $this->prfWrap();
        self::assertSame(409, $this->request('POST', '/admin/api/passkeys/1/prf', $other, $h)->status, 'Väärän avainparin kopio');
        self::assertNull((new PasskeyRepository($this->db, $this->clock))->prfWrap(1));
    }

    public function testPrfWrapCanBeRemovedAndIsDeletedWithPasskey(): void
    {
        $this->createKeys();
        $repo = new PasskeyRepository($this->db, $this->clock);
        $repo->add('cred-1', 'PEM', 0, 'MacBook');
        $repo->add('cred-2', 'PEM', 0, 'iPhone');
        $h = ['X-CSRF-Token' => (string) $this->passkeyLogin()['csrf']];
        $this->request('POST', '/admin/api/passkeys/1/prf', $this->prfWrap(), $h);
        self::assertSame(200, $this->request('POST', '/admin/api/passkeys/1/prf-delete', [], $h)->status);
        self::assertNull($repo->prfWrap(1));

        $this->request('POST', '/admin/api/passkeys/1/prf', $this->prfWrap(), $h);
        self::assertSame(200, $this->request('POST', '/admin/api/passkeys/1/delete', [], $h)->status);
        self::assertNull($this->db->one('SELECT id FROM passkeys WHERE prf_enc_secret_key IS NOT NULL'), 'Kopio poistuu passkeyn mukana');
    }

    public function testKeysCannotBeReplaced(): void
    {
        $this->createKeys();
        $csrf = $this->loginAdmin();
        $r = $this->request('POST', '/admin/api/keys', [
            'public_key' => base64_encode(random_bytes(32)), 'enc_secret_key' => base64_encode(random_bytes(48)),
            'nonce' => base64_encode(random_bytes(24)), 'salt' => base64_encode(random_bytes(16)),
            'opslimit' => 3, 'memlimit' => 67108864,
        ], ['X-CSRF-Token' => $csrf]);
        self::assertSame(409, $r->status);
    }

    // ------------------------------------------------------------ esitysnäyttö (projektori)

    public function testPresenterPageRequiresLogin(): void
    {
        $r = $this->request('GET', '/admin/esitys');
        self::assertSame(401, $r->status);
        self::assertStringNotContainsString('presenter.js', $r->body);
        self::assertSame(405, $this->request('POST', '/admin/esitys', [])->status);
    }

    public function testPresenterPageHasNoKeysDataOrAdminUi(): void
    {
        $this->createKeys();
        $this->createEvent();
        $csrf = $this->loginAdmin();
        $r = $this->request('GET', '/admin/esitys');
        self::assertSame(200, $r->status);
        self::assertStringContainsString('js/presenter.js', $r->body);
        // Esitysikkuna ei pura viestejä: ei salauskirjastoa, ei hallinnan skriptiä, CSRF-tokenia eikä dataa.
        self::assertStringNotContainsString('sodium', $r->body);
        self::assertStringNotContainsString('admin.js', $r->body);
        self::assertStringNotContainsString($csrf, $r->body);
        self::assertStringNotContainsString('Testiluento', $r->body);
        self::assertStringNotContainsString('topbar', $r->body);
        self::assertStringStartsWith(SecurityHeaders::CSP, $r->headers['Content-Security-Policy'] ?? '');
        self::assertSame('DENY', $r->headers['X-Frame-Options'] ?? null);
    }

    public function testPresenterScriptAcceptsOnlyOpenerMessagesAndUsesTextContent(): void
    {
        $js = (string) file_get_contents(dirname(__DIR__, 2) . '/public/assets/js/presenter.js');
        self::assertStringContainsString('ev.origin !== window.location.origin', $js);
        self::assertStringContainsString('ev.source !== window.opener', $js);
        self::assertSame(0, preg_match('/\\.(innerHTML|outerHTML)\\b|insertAdjacentHTML|document\\.write/', $js));
        self::assertStringNotContainsString('sodium', $js);
        // Hallinta lähettää viestit vain omaan originiinsa, ei koskaan '*'.
        $admin = (string) file_get_contents(dirname(__DIR__, 2) . '/public/assets/js/admin.js');
        self::assertStringNotContainsString("postMessage(msg, '*')", $admin);
        self::assertSame(0, preg_match('/postMessage\([^)]*[\'"]\*[\'"]/', $admin . $js));
    }

    // ------------------------------------------------------------ turvaotsakkeet

    public function testSecurityHeadersOnEveryResponse(): void
    {
        $this->createKeys();
        $code = (string) $this->createEvent()['code'];
        $responses = [
            $this->request('GET', '/'),
            $this->request('GET', '/k/' . $code),
            $this->request('GET', '/admin'),
            $this->request('GET', '/admin/api/state'),
            $this->request('GET', '/admin/esitys'),
            $this->request('GET', '/olematon'),
            $this->request('POST', '/api/questions', []),
        ];
        foreach ($responses as $r) {
            self::assertStringStartsWith(SecurityHeaders::CSP, $r->headers['Content-Security-Policy'] ?? '');
            self::assertSame('nosniff', $r->headers['X-Content-Type-Options'] ?? null);
            self::assertSame('DENY', $r->headers['X-Frame-Options'] ?? null);
            self::assertSame('no-referrer', $r->headers['Referrer-Policy'] ?? null);
            self::assertStringContainsString('max-age=31536000', $r->headers['Strict-Transport-Security'] ?? '');
            self::assertSame('no-store, max-age=0', $r->headers['Cache-Control'] ?? null);
        }
        self::assertStringNotContainsString("'unsafe-inline'", SecurityHeaders::CSP);
        self::assertStringNotContainsString("'unsafe-eval'", SecurityHeaders::CSP);
    }

    public function testErrorsDoNotLeakDetails(): void
    {
        $this->db->pdo()->exec('DROP TABLE events');
        $r = $this->request('GET', '/k/ABC234');
        self::assertSame(500, $r->status);
        self::assertStringNotContainsString('SQLSTATE', $r->body);
        self::assertStringNotContainsString('events', $r->body);
    }

    public function testTemplatesContainNoInlineScripts(): void
    {
        foreach (glob(dirname(__DIR__, 2) . '/templates/*.php') ?: [] as $file) {
            $src = (string) file_get_contents($file);
            self::assertSame(0, preg_match('/<script(?![^>]*\bsrc=)/i', $src), basename($file) . ' sisältää inline-skriptin');
            self::assertSame(0, preg_match('/\son[a-z]+\s*=/i', $src), basename($file) . ' sisältää inline-tapahtumankäsittelijän');
        }
    }
}
