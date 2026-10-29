<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Import\SetFormat;
use HessuTalks\Repository\PollRepository;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Kysymyssarjojen JSON-tuonti ja -vienti. H14: kurssin tiedosto (vaatimusdokumentin luku 10)
 * tuodaan sellaisenaan.
 */
final class SetFormatTest extends TestCase
{
    private static function fixture(): string
    {
        return (string) file_get_contents(dirname(__DIR__) . '/fixtures/mmoit-2026.json');
    }

    /** @param array<string, mixed> $set */
    private static function file(array ...$sets): string
    {
        return (string) json_encode(['sets' => $sets]);
    }

    public function testCourseFileIsImportedCompletely(): void
    {
        $r = SetFormat::parse(self::fixture());
        self::assertSame([], $r['errors']);
        self::assertSame('Cybersecurity Fundamentals – MMoIT 2026', $r['title']);
        self::assertSame(['OPEN', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'WRAP-FRI', 'CLOSE-SAT'], array_column($r['sets'], 'slug'));
        self::assertSame([1, 6, 2, 1, 4, 3, 1, 2, 2], array_map(static fn (array $s): int => count($s['polls']), $r['sets']));
        self::assertSame([], $r['warnings'], 'Kaikki 22 kysymystä tuodaan');
        // M6:n Q&A (tykkäykset, COULD) tuodaan varatyyppinä open.
        self::assertSame(['type' => 'open', 'prompt' => 'Questions about secure development or your group work?', 'config' => ['multiple' => false]], $r['sets'][6]['polls'][0]);
        self::assertSame('open', $r['sets'][1]['polls'][5]['type']);

        $open = $r['sets'][0]['polls'][0];
        self::assertSame(['type' => 'words', 'prompt' => 'Cybersecurity in one word?', 'config' => []], $open);
        $likert = $r['sets'][1]['polls'][0];
        self::assertSame('likert', $likert['type']);
        self::assertSame(['points' => 5, 'min_label' => 'Strongly disagree', 'max_label' => 'Strongly agree'], $likert['config']);

        $m3 = $r['sets'][3]['polls'][0];
        self::assertSame('multi', $m3['type']);
        self::assertSame([0, 1, 2, 3], $m3['config']['correct']);
        self::assertCount(7, $m3['config']['explanations']);
        self::assertSame('No – DORA covers the financial sector.', $m3['config']['explanations'][6]);

        $m4 = $r['sets'][4]['polls'];
        self::assertSame([1], $m4[0]['config']['correct']);
        self::assertArrayNotHasKey('explanations', $m4[1]['config'], 'Selitykset ovat valinnaisia');
        self::assertArrayNotHasKey('correct', $m4[2]['config'], 'M4/3: ei oikeaa vastausta');
        self::assertArrayNotHasKey('correct', $m4[3]['config'], 'M4/4: ei oikeaa vastausta');
    }

    public function testExportRoundTrips(): void
    {
        $first = SetFormat::parse(self::fixture());
        $sets = [];
        $polls = [];
        foreach ($first['sets'] as $i => $set) {
            $sets[] = ['id' => $i + 1, 'slug' => $set['slug'], 'title' => $set['title']];
            foreach ($set['polls'] as $p) {
                $polls[] = ['set_id' => $i + 1] + $p;
            }
        }
        $exported = SetFormat::export('Cybersecurity Fundamentals – MMoIT 2026', $sets, $polls);
        self::assertSame('hessutalks-sets', $exported['format']);
        $second = SetFormat::parse((string) json_encode($exported));
        self::assertSame([], $second['errors']);
        self::assertSame([], $second['warnings'], 'Viedyssä tiedostossa on vain tuetut tyypit');
        self::assertSame($first['sets'], $second['sets'], 'Vienti ja uudelleentuonti tuottavat samat kysymykset');
    }

    public function testOpenAnswerLengthIsImportedAndExported(): void
    {
        $r = SetFormat::parse(self::file(['id' => 'L4', 'title' => 'L4', 'questions' => [
            ['type' => 'open', 'text' => 'Riskit kolmella tasolla?', 'maxLength' => 3500, 'multipleAnswers' => true],
            ['type' => 'open', 'text' => 'Lyhyt', 'maxLength' => 280],
            ['type' => 'open', 'text' => 'Oletus'],
        ]]));
        self::assertSame([], $r['errors']);
        $configs = array_column($r['sets'][0]['polls'], 'config');
        self::assertSame([['multiple' => true, 'max' => 3500], ['multiple' => false], ['multiple' => false]], $configs, 'Oletusta (280) ei tallenneta');

        $polls = array_map(static fn (array $p): array => ['set_id' => 1] + $p, $r['sets'][0]['polls']);
        $exported = SetFormat::export('Kurssi', [['id' => 1, 'slug' => 'L4', 'title' => 'L4']], $polls);
        $questions = $exported['sets'][0]['questions'];
        self::assertSame(3500, $questions[0]['maxLength']);
        self::assertArrayNotHasKey('maxLength', $questions[1]);
        self::assertSame($r['sets'], SetFormat::parse((string) json_encode($exported))['sets'], 'Vienti ja uudelleentuonti säilyttävät pituuden');
    }

    /** @return iterable<string, array{string, string}> */
    public static function invalidFiles(): iterable
    {
        $q = static fn (array $q): array => ['id' => 'M1', 'title' => 'Moduuli', 'questions' => [$q]];
        $single = ['type' => 'single', 'text' => 'Mikä?', 'options' => ['A', 'B', 'C']];
        yield 'ei JSONia' => ['{sets: [', 'kelvollista JSONia'];
        yield 'ei sarjoja' => ['{"event": {}}', 'sets-lista'];
        yield 'tyhjä' => ['{"sets": []}', 'yhtään sarjaa'];
        yield 'virheellinen id' => [self::file(['id' => '<script>', 'title' => 'X', 'questions' => []]), 'id puuttuu tai on virheellinen'];
        yield 'sama id kahdesti' => [self::file(['id' => 'M1', 'title' => 'A', 'questions' => []], ['id' => 'm1', 'title' => 'B', 'questions' => []]), 'kahdesti'];
        yield 'nimi puuttuu' => [self::file(['id' => 'M1', 'questions' => []]), 'title puuttuu'];
        yield 'tuntematon tyyppi' => [self::file($q(['type' => 'ranking', 'text' => 'X'])), 'tuntematon type'];
        yield 'asteikko 2–9' => [self::file($q(['type' => 'scale', 'text' => 'X', 'min' => 2, 'max' => 9])), '1–5, 1–7 tai 0–10'];
        yield 'liian monta sanaa' => [self::file($q(['type' => 'wordcloud', 'text' => 'X', 'maxWords' => 5])), 'maxWords'];
        yield 'tyhjä vaihtoehto' => [self::file($q(['type' => 'single', 'text' => 'X', 'options' => ['A', ' ']])), 'tyhjä vaihtoehto'];
        yield 'kaksi oikeaa yhden vastauksen kysymyksessä' => [self::file($q($single + ['correct' => [0, 1]])), 'vain yksi oikea'];
        yield 'oikea vastaus ei vaihtoehto' => [self::file($q($single + ['correct' => [3]])), 'jota ei ole'];
        yield 'oikea vastaus merkkijonona' => [self::file($q($single + ['correct' => ['A']])), 'jota ei ole'];
        yield 'selityksiä väärä määrä' => [self::file($q($single + ['explanations' => ['a', 'b']])), 'yksi jokaista vaihtoehtoa'];
        yield 'liian pitkä selitys' => [self::file($q($single + ['explanations' => [str_repeat('x', 301), '', '']])), 'enintään 300'];
        yield 'liian pitkä kysymys' => [self::file($q(['type' => 'wordcloud', 'text' => str_repeat('x', 301)])), 'kysymyksessä pitää olla'];
        yield 'liian suuri' => [str_repeat(' ', SetFormat::MAX_BYTES + 1), 'liian suuri'];
        yield 'liian syvä' => [str_repeat('[', 50) . str_repeat(']', 50), 'kelvollista JSONia'];
        yield 'avoin vastaus liian pitkä' => [self::file($q(['type' => 'open', 'text' => 'X', 'maxLength' => 3501])), '280–3500 merkkiä'];
        yield 'avoin vastaus alle oletuksen' => [self::file($q(['type' => 'open', 'text' => 'X', 'maxLength' => 100])), '280–3500 merkkiä'];
        yield 'avoin vastaus merkkijonona' => [self::file($q(['type' => 'open', 'text' => 'X', 'maxLength' => '500'])), '280–3500 merkkiä'];
        yield 'qa ilman tuettua varatyyppiä' => [self::file($q(['type' => 'qa', 'text' => 'X', 'fallbackType' => 'ranking'])), 'tuntematon type'];
    }

    #[DataProvider('invalidFiles')]
    public function testInvalidFilesAreRejectedWithReason(string $raw, string $reason): void
    {
        $errors = SetFormat::parse($raw)['errors'];
        self::assertNotSame([], $errors);
        self::assertStringContainsStringIgnoringCase($reason, implode("\n", $errors));
    }

    public function testQaWithoutFallbackIsSkipped(): void
    {
        $r = SetFormat::parse(self::file(['id' => 'M6', 'title' => 'Q&A', 'questions' => [['type' => 'qa', 'text' => 'Kysy']]]));
        self::assertSame([], $r['errors']);
        self::assertSame([], $r['sets'][0]['polls']);
        self::assertStringContainsString('varatyyppiä', $r['warnings'][0]);
    }

    public function testAnswerKeyIsHiddenFromParticipants(): void
    {
        $valid = PollRepository::validate('multi', 'Mitkä?', ['options' => ['A', 'B'], 'correct' => [1, 1, 0], 'explanations' => ['a', 'b']]);
        self::assertIsArray($valid);
        self::assertSame([0, 1], $valid[1]['correct'], 'Järjestetty, ei kaksoiskappaleita');
        self::assertSame(['options' => ['A', 'B']], PollRepository::publicConfig($valid[1]));
        $noKey = PollRepository::validate('single', 'Mikä?', ['options' => ['A', 'B'], 'explanations' => ['', '']]);
        self::assertSame(['options' => ['A', 'B']], is_array($noKey) ? $noKey[1] : null, 'Tyhjiä selityksiä ei tallenneta');
    }
}
