<?php

declare(strict_types=1);

namespace HessuTalks\Auth;

/**
 * Ohut rajapinta WebAuthn-kirjaston ympärille, jotta autentikointilogiikka
 * (haasteet, istunnot, rate limit) voidaan testata ilman oikeaa autentikaattoria.
 */
interface WebAuthnAdapter
{
    /**
     * @param list<string> $excludeCredentialIds binäärisiä
     * @return array{options: array<string, mixed>, challenge: string}
     */
    public function createArgs(string $userId, string $userName, string $displayName, array $excludeCredentialIds): array;

    /**
     * @param list<string> $credentialIds binäärisiä
     * @return array{options: array<string, mixed>, challenge: string}
     */
    public function getArgs(array $credentialIds): array;

    /**
     * @return array{credentialId: string, publicKeyPem: string, signCount: int}
     * @throws \RuntimeException jos varmennus epäonnistuu
     */
    public function processCreate(string $clientDataJson, string $attestationObject, string $challenge): array;

    /**
     * @return int uusi allekirjoituslaskuri
     * @throws \RuntimeException jos varmennus epäonnistuu
     */
    public function processGet(
        string $clientDataJson,
        string $authenticatorData,
        string $signature,
        string $publicKeyPem,
        string $challenge,
        int $prevSignCount,
    ): int;
}
