<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * Uhkamalli (MMoIT R27, docs/threat-model.md): pakolliset STRIDE-rivit viittaavat oikeisiin vaatimuksiin ja testeihin,
 * ja jokainen taulukossa mainittu testi on olemassa, jottei viittaus vanhene huomaamatta.
 */
final class ThreatModelTest extends TestCase
{
    private static function read(string $path): string
    {
        $text = file_get_contents(dirname(__DIR__, 2) . '/' . $path);
        self::assertIsString($text, $path);
        return $text;
    }

    public function testRequiredStrideRowsReferToTests(): void
    {
        $model = self::read('docs/threat-model.md');
        self::assertStringContainsString('```mermaid', $model, 'arkkitehtuurikuva');
        foreach (['Participant browser', 'Admin window', 'PHP application', 'SQLite database'] as $part) {
            self::assertStringContainsString($part, $model, 'luottamusrajojen osa: ' . $part);
        }
        $rows = [
            '/^\| \*\*Tampering\*\* \| Fake votes[^\n]*\| R20 \/ H9 \|/m' => 'väärennetyt äänet → R20, H9',
            '/^\| \*\*Elevation of privilege\*\* \| A participant controls polls[^\n]*\| R18 \/ H8 \|/m' => 'osallistuja ohjaa kyselyitä → R18, H8',
            '/^\| \*\*Tampering \/ injection\*\* \| Script in an open-text answer[^\n]*\| R19 \/ H6 \|/m' => 'skripti avoimessa vastauksessa → R19, H6',
        ];
        foreach ($rows as $pattern => $what) {
            self::assertMatchesRegularExpression($pattern, $model, $what);
        }
        foreach (['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege'] as $category) {
            self::assertMatchesRegularExpression('/^\| \*\*' . $category . '/m', $model, 'STRIDE-luokka puuttuu: ' . $category);
        }
    }

    public function testReferencedTestsExist(): void
    {
        $root = dirname(__DIR__, 2);
        $sources = '';
        foreach (glob($root . '/tests/{Security,Unit}/*.php', GLOB_BRACE) ?: [] as $file) {
            $sources .= (string) file_get_contents($file);
        }
        foreach (['docs/threat-model.md', 'docs/uhkamalli.md'] as $doc) {
            $text = self::read($doc);
            preg_match_all('/`(test[A-Z]\w+)`/', $text, $tests);
            self::assertNotEmpty($tests[1], $doc);
            foreach ($tests[1] as $name) {
                self::assertStringContainsString('function ' . $name . '(', $sources, $doc . ': testiä ei ole: ' . $name);
            }
            preg_match_all('/`([\w-]+(?:\.test)?\.mjs)`/', $text, $scripts);
            foreach ($scripts[1] as $script) {
                $found = glob($root . '/{tests/e2e,tests/js,scripts}/' . $script, GLOB_BRACE) ?: [];
                self::assertNotEmpty($found, $doc . ': skriptiä ei ole: ' . $script);
            }
            preg_match_all('/`(\w+Test)`/', $text, $classes);
            foreach ($classes[1] as $class) {
                self::assertFileExists($root . '/tests/Security/' . $class . '.php', $doc);
            }
        }
    }
}
