<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Support;

use HessuTalks\Auth\WebAuthnAdapter;

/**
 * Testikaksonen: hyväksyy rekisteröinnin, kun attestationObject === 'good',
 * ja kirjautumisen, kun signature === 'good'. Haasteiden ja istuntojen logiikka
 * testataan AdminAuthissa oikeana koodina.
 */
final class FakeWebAuthn implements WebAuthnAdapter
{
    public int $challengeCounter = 0;

    public function createArgs(string $userId, string $userName, string $displayName, array $excludeCredentialIds): array
    {
        $challenge = 'challenge-' . (++$this->challengeCounter);
        return ['options' => ['publicKey' => ['challenge' => $challenge]], 'challenge' => $challenge];
    }

    public function getArgs(array $credentialIds): array
    {
        $challenge = 'challenge-' . (++$this->challengeCounter);
        return ['options' => ['publicKey' => ['challenge' => $challenge]], 'challenge' => $challenge];
    }

    public function processCreate(string $clientDataJson, string $attestationObject, string $challenge): array
    {
        if ($attestationObject !== 'good') {
            throw new \RuntimeException('bad attestation');
        }
        return ['credentialId' => 'cred-1', 'publicKeyPem' => 'PEM', 'signCount' => 0];
    }

    public function processGet(
        string $clientDataJson,
        string $authenticatorData,
        string $signature,
        string $publicKeyPem,
        string $challenge,
        int $prevSignCount,
    ): int {
        if ($signature !== 'good') {
            throw new \RuntimeException('bad signature');
        }
        return $prevSignCount + 1;
    }
}
