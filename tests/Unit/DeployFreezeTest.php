<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\DeployFreeze;
use PHPUnit\Framework\TestCase;

/** Julkaisujäädytys tapahtuman aikana (vaatimus 8) ja oikean jäädytystiedoston kelpoisuus. */
final class DeployFreezeTest extends TestCase
{
    private static function at(string $local): \DateTimeImmutable
    {
        return new \DateTimeImmutable($local, new \DateTimeZone('Europe/Helsinki'));
    }

    /** Kuvitteelliset ajat: oikeat ikkunat ovat GitHubin muuttujassa, eivät julkisessa repossa. */
    private const SPEC = "# esimerkki\n2030-11-15 14:00  2030-11-15 20:30  # pe\n2030-11-16 08:30  2030-11-16 15:30  # la\n2030-11-25 00:00  2030-12-02 00:00  # viikko\n";

    public function testWindowsBlockOnlyTheirOwnTime(): void
    {
        self::assertCount(3, DeployFreeze::parse(self::SPEC));
        foreach (['2030-11-15 14:00', '2030-11-15 20:29', '2030-11-16 08:30', '2030-11-16 15:29', '2030-11-25 00:00', '2030-12-01 23:59'] as $t) {
            self::assertNotNull(DeployFreeze::activeWindow(self::SPEC, self::at($t)), $t);
        }
        foreach (['2030-11-15 13:59', '2030-11-15 20:30', '2030-11-16 08:29', '2030-11-16 15:30', '2030-11-24 23:59', '2030-12-02 00:00'] as $t) {
            self::assertNull(DeployFreeze::activeWindow(self::SPEC, self::at($t)), $t);
        }
    }

    public function testScheduleIsNotInPublicRepoNorInLogMessages(): void
    {
        $root = dirname(__DIR__, 2);
        self::assertFileDoesNotExist($root . '/.github/deploy-freeze.txt', 'Aikataulu GitHubin muuttujassa, ei julkisessa tiedostossa');
        self::assertStringContainsString('DEPLOY_FREEZE: ${{ vars.DEPLOY_FREEZE }}', (string) file_get_contents($root . '/.github/workflows/ci.yml'));

        $cases = [
            'jäädytys' => [self::SPEC, '2030-11-15 15:00', false, 1],
            'ohitus' => [self::SPEC, '2030-11-15 15:00', true, 0],
            'ei ikkunaa' => [self::SPEC, '2030-11-20 12:00', false, 0],
            'tyhjä' => ['', '2030-11-15 15:00', false, 0],
            'virheellinen' => ["2030-11-15 14:00 # pe\n", '2030-11-20 12:00', false, 1],
        ];
        foreach ($cases as $name => [$spec, $now, $override, $code]) {
            [$got, $message] = DeployFreeze::decide($spec, self::at($now), $override);
            self::assertSame($code, $got, $name);
            // Actions-loki on julkinen: ei päivämääriä, kellonaikoja eikä ikkunoiden kuvauksia.
            self::assertDoesNotMatchRegularExpression('/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.|\d{1,2}:\d{2}|\b(pe|la|viikko)\b/', $message, $name . ': ' . $message);
        }
    }

    public function testTimezoneIsHelsinkiAlsoForUtcClock(): void
    {
        $spec = '2030-11-15 14:00  2030-11-15 20:30  # pe';
        // CI:n kello on UTC: 12:30 UTC = 14:30 Suomen aikaa (talviaika +2).
        self::assertNotNull(DeployFreeze::activeWindow($spec, new \DateTimeImmutable('2030-11-15 12:30', new \DateTimeZone('UTC'))));
        self::assertNull(DeployFreeze::activeWindow($spec, new \DateTimeImmutable('2030-11-15 11:59', new \DateTimeZone('UTC'))));
        self::assertStringContainsString('pe', (string) DeployFreeze::activeWindow($spec, self::at('2030-11-15 15:00')));
    }

    public function testInvalidLinesAreErrorsNotSilentlyIgnored(): void
    {
        foreach (['2030-11-15 14:00', '2030-13-15 14:00 2030-13-15 20:00', '2030-11-15 20:00 2030-11-15 14:00', '15.11.2030 14:00 15.11.2030 20:00'] as $bad) {
            try {
                DeployFreeze::parse($bad);
                self::fail('Hyväksyttiin: ' . $bad);
            } catch (\InvalidArgumentException) {
                self::addToAssertionCount(1);
            }
        }
        self::assertSame([], DeployFreeze::parse("# vain kommentti\n\n"));
    }
}
