<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Http\Request;
use HessuTalks\I18n;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class I18nTest extends TestCase
{
    public function testEveryKeyIsTranslatedToEveryLanguage(): void
    {
        $fi = I18n::keys('fi');
        self::assertNotEmpty($fi);
        foreach (I18n::LANGS as $lang) {
            self::assertSame($fi, I18n::keys($lang), "Kielen $lang avaimet poikkeavat suomesta");
            foreach ($fi as $key) {
                self::assertNotSame('', trim(I18n::t($lang, $key)), "$lang: $key on tyhjä");
            }
        }
    }

    public function testPlaceholdersMatchBetweenLanguages(): void
    {
        foreach (I18n::keys('fi') as $key) {
            preg_match_all('/\{[a-z]+\}/', I18n::t('fi', $key), $fi);
            preg_match_all('/\{[a-z]+\}/', I18n::t('en', $key), $en);
            self::assertSame($fi[0], $en[0], "Paikkamerkit eroavat: $key");
        }
    }

    public function testTranslationWithParamsAndFallback(): void
    {
        self::assertSame('Sending failed (429).', I18n::t('en', 'js.send_failed', ['status' => 429]));
        self::assertSame('Lähetys epäonnistui (429).', I18n::t('fi', 'js.send_failed', ['status' => 429]));
        self::assertSame('olematon.avain', I18n::t('en', 'olematon.avain'));
        self::assertSame(I18n::t('fi', 'home.title'), I18n::t('xx', 'home.title'));
    }

    public function testJsStringsHaveNoPrefixAndOnlyJsKeys(): void
    {
        $js = I18n::jsStrings('en');
        self::assertSame('Invalid key.', $js['bad_key']);
        self::assertArrayNotHasKey('home.title', $js);
        self::assertSame(array_keys(I18n::jsStrings('fi')), array_keys($js));
    }

    /** @return iterable<string, array{string, string}> */
    public static function acceptLanguages(): iterable
    {
        yield 'tyhjä' => ['', 'fi'];
        yield 'englanti' => ['en-US,en;q=0.9', 'en'];
        yield 'suomi' => ['fi-FI,fi;q=0.9,en;q=0.8', 'fi'];
        yield 'englanti ensin' => ['en-GB,fi;q=0.5', 'en'];
        yield 'q-arvo ratkaisee' => ['fi;q=0.3,en;q=0.7', 'en'];
        yield 'muu kieli' => ['de-DE,de;q=0.9', 'fi'];
        yield 'muu kieli ja englanti' => ['sv-SE,en;q=0.5', 'en'];
        yield 'roskaa' => ['<script>;q=x,,;;', 'fi'];
        yield 'iso kirjaimin' => ['EN', 'en'];
    }

    #[DataProvider('acceptLanguages')]
    public function testAcceptLanguage(string $header, string $expected): void
    {
        self::assertSame($expected, I18n::fromAcceptLanguage($header));
    }

    public function testExplicitChoiceWinsAndInvalidValuesAreIgnored(): void
    {
        $en = new Request('GET', '/', ['lang' => 'en'], ['accept-language' => 'fi']);
        self::assertSame('en', I18n::fromRequest($en));
        self::assertSame('en', I18n::explicit($en));

        $bad = new Request('GET', '/', ['lang' => '../../etc'], ['accept-language' => 'en']);
        self::assertSame('en', I18n::fromRequest($bad));
        self::assertNull(I18n::explicit($bad));

        // JSON-kentän lang (API-kutsut) ohittaa selaimen kielen.
        self::assertSame('fi', I18n::fromRequest(new Request('POST', '/', [], ['accept-language' => 'en']), 'fi'));
        self::assertSame('en', I18n::fromRequest(new Request('POST', '/', [], ['accept-language' => 'en']), ['fi']));
    }
}
