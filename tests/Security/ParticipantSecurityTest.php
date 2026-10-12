<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\Controller\ParticipantController;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Tests\Support\AppTestCase;

/**
 * Osallistujan rajapinnan tietoturvatestit: CSRF/origin, syötevalidointi,
 * nimimerkkien omistajuus, rate limit, henkilötietojen puuttuminen ja XSS.
 */
final class ParticipantSecurityTest extends AppTestCase
{
    private string $code;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createKeys();
        $this->code = (string) $this->createEvent()['code'];
        $this->token = $this->formToken($this->code);
    }

    /** @return array<string, mixed> */
    private function submission(array $claim, string $text = 'Mikä on CIA-kolmio?'): array
    {
        return [
            'code' => $this->code,
            'token' => $this->token,
            'nickname' => $claim['nickname'],
            'secret' => $claim['secret'],
            'ciphertext' => $this->seal((string) json_encode(['v' => 2, 'e' => $this->code, 'n' => $claim['nickname'], 't' => $text], JSON_UNESCAPED_UNICODE)),
        ];
    }

    public function testHappyPathStoresOnlyCiphertext(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Tietoturvaketju');
        $r = $this->request('POST', '/api/questions', $this->submission($claim, 'Erittäin salainen kysymys'));
        self::assertSame(201, $r->status, $r->body);

        $row = $this->db->one('SELECT * FROM questions');
        self::assertNotNull($row);
        $plain = sodium_crypto_box_seal_open((string) base64_decode((string) $row['ciphertext'], true), $this->keypair);
        self::assertIsString($plain);
        self::assertStringContainsString('Erittäin salainen kysymys', $plain);

        // Koko kannasta ei löydy selväkielistä viestiä eikä nimimerkkiä.
        $dump = '';
        foreach (['events', 'nicknames', 'questions', 'rate_limits', 'audit_log'] as $t) {
            $dump .= json_encode($this->db->all("SELECT * FROM $t"));
        }
        self::assertStringNotContainsString('salainen', $dump);
        self::assertStringNotContainsStringIgnoringCase('tietoturvaketju', $dump);
        self::assertStringNotContainsString('203.0.113.7', $dump, 'IP-osoitetta ei tallenneta');
    }

    public function testParticipantResponsesSetNoCookies(): void
    {
        foreach ([$this->request('GET', '/'), $this->request('GET', '/k/' . $this->code), $this->request('GET', '/tietosuoja')] as $r) {
            self::assertArrayNotHasKey('Set-Cookie', $r->headers);
        }
        self::assertFalse($this->session->isStarted(), 'Osallistujalle ei aloiteta istuntoa');
    }

    public function testDuplicateNicknameIsRejected(): void
    {
        $this->claim($this->code, $this->token, 'Kahvi Kuppi');
        foreach (['Kahvi Kuppi', 'kahvi kuppi', 'KAHVI-KUPPI', 'kahvi_kuppi'] as $variant) {
            $r = $this->request('POST', '/api/nickname', ['code' => $this->code, 'token' => $this->token, 'nickname' => $variant]);
            self::assertSame(409, $r->status, $variant);
        }
    }

    public function testEmailOrInvalidNicknameIsRejected(): void
    {
        foreach (['etu.suku@jamk.fi', 'x', str_repeat('a', 25), '<img src=x>', ''] as $nick) {
            $r = $this->request('POST', '/api/nickname', ['code' => $this->code, 'token' => $this->token, 'nickname' => $nick]);
            self::assertSame(422, $r->status, $nick);
        }
    }

    public function testCannotPostWithSomeoneElsesNickname(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Alkuperäinen');
        $forged = ['nickname' => 'Alkuperäinen', 'secret' => str_repeat('A', 43)];
        $r = $this->request('POST', '/api/questions', $this->submission($forged));
        self::assertSame(403, $r->status);
        self::assertSame('nickname', $this->json($r)['reason'] ?? null);

        $r = $this->request('POST', '/api/questions', $this->submission(['nickname' => 'Varaamaton', 'secret' => $claim['secret']]));
        self::assertSame(403, $r->status, 'Toisen nimimerkin tunniste ei kelpaa');
        self::assertSame(0, (int) ($this->db->one('SELECT COUNT(*) AS n FROM questions')['n'] ?? -1));
    }

    public function testNicknameClaimFromOtherEventDoesNotWork(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Matkaaja');
        $other = (string) $this->createEvent('Toinen')['code'];
        $otherToken = $this->formToken($other);
        $r = $this->request('POST', '/api/questions', [
            'code' => $other, 'token' => $otherToken, 'nickname' => 'Matkaaja', 'secret' => $claim['secret'],
            'ciphertext' => $this->seal('x'),
        ]);
        self::assertSame(403, $r->status);
    }

    /** @return iterable<string, array{array<string, string>}> */
    public static function badOrigins(): iterable
    {
        yield 'vieras origin' => [['Origin' => 'https://evil.example']];
        yield 'alidomain' => [['Origin' => 'https://evil.hessutalks.test']];
        yield 'http' => [['Origin' => 'http://hessutalks.test']];
        yield 'origin puuttuu' => [['Origin' => '']];
        yield 'cross-site fetch' => [['Sec-Fetch-Site' => 'cross-site']];
    }

    /** @param array<string, string> $headers */
    #[\PHPUnit\Framework\Attributes\DataProvider('badOrigins')]
    public function testCrossOriginRequestsAreRejected(array $headers): void
    {
        $claim = $this->claim($this->code, $this->token, 'Rehellinen');
        $r = $this->request('POST', '/api/questions', $this->submission($claim), $headers);
        self::assertSame(403, $r->status);
        $r = $this->request('POST', '/api/nickname', ['code' => $this->code, 'token' => $this->token, 'nickname' => 'Hyökkääjä'], $headers);
        self::assertSame(403, $r->status);
    }

    public function testFormEncodedPostIsRejected(): void
    {
        $r = $this->request('POST', '/api/questions', ['code' => $this->code], ['Content-Type' => 'application/x-www-form-urlencoded']);
        self::assertSame(415, $r->status);
    }

    public function testInvalidOrExpiredFormTokenIsRejected(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Ajastin');
        $body = $this->submission($claim);
        $r = $this->request('POST', '/api/questions', ['token' => '1.' . str_repeat('a', 64)] + $body);
        self::assertSame(403, $r->status);
        $this->clock->advance(13 * 3600);
        $r = $this->request('POST', '/api/questions', $body);
        self::assertSame(403, $r->status);
    }

    public function testPlaintextOrMalformedCiphertextIsRejected(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Muotoilija');
        foreach (['selväkielinen kysymys', '', base64_encode('lyhyt'), str_repeat('A', 30000), 123] as $ct) {
            $r = $this->request('POST', '/api/questions', ['ciphertext' => $ct] + $this->submission($claim));
            self::assertSame(422, $r->status);
        }
    }

    public function testClosedEventRejectsSubmissions(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Myöhäinen');
        $id = (int) (new EventRepository($this->db, $this->clock))->findByCode($this->code)['id'];
        (new EventRepository($this->db, $this->clock))->setStatus($id, 'closed');
        self::assertSame(410, $this->request('POST', '/api/questions', $this->submission($claim))->status);
        self::assertSame(410, $this->request('GET', '/k/' . $this->code)->status);
    }

    public function testRateLimitPerNickname(): void
    {
        $claim = $this->claim($this->code, $this->token, 'Spämmääjä');
        for ($i = 0; $i < ParticipantController::SUBMIT_LIMIT_PER_NICK; $i++) {
            self::assertSame(201, $this->request('POST', '/api/questions', $this->submission($claim))->status);
        }
        self::assertSame(429, $this->request('POST', '/api/questions', $this->submission($claim))->status);
        // Muut osallistujat (sama NAT-osoite) voivat edelleen lähettää.
        $other = $this->claim($this->code, $this->token, 'Kohtelias');
        self::assertSame(201, $this->request('POST', '/api/questions', $this->submission($other))->status);
    }

    /** @return iterable<array{string}> */
    public static function injectionCodes(): iterable
    {
        yield ["ABC234' OR '1'='1"];
        yield ['ABC234;DROP TABLE events'];
        yield ['%27%20OR%201%3D1'];
        yield ['../../etc/passwd'];
        yield ['<script>alert(1)</script>'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('injectionCodes')]
    public function testInjectionAttemptsInCodeAreHarmless(string $code): void
    {
        $r = $this->request('GET', '/k/' . $code);
        self::assertContains($r->status, [400, 404]);
        $r = $this->request('POST', '/api/nickname', ['code' => $code, 'token' => $this->token, 'nickname' => 'Testi']);
        self::assertSame(404, $r->status);
        self::assertNotNull($this->db->one('SELECT id FROM events WHERE code = ?', [$this->code]), 'Taulu ehjä');
    }

    public function testEventTitleIsHtmlEscaped(): void
    {
        $code = (string) $this->createEvent('<script>alert("xss")</script> & "lainaus"')['code'];
        $r = $this->request('GET', '/k/' . $code);
        self::assertStringNotContainsString('<script>alert', $r->body);
        self::assertStringContainsString('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp;', $r->body);
    }

    public function testUnknownAndInvalidCodesLookTheSame(): void
    {
        $unknown = $this->request('GET', '/k/ZZZZZZ');
        $invalid = $this->request('GET', '/k/1111');
        self::assertSame(404, $unknown->status);
        self::assertSame($unknown->body, $invalid->body);
    }

    public function testPageRequiresEncryptionKeyBeforeAcceptingMessages(): void
    {
        $this->db->exec('DELETE FROM admin_keys');
        self::assertSame(503, $this->request('GET', '/k/' . $this->code)->status);
    }

    public function testParticipantPageDoesNotAskForPersonalData(): void
    {
        $body = $this->request('GET', '/k/' . $this->code)->body;
        self::assertStringNotContainsString('type="email"', $body);
        self::assertStringNotContainsStringIgnoringCase('sähköposti', $body);
        self::assertStringContainsString('id="nickname"', $body);
    }
}
