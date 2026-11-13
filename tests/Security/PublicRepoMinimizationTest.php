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
        // Kurssien päivämäärät kertoisivat, milloin palvelu on käytössä (Hessun päätös 2.11.).
        '/\b2026-11-(1[34]|2[3-9])\b/' => 'kurssin päivämäärä',
        '/\b1[34]\.?\s?[–-]\s?1[34]\.11\./' => 'kurssin päivämäärä',
        '/\b2[45]\.?\s?[–-]\s?2[45]\.11\./' => 'kurssin päivämäärä',
        '/\b1[34]\s?[–-]\s?1[34] Nov\b/i' => 'kurssin päivämäärä',
        // Myös yksittäinen kurssipäivä (koeajon korjausten kommenteissa oli "13.11.", jota yllä olevat eivät tunnistaneet).
        '/(?<![\d.])(1[34]|2[3-9])\.\s?11\./' => 'kurssin päivämäärä',
        '/\b(1[34]|2[3-9])(th)?\s+Nov(ember)?\b/i' => 'kurssin päivämäärä',
        '/\bNov(ember)?\s+(1[34]|2[3-9])\b/i' => 'kurssin päivämäärä',
    ];

    /** Dokumentaatiossa (Markdown) ei hallintanäkymän osoitteita (Hessun päätös 2.11.). Koodissa reitit ovat väistämättä. */
    private const DOC_FORBIDDEN = [
        '#/admin\b#' => 'hallintanäkymän osoite',
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
            $patterns = self::FORBIDDEN + (str_ends_with($file, '.md') ? self::DOC_FORBIDDEN : []);
            foreach ($patterns as $pattern => $what) {
                if (preg_match($pattern, $text, $m) === 1) {
                    $found[] = $file . ': ' . $what . ' (' . $m[0] . ')';
                }
            }
        }
        self::assertSame([], $found, 'Julkiseen repoon ei infrastruktuuritietoja');
    }
}
