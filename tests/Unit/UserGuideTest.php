<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Käyttöohjeen kuvat (docs/kuvat/<kieli>/, tuotetaan tests/e2e/docs-screenshots.mjs): jokainen viitattu kuva on
 * olemassa, jokaiseen kuvaan viitataan, ja kieliversiot käyttävät samoja kuvia samassa järjestyksessä.
 */
final class UserGuideTest extends TestCase
{
    private const GUIDES = ['fi' => 'docs/kayttoohje.md', 'en' => 'docs/user-guide.md'];

    /** @return list<string> kuvien nimet ohjeen järjestyksessä */
    private static function images(string $lang): array
    {
        $text = file_get_contents(dirname(__DIR__, 2) . '/' . self::GUIDES[$lang]);
        self::assertIsString($text);
        preg_match_all('#kuvat/' . $lang . '/([a-z0-9-]+\.png)#', $text, $m);
        return $m[1];
    }

    public function testEveryReferencedImageExists(): void
    {
        foreach (array_keys(self::GUIDES) as $lang) {
            foreach (self::images($lang) as $file) {
                self::assertFileExists(dirname(__DIR__, 2) . '/docs/kuvat/' . $lang . '/' . $file);
            }
        }
    }

    public function testEveryImageIsUsed(): void
    {
        foreach (array_keys(self::GUIDES) as $lang) {
            $files = array_map('basename', glob(dirname(__DIR__, 2) . '/docs/kuvat/' . $lang . '/*.png') ?: []);
            self::assertNotSame([], $files, $lang);
            self::assertSame([], array_values(array_diff($files, self::images($lang))), 'Käyttämättömät kuvat (' . $lang . ')');
        }
    }

    public function testBothLanguagesUseSameImages(): void
    {
        self::assertSame(self::images('fi'), self::images('en'));
    }
}
