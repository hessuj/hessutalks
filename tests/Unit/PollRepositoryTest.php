<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Database;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Security\Clock;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PollRepositoryTest extends TestCase
{
    private Database $db;
    private PollRepository $polls;
    private int $eventId;

    protected function setUp(): void
    {
        $this->db = new Database(':memory:', dirname(__DIR__, 2) . '/migrations');
        $clock = new Clock();
        $clock->freeze(1_800_000_000);
        $this->polls = new PollRepository($this->db, $clock, str_repeat('ab', 32));
        $this->eventId = (int) (new EventRepository($this->db, $clock))->create('Luento', null)['id'];
    }

    private static function voter(string $seed = 'a'): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $seed, true)), '+/', '-_'), '=');
    }

    private static function ct(): string
    {
        return base64_encode(random_bytes(80));
    }

    /** @param array<string, mixed> $config */
    private function create(string $type = 'single', array $config = ['options' => ['A', 'B']]): int
    {
        $valid = PollRepository::validate($type, 'Kysymys?', $config);
        self::assertIsArray($valid);
        return (int) $this->polls->create($this->eventId, $type, $valid[0], $valid[1]);
    }

    /** @return iterable<string, array{mixed, mixed, mixed, bool}> */
    public static function validations(): iterable
    {
        yield 'monivalinta' => ['single', 'Mikä?', ['options' => ['A', 'B', ' ']], true];
        yield 'useita' => ['multi', 'Mitkä?', ['options' => ['A', 'B', 'C']], true];
        yield 'liian vähän vaihtoehtoja' => ['single', 'Mikä?', ['options' => ['A', '']], false];
        yield 'liikaa vaihtoehtoja' => ['single', 'Mikä?', ['options' => array_fill(0, 11, 'x')], false];
        yield 'liian pitkä vaihtoehto' => ['single', 'Mikä?', ['options' => ['A', str_repeat('b', 121)]], false];
        yield 'sanapilvi' => ['words', 'Yksi sana?', [], true];
        yield 'likert 7' => ['likert', 'Samaa mieltä?', ['points' => 7, 'min_label' => 'Ei', 'max_label' => 'Kyllä'], true];
        yield 'likert 6' => ['likert', 'Samaa mieltä?', ['points' => 6], false];
        yield 'asteikko' => ['scale', 'Kuinka varma?', ['min_label' => '', 'max_label' => 'Täysin'], true];
        yield 'liian pitkä selite' => ['scale', 'Kuinka varma?', ['min_label' => str_repeat('x', 41)], false];
        yield 'tuntematon tyyppi' => ['ranking', 'Järjestä', [], false];
        yield 'tyhjä kysymys' => ['words', '   ', [], false];
        yield 'liian pitkä kysymys' => ['words', str_repeat('k', 301), [], false];
        yield 'kysymys ei merkkijono' => ['words', ['x'], [], false];
    }

    #[DataProvider('validations')]
    public function testValidate(mixed $type, mixed $prompt, mixed $config, bool $ok): void
    {
        self::assertSame($ok, is_array(PollRepository::validate($type, $prompt, $config)));
    }

    public function testValidateCleansControlCharactersAndEmptyOptions(): void
    {
        $valid = PollRepository::validate('single', "  Mikä\u{202E}  on?\n", ['options' => [' A ', '', 'B']]);
        self::assertIsArray($valid);
        self::assertSame('Mikä on?', $valid[0]);
        self::assertSame(['options' => ['A', 'B']], $valid[1]);
    }

    public function testNewAnswerFromSameVoterReplacesOld(): void
    {
        $poll = $this->create();
        self::assertTrue($this->polls->answer($poll, self::voter('a'), self::ct()));
        $first = $this->polls->answersForEvent($this->eventId);
        self::assertTrue($this->polls->answer($poll, self::voter('a'), self::ct()));
        self::assertTrue($this->polls->answer($poll, self::voter('b'), self::ct()));
        self::assertSame(2, $this->polls->countAnswers($poll));
        $after = $this->polls->answersForEvent($this->eventId, $first[0]['id']);
        self::assertCount(2, $after);
        self::assertSame($first[0]['voter'], $after[0]['voter'], 'Korvaava vastaus tunnistetaan samasta vastaajasta');
    }

    public function testVoterHashDiffersBetweenPollsAndSecretIsNotStored(): void
    {
        $a = $this->create();
        $b = $this->create();
        $voter = self::voter('sama');
        $this->polls->answer($a, $voter, self::ct());
        $this->polls->answer($b, $voter, self::ct());
        $rows = $this->db->all('SELECT voter_hash FROM poll_answers');
        self::assertNotSame($rows[0]['voter_hash'], $rows[1]['voter_hash'], 'Vastauksia eri kyselyissä ei voi yhdistää');
        self::assertStringNotContainsString($voter, (string) json_encode($this->db->all('SELECT * FROM poll_answers')));
    }

    public function testResetClearsAnswersAndBumpsGeneration(): void
    {
        $poll = $this->create();
        $this->polls->answer($poll, self::voter(), self::ct());
        $this->polls->reset($poll);
        self::assertSame(0, $this->polls->countAnswers($poll));
        self::assertSame(2, $this->polls->find($poll)['generation'] ?? null);
    }

    public function testOptionCountCannotChangeAfterAnswers(): void
    {
        $poll = $this->create();
        self::assertNull($this->polls->update($poll, 'Uusi teksti?', ['options' => ['A', 'B', 'C']]));
        $this->polls->answer($poll, self::voter(), self::ct());
        self::assertNull($this->polls->update($poll, 'Korjattu teksti?', ['options' => ['A2', 'B2', 'C2']]), 'Tekstin saa korjata');
        self::assertIsString($this->polls->update($poll, 'X?', ['options' => ['A', 'B']]));
    }

    public function testOnlyOpenPollsAreListedForParticipantsWithoutAnswers(): void
    {
        $draft = $this->create();
        $open = $this->create('words', []);
        $this->polls->setStatus($open, 'open');
        $this->polls->answer($open, self::voter(), self::ct());
        $list = $this->polls->openForEvent($this->eventId);
        self::assertSame([$open], array_column($list, 'id'));
        self::assertSame(['id', 'type', 'prompt', 'config', 'generation'], array_keys($list[0]));
        self::assertNotSame($draft, $open);
    }

    public function testDeletingEventDeletesPollsAndAnswers(): void
    {
        $poll = $this->create();
        $this->polls->answer($poll, self::voter(), self::ct());
        $this->db->exec('DELETE FROM events WHERE id = ?', [$this->eventId]);
        self::assertSame(0, (int) ($this->db->one('SELECT COUNT(*) AS n FROM polls')['n'] ?? -1));
        self::assertSame(0, (int) ($this->db->one('SELECT COUNT(*) AS n FROM poll_answers')['n'] ?? -1));
    }

    public function testAnswerQuotaPerPoll(): void
    {
        $poll = $this->create();
        $this->db->pdo()->beginTransaction();
        for ($i = 0; $i < PollRepository::MAX_ANSWERS; $i++) {
            $this->db->exec('INSERT INTO poll_answers (poll_id, voter_hash, ciphertext, created_at) VALUES (?, ?, ?, 0)', [$poll, 'h' . $i, 'x']);
        }
        $this->db->pdo()->commit();
        self::assertFalse($this->polls->answer($poll, self::voter('uusi'), self::ct()));
    }

    public function testVoterAndCiphertextFormats(): void
    {
        self::assertTrue(PollRepository::isValidVoter(self::voter()));
        self::assertFalse(PollRepository::isValidVoter('lyhyt'));
        self::assertFalse(PollRepository::isValidVoter(str_repeat('+', 43)));
        self::assertTrue(PollRepository::isValidCiphertext(self::ct()));
        self::assertFalse(PollRepository::isValidCiphertext(base64_encode(random_bytes(PollRepository::CIPHERTEXT_MAX_BYTES + 1))));
        self::assertFalse(PollRepository::isValidCiphertext('{"a":1}'));
    }
}
