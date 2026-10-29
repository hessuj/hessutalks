<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * Julkinen repo ei kerro tuotantoympäristöstä enempää kuin on pakko (tietojen minimointi, Hessun päätös 29.10.):
 * ei tilien tunnuksia (esim. FTP-käyttäjä), ei FTP-palvelinta eikä palvelimen kapasiteettirajoja, joista olisi
 * hyötyä tunnusten arvaamiseen tai palvelunestoon. Tuotannon osoite saa näkyä, koska se on julkinen joka tapauksessa.
 */
final class PublicRepoMinimizationTest extends TestCase
{
    private const FORBIDDEN = [
        '/[A-Za-z0-9._%+-]+@hessujarvinen\.com/i' => 'tilin tunnus (esim. FTP-käyttäjä)',
        '/\bftp\.hessujarvinen\.com\b/i' => 'FTP-palvelin',
        '/Entry Processes/i' => 'webhotellin prosessiraja',
        '/\bea-php\d+/i' => 'palvelimen PHP-paketti',
    ];

    public function testTrackedFilesContainNoInfrastructureDetails(): void
    {
        $root = dirname(__DIR__, 2);
        $files = array_filter(explode("\n", (string) shell_exec('git -C ' . escapeshellarg($root) . ' ls-files')));
        self::assertNotEmpty($files, 'git ls-files');
        $found = [];
        foreach ($files as $file) {
            if (str_starts_with($file, 'public/assets/vendor/') || $file === 'composer.lock' || $file === 'tests/Security/PublicRepoMinimizationTest.php') {
                continue;
            }
            $text = @file_get_contents($root . '/' . $file);
            if (!is_string($text) || str_contains($text, "\0")) {
                continue;   // poistettu tai binääri
            }
            foreach (self::FORBIDDEN as $pattern => $what) {
                if (preg_match($pattern, $text, $m) === 1) {
                    $found[] = $file . ': ' . $what . ' (' . $m[0] . ')';
                }
            }
        }
        self::assertSame([], $found, 'Julkiseen repoon ei infrastruktuuritietoja');
    }
}
