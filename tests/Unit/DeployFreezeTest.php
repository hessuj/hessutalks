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

    public function testRepositoryFreezeFileCoversTheEvent(): void
    {
        $spec = (string) file_get_contents(dirname(__DIR__, 2) . '/.github/deploy-freeze.txt');
        self::assertCount(2, DeployFreeze::parse($spec), 'Tiedosto on kelvollinen (kirjoitusvirhe kaatuu CI:ssä jo PR:ssä)');
        foreach (['2026-11-13 14:00', '2026-11-13 17:30', '2026-11-13 20:29', '2026-11-14 08:30', '2026-11-14 15:29'] as $t) {
            self::assertNotNull(DeployFreeze::activeWindow($spec, self::at($t)), $t);
        }
        foreach (['2026-11-12 23:59', '2026-11-13 13:59', '2026-11-13 20:30', '2026-11-14 08:29', '2026-11-14 15:30', '2026-11-15 10:00'] as $t) {
            self::assertNull(DeployFreeze::activeWindow($spec, self::at($t)), $t);
        }
    }

    public function testTimezoneIsHelsinkiAlsoForUtcClock(): void
    {
        $spec = '2026-11-13 14:00  2026-11-13 20:30  # pe';
        // CI:n kello on UTC: 12:30 UTC = 14:30 Suomen aikaa (talviaika +2).
        self::assertNotNull(DeployFreeze::activeWindow($spec, new \DateTimeImmutable('2026-11-13 12:30', new \DateTimeZone('UTC'))));
        self::assertNull(DeployFreeze::activeWindow($spec, new \DateTimeImmutable('2026-11-13 11:59', new \DateTimeZone('UTC'))));
        self::assertStringContainsString('pe', (string) DeployFreeze::activeWindow($spec, self::at('2026-11-13 15:00')));
    }

    public function testInvalidLinesAreErrorsNotSilentlyIgnored(): void
    {
        foreach (['2026-11-13 14:00', '2026-13-13 14:00 2026-13-13 20:00', '2026-11-13 20:00 2026-11-13 14:00', '13.11.2026 14:00 13.11.2026 20:00'] as $bad) {
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
