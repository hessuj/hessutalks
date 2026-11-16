<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Import\SetFormat;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\SetRepository;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Tuontitiedoston kuvaus (docs/tuontimuoto.md) annetaan tekoälylle sellaisenaan, joten sen pitää vastata koodia:
 * esimerkki tuodaan ilman virheitä ja varoituksia, ja kuvauksen rajat ovat samat kuin validoinnissa.
 */
final class ImportFormatDocTest extends TestCase
{
    /** @return array<string, array{string}> */
    public static function docs(): array
    {
        return ['fi' => ['docs/tuontimuoto.md'], 'en' => ['docs/import-format.md']];
    }

    private static function read(string $path): string
    {
        $text = file_get_contents(dirname(__DIR__, 2) . '/' . $path);
        self::assertIsString($text, $path);
        return $text;
    }

    #[DataProvider('docs')]
    public function testExampleIsImportedWithoutErrors(string $doc): void
    {
        self::assertSame(1, preg_match('/```json\n(.*?)\n```/s', self::read($doc), $m), 'JSON-esimerkki puuttuu');
        $r = SetFormat::parse($m[1]);
        self::assertSame([], $r['errors']);
        self::assertSame([], $r['warnings']);
        self::assertSame(['words', 'single', 'multi', 'likert', 'scale', 'open'], array_column($r['sets'][0]['polls'], 'type'));
    }

    #[DataProvider('docs')]
    public function testLimitsMatchValidation(string $doc): void
    {
        $text = self::read($doc);
        foreach ([
            '1–' . PollRepository::PROMPT_MAX,
            PollRepository::OPTIONS_MIN . '–' . PollRepository::OPTIONS_MAX,
            (string) PollRepository::OPTION_MAX,
            (string) PollRepository::EXPLANATION_MAX,
            (string) PollRepository::LABEL_MAX,
            PollRepository::OPEN_MAX . '–' . PollRepository::OPEN_LIMIT,
            (string) SetRepository::TITLE_MAX,
            intdiv(SetFormat::MAX_BYTES, 1000) . ' k',
            (string) SetRepository::MAX_PER_EVENT,
            (string) PollRepository::MAX_PER_EVENT,
        ] as $limit) {
            self::assertStringContainsString($limit, $text, $doc . ': raja ' . $limit . ' puuttuu tai on vanhentunut');
        }
    }
}
