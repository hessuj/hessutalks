<?php

declare(strict_types=1);

namespace HessuTalks\Auth;

use lbuchs\WebAuthn\Binary\ByteBuffer;
use lbuchs\WebAuthn\WebAuthn;
use lbuchs\WebAuthn\WebAuthnException;

final class LbuchsWebAuthn implements WebAuthnAdapter
{
    private const TIMEOUT = 120;

    private WebAuthn $wa;

    public function __construct(string $rpName, string $rpId)
    {
        // Pelkkä 'none'-attestaatio: emme tarvitse laitevalmistajan todistusta,
        // ja se on yhteensopiva iCloud-avainnipun ja Google Password Managerin passkeyjen kanssa.
        $this->wa = new WebAuthn($rpName, $rpId, ['none'], true);
    }

    public function createArgs(string $userId, string $userName, string $displayName, array $excludeCredentialIds): array
    {
        $args = $this->wa->getCreateArgs($userId, $userName, $displayName, self::TIMEOUT, 'required', 'required', null, $excludeCredentialIds);
        return ['options' => self::toArray($args), 'challenge' => $this->challenge()];
    }

    public function getArgs(array $credentialIds): array
    {
        $args = $this->wa->getGetArgs($credentialIds, self::TIMEOUT, true, true, true, true, true, 'required');
        return ['options' => self::toArray($args), 'challenge' => $this->challenge()];
    }

    public function processCreate(string $clientDataJson, string $attestationObject, string $challenge): array
    {
        try {
            $data = $this->wa->processCreate($clientDataJson, $attestationObject, $challenge, true, true, false);
        } catch (WebAuthnException $e) {
            throw new \RuntimeException('Rekisteröinti epäonnistui: ' . $e->getMessage(), 0, $e);
        }
        $credentialId = $data->credentialId;
        $pem = $data->credentialPublicKey;
        if (!is_string($credentialId) || !is_string($pem)) {
            throw new \RuntimeException('Rekisteröinti epäonnistui: puutteellinen vastaus.');
        }
        return [
            'credentialId' => $credentialId,
            'publicKeyPem' => $pem,
            'signCount' => (int) ($data->signatureCounter ?? 0),
        ];
    }

    public function processGet(
        string $clientDataJson,
        string $authenticatorData,
        string $signature,
        string $publicKeyPem,
        string $challenge,
        int $prevSignCount,
    ): int {
        try {
            $this->wa->processGet($clientDataJson, $authenticatorData, $signature, $publicKeyPem, $challenge, $prevSignCount, true, true);
        } catch (WebAuthnException $e) {
            throw new \RuntimeException('Kirjautuminen epäonnistui: ' . $e->getMessage(), 0, $e);
        }
        return (int) ($this->wa->getSignatureCounter() ?? $prevSignCount);
    }

    private function challenge(): string
    {
        $c = $this->wa->getChallenge();
        return $c instanceof ByteBuffer ? $c->getBinaryString() : (string) $c;
    }

    /** @return array<string, mixed> */
    private static function toArray(object $args): array
    {
        /** @var array<string, mixed> */
        return json_decode((string) json_encode($args, JSON_THROW_ON_ERROR), true, 32, JSON_THROW_ON_ERROR);
    }
}
