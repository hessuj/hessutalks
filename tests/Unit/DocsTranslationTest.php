<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Julkinen dokumentaatio suomeksi ja englanniksi (GitHub): jokaisella kieliversiolla on kielilinkki toiseen,
 * ja rakenne (otsikot, taulukkorivit, koodilohkot) pysyy samana, jottei käännös jää jälkeen.
 */
final class DocsTranslationTest extends TestCase
{
    /** @return array<string, array{string, string}> */
    public static function pairs(): array
    {
        return [
            'README' => ['README.md', 'README.en.md'],
            'SECURITY' => ['SECURITY.md', 'SECURITY.en.md'],
            'hyväksymistestit' => ['docs/hyvaksymistestit.md', 'docs/hyvaksymistestit.en.md'],
        ];
    }

    private static function read(string $path): string
    {
        $text = file_get_contents(dirname(__DIR__, 2) . '/' . $path);
        self::assertIsString($text, $path);
        return $text;
    }

    #[DataProvider('pairs')]
    public function testBothLanguagesLinkToEachOther(string $fi, string $en): void
    {
        self::assertStringContainsString('**Suomi** · [English](' . basename($en) . ')', self::read($fi));
        self::assertStringContainsString('[Suomi](' . basename($fi) . ') · **English**', self::read($en));
    }

    #[DataProvider('pairs')]
    public function testTranslationHasSameStructure(string $fi, string $en): void
    {
        $shape = static function (string $text): array {
            $lines = explode("\n", $text);
            return [
                'otsikot' => array_map(static fn (string $l): int => strspn($l, '#'), preg_grep('/^#{1,6} /', $lines) ?: []),
                'taulukkorivit' => count(preg_grep('/^\|/', $lines) ?: []),
                'koodilohkot' => count(preg_grep('/^\s*```/', $lines) ?: []),
            ];
        };
        self::assertSame($shape(self::read($fi)), $shape(self::read($en)), $en . ' on jäänyt jälkeen tiedostosta ' . $fi);
    }
}
