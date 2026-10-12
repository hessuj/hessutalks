<?php

declare(strict_types=1);

namespace HessuTalks\Auth;

use HessuTalks\Config;
use HessuTalks\Http\Request;
use HessuTalks\Repository\PasskeyRepository;
use HessuTalks\Security\AuditLog;
use HessuTalks\Security\Clock;
use HessuTalks\Security\RateLimiter;
use HessuTalks\Security\Session;

/**
 * Ylläpitäjän tunnistus passkeylla (WebAuthn) ja istunnon hallinta.
 */
final class AdminAuth
{
    private const USER_ID = 'hessutalks-admin';
    private const CHALLENGE_TTL = 180;

    public function __construct(
        private readonly Config $config,
        private readonly Session $session,
        private readonly WebAuthnAdapter $webauthn,
        private readonly PasskeyRepository $passkeys,
        private readonly RateLimiter $limiter,
        private readonly AuditLog $audit,
        private readonly Clock $clock,
    ) {
    }

    // ---------------------------------------------------------------- istunto

    public function isAuthenticated(): bool
    {
        $authAt = $this->session->get('admin_auth_at');
        $lastSeen = $this->session->get('admin_last_seen');
        if (!is_int($authAt) || !is_int($lastSeen)) {
            return false;
        }
        $now = $this->clock->now();
        if ($now - $authAt > $this->config->adminAbsoluteTimeout || $now - $lastSeen > $this->config->adminIdleTimeout) {
            $this->logout();
            return false;
        }
        $this->session->set('admin_last_seen', $now);
        return true;
    }

    public function csrfToken(): string
    {
        $t = $this->session->get('csrf');
        if (!is_string($t) || strlen($t) !== 64) {
            $t = bin2hex(random_bytes(32));
            $this->session->set('csrf', $t);
        }
        return $t;
    }

    public function verifyCsrf(Request $req): bool
    {
        $expected = $this->session->get('csrf');
        $given = $req->header('x-csrf-token');
        return is_string($expected) && is_string($given) && hash_equals($expected, $given);
    }

    public function logout(): void
    {
        $this->session->destroy();
    }

    private function loginSession(string $client, string $how): void
    {
        $this->session->regenerate();
        $now = $this->clock->now();
        $this->session->remove('setup_verified');
        $this->session->remove('wa_challenge');
        $this->session->set('admin_auth_at', $now);
        $this->session->set('admin_last_seen', $now);
        $this->session->set('csrf', bin2hex(random_bytes(32)));
        $this->audit->record('login_ok', $client, $how);
    }

    // ---------------------------------------------------------------- käyttöönotto

    public function needsSetup(): bool
    {
        return $this->passkeys->count() === 0;
    }

    /** Ensimmäisen passkeyn rekisteröinti edellyttää kertakäyttöistä setup-tokenia asetuksista. */
    public function verifySetupToken(string $token, string $client): bool
    {
        if (!$this->needsSetup() || $this->config->setupTokenHash === '') {
            return false;
        }
        if (!$this->limiter->hit('setup|' . $client, 5, 900)) {
            $this->audit->record('setup_rate_limited', $client);
            return false;
        }
        if (!password_verify($token, $this->config->setupTokenHash)) {
            $this->audit->record('setup_token_fail', $client);
            return false;
        }
        $this->session->regenerate();
        $this->session->set('setup_verified', $this->clock->now());
        return true;
    }

    private function mayRegister(): bool
    {
        if ($this->isAuthenticated()) {
            return true;
        }
        $verified = $this->session->get('setup_verified');
        return $this->needsSetup() && is_int($verified) && $this->clock->now() - $verified < 600;
    }

    /** @return array<string, mixed>|null */
    public function registrationOptions(): ?array
    {
        if (!$this->mayRegister()) {
            return null;
        }
        $args = $this->webauthn->createArgs(self::USER_ID, 'admin', $this->config->adminName, $this->passkeys->allCredentialIds());
        $this->storeChallenge('register', $args['challenge']);
        return $args['options'];
    }

    /** @param array<string, mixed> $in */
    public function completeRegistration(array $in, string $client): bool
    {
        if (!$this->mayRegister()) {
            return false;
        }
        $challenge = $this->takeChallenge('register');
        $clientData = self::b64(($in['clientDataJSON'] ?? null));
        $attestation = self::b64(($in['attestationObject'] ?? null));
        if ($challenge === null || $clientData === null || $attestation === null || !$this->originMatches($clientData)) {
            $this->audit->record('register_fail', $client, 'invalid input');
            return false;
        }
        try {
            $res = $this->webauthn->processCreate($clientData, $attestation, $challenge);
        } catch (\RuntimeException $e) {
            $this->audit->record('register_fail', $client, $e->getMessage());
            return false;
        }
        $name = is_string($in['name'] ?? null) ? trim($in['name']) : '';
        $wasSetup = $this->needsSetup();
        $this->passkeys->add($res['credentialId'], $res['publicKeyPem'], $res['signCount'], $name !== '' ? $name : 'Passkey');
        $this->audit->record('passkey_added', $client, $name);
        if ($wasSetup) {
            $this->loginSession($client, 'setup');
        }
        return true;
    }

    // ---------------------------------------------------------------- kirjautuminen

    /** @return array<string, mixed>|null */
    public function loginOptions(string $client): ?array
    {
        if ($this->needsSetup() || !$this->limiter->hit('login_opt|' . $client, 30, 900)) {
            return null;
        }
        $args = $this->webauthn->getArgs($this->passkeys->allCredentialIds());
        $this->storeChallenge('login', $args['challenge']);
        return $args['options'];
    }

    /** @param array<string, mixed> $in */
    public function completeLogin(array $in, string $client): bool
    {
        if (!$this->limiter->hit('login|' . $client, 10, 900)) {
            $this->audit->record('login_rate_limited', $client);
            return false;
        }
        $challenge = $this->takeChallenge('login');
        $rawId = self::b64($in['id'] ?? null);
        $clientData = self::b64($in['clientDataJSON'] ?? null);
        $authData = self::b64($in['authenticatorData'] ?? null);
        $signature = self::b64($in['signature'] ?? null);
        if ($challenge === null || $rawId === null || $clientData === null || $authData === null || $signature === null) {
            $this->audit->record('login_fail', $client, 'invalid input');
            return false;
        }
        if (!$this->originMatches($clientData)) {
            $this->audit->record('login_fail', $client, 'origin');
            return false;
        }
        $userHandle = self::b64($in['userHandle'] ?? null);
        if ($userHandle !== null && $userHandle !== '' && !hash_equals(self::USER_ID, $userHandle)) {
            $this->audit->record('login_fail', $client, 'user handle');
            return false;
        }
        $pk = $this->passkeys->findByCredentialId($rawId);
        if ($pk === null) {
            $this->audit->record('login_fail', $client, 'unknown credential');
            return false;
        }
        try {
            $count = $this->webauthn->processGet($clientData, $authData, $signature, (string) $pk['public_key_pem'], $challenge, (int) $pk['sign_count']);
        } catch (\RuntimeException $e) {
            $this->audit->record('login_fail', $client, $e->getMessage());
            return false;
        }
        $this->passkeys->touch((int) $pk['id'], $count);
        $this->loginSession($client, 'passkey #' . (int) $pk['id']);
        return true;
    }

    // ---------------------------------------------------------------- apurit

    private function storeChallenge(string $purpose, string $challenge): void
    {
        $this->session->set('wa_challenge', [
            'purpose' => $purpose,
            'value' => base64_encode($challenge),
            'at' => $this->clock->now(),
        ]);
    }

    /** Haaste on kertakäyttöinen ja vanhenee. */
    private function takeChallenge(string $purpose): ?string
    {
        $c = $this->session->get('wa_challenge');
        $this->session->remove('wa_challenge');
        if (!is_array($c) || ($c['purpose'] ?? null) !== $purpose || !is_int($c['at'] ?? null) || !is_string($c['value'] ?? null)) {
            return null;
        }
        if ($this->clock->now() - $c['at'] > self::CHALLENGE_TTL) {
            return null;
        }
        $raw = base64_decode($c['value'], true);
        return $raw === false ? null : $raw;
    }

    /** Tarkka origin-vertailu (kirjaston oma tarkistus hyväksyy myös alidomainit). */
    private function originMatches(string $clientDataJson): bool
    {
        try {
            $cd = json_decode($clientDataJson, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }
        return is_array($cd) && ($cd['origin'] ?? null) === $this->config->publicOrigin;
    }

    private static function b64(mixed $v): ?string
    {
        return is_string($v) ? PasskeyRepository::b64urlDecode($v) : null;
    }
}
