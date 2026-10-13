<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\Tests\Support\AppTestCase;

/**
 * Kielivalinnan tietoturva: kieliparametri ei heijastu sivulle, valintaa ei tallenneta
 * palvelimelle eikä evästeisiin, ja hallinta pysyy suomenkielisenä.
 */
final class LanguageSecurityTest extends AppTestCase
{
    private string $code;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createKeys();
        $this->code = (string) $this->createEvent()['code'];
    }

    public function testEnglishByQueryParameter(): void
    {
        $r = $this->request('GET', '/k/' . $this->code . '?lang=en');
        self::assertSame(200, $r->status);
        self::assertStringContainsString('<html lang="en">', $r->body);
        self::assertStringContainsString('Send encrypted', $r->body);
        self::assertStringNotContainsString('Lähetä salattuna', $r->body);
        self::assertStringContainsString('aria-current="true">EN</a>', $r->body);
    }

    public function testBrowserLanguageIsDefault(): void
    {
        $en = $this->request('GET', '/', null, ['Accept-Language' => 'en-US,en;q=0.9']);
        self::assertStringContainsString('<html lang="en">', $en->body);
        self::assertStringContainsString('Join a lecture', $en->body);

        $fi = $this->request('GET', '/');
        self::assertStringContainsString('<html lang="fi">', $fi->body);
        self::assertStringContainsString('Liity luennolle', $fi->body);
    }

    public function testPrivacyPageInBothLanguages(): void
    {
        self::assertStringContainsString('<h1>Privacy</h1>', $this->request('GET', '/tietosuoja?lang=en')->body);
        self::assertStringContainsString('<h1>Tietosuoja</h1>', $this->request('GET', '/tietosuoja?lang=fi')->body);
    }

    public function testErrorPagesAreTranslated(): void
    {
        $r = $this->request('GET', '/k/ZZZZZZ?lang=en');
        self::assertSame(404, $r->status);
        self::assertStringContainsString('Lecture not found', $r->body);
    }

    /** @return iterable<array{string}> */
    public static function maliciousLangs(): iterable
    {
        yield ['"><script>alert(1)</script>'];
        yield ["en\r\nSet-Cookie: x=1"];
        yield ['../../templates/admin'];
        yield ['EN'];
        yield ['de'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('maliciousLangs')]
    public function testInvalidLangIsIgnoredAndNotReflected(string $lang): void
    {
        foreach (['/', '/k/' . $this->code, '/tietosuoja'] as $path) {
            $r = $this->request('GET', $path . '?lang=' . rawurlencode($lang));
            self::assertSame(200, $r->status, $path);
            self::assertStringContainsString('<html lang="fi">', $r->body);
            self::assertStringNotContainsString('<script>alert', $r->body);
            self::assertStringNotContainsString('?lang=' . $lang . '"', $r->body);
            self::assertArrayNotHasKey('Set-Cookie', $r->headers);
        }
        $redirect = $this->request('GET', '/?k=' . $this->code . '&lang=' . rawurlencode($lang));
        self::assertSame(303, $redirect->status);
        self::assertStringEndsWith('/k/' . $this->code, $redirect->headers['Location'] ?? '');
    }

    public function testCodeRedirectKeepsValidLanguage(): void
    {
        $r = $this->request('GET', '/?k=' . strtolower($this->code) . '&lang=en');
        self::assertSame(303, $r->status);
        self::assertStringEndsWith('/k/' . $this->code . '?lang=en', $r->headers['Location'] ?? '');
    }

    public function testLanguageChoiceSetsNoCookiesOrSession(): void
    {
        foreach (['/?lang=en', '/k/' . $this->code . '?lang=en', '/tietosuoja?lang=en'] as $path) {
            self::assertArrayNotHasKey('Set-Cookie', $this->request('GET', $path)->headers, $path);
        }
        self::assertFalse($this->session->isStarted());
    }

    public function testJsStringsAreEscapedInAttribute(): void
    {
        $body = $this->request('GET', '/k/' . $this->code . '?lang=en')->body;
        self::assertSame(1, preg_match('/data-i18n="([^"]*)"/', $body, $m));
        $json = json_decode(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5), true);
        self::assertIsArray($json);
        self::assertSame('Sending…', $json['sending'] ?? null);
    }

    public function testApiErrorsFollowRequestedLanguage(): void
    {
        $token = $this->formToken($this->code);
        $en = $this->request('POST', '/api/nickname', ['code' => $this->code, 'token' => $token, 'nickname' => 'x', 'lang' => 'en']);
        self::assertSame(422, $en->status);
        self::assertStringStartsWith('The nickname must be', (string) ($this->json($en)['error'] ?? ''));

        $fi = $this->request('POST', '/api/nickname', ['code' => $this->code, 'token' => $token, 'nickname' => 'x', 'lang' => '<b>']);
        self::assertStringStartsWith('Nimimerkissä pitää olla', (string) ($this->json($fi)['error'] ?? ''));

        $other = $this->request('POST', '/api/questions', ['code' => 'ZZZZZZ', 'lang' => 'en']);
        self::assertSame('Lecture not found.', $this->json($other)['error'] ?? null);
    }

    public function testAdminIsAlwaysFinnishWithoutSwitch(): void
    {
        $r = $this->request('GET', '/admin?lang=en', null, ['Accept-Language' => 'en']);
        self::assertStringContainsString('<html lang="fi">', $r->body);
        self::assertStringNotContainsString('lang-switch', $r->body);
        self::assertStringNotContainsString('js/lang.js', $r->body);
    }
}
