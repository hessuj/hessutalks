<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Database;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\LiveRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\SetRepository;
use HessuTalks\Security\Clock;
use PHPUnit\Framework\TestCase;

/**
 * Aktiivinen kysymys ja sarjat: vain yksi aktiivinen, vain aktiivinen voi olla auki,
 * Seuraava/Edellinen ohittaa ohitetut sarjat, ja luonnos näkyy osallistujalle odotusnäkymänä.
 */
final class LiveRepositoryTest extends TestCase
{
    private Database $db;
    private Clock $clock;
    private PollRepository $polls;
    private SetRepository $sets;
    private LiveRepository $live;
    private EventRepository $events;
    private int $eventId;

    protected function setUp(): void
    {
        $this->db = new Database(':memory:', dirname(__DIR__, 2) . '/migrations');
        $this->clock = new Clock();
        $this->clock->freeze(1_800_000_000);
        $this->polls = new PollRepository($this->db, $this->clock, str_repeat('ab', 32));
        $this->sets = new SetRepository($this->db, $this->clock);
        $this->live = new LiveRepository($this->db);
        $this->events = new EventRepository($this->db, $this->clock);
        $this->eventId = (int) $this->events->create('Luento', null)['id'];
    }

    private function set(string $slug): int
    {
        $id = $this->sets->create($this->eventId, $slug, 'Sarja ' . $slug);
        self::assertIsInt($id);
        return $id;
    }

    private function poll(int $setId, string $prompt = 'Kysymys?'): int
    {
        return (int) $this->polls->create($this->eventId, $setId, 'single', $prompt, ['options' => ['A', 'B']]);
    }

    private function pollStatus(int $poll): string
    {
        return (string) ($this->polls->find($poll)['status'] ?? '');
    }

    /** @return array<string, mixed> */
    private function event(): array
    {
        return (array) $this->events->find($this->eventId);
    }

    public function testOnlyActivePollIsOpenAndSwitchingClosesPrevious(): void
    {
        $s = $this->set('M1');
        $a = $this->poll($s);
        $b = $this->poll($s);
        self::assertTrue($this->live->open($this->eventId, $a));
        self::assertSame($a, $this->live->activeId($this->eventId));
        self::assertSame('open', $this->pollStatus($a));

        self::assertTrue($this->live->open($this->eventId, $b));
        self::assertSame('closed', $this->pollStatus($a), 'Edellinen aktiivinen suljetaan');
        self::assertSame('open', $this->pollStatus($b));
        self::assertSame(1, (int) ($this->db->one("SELECT COUNT(*) AS n FROM polls WHERE status = 'open'")['n'] ?? 0));

        self::assertTrue($this->live->activate($this->eventId, null));
        self::assertNull($this->live->activeId($this->eventId));
        self::assertSame('closed', $this->pollStatus($b), 'Odotusnäkymään siirtyminen sulkee avoimen');
    }

    public function testStepSkipsSkippedSetsAndStopsAtEnds(): void
    {
        $m1 = $this->set('M1');
        $m2 = $this->set('M2');
        $m3 = $this->set('M3');
        $a = $this->poll($m1);
        $b = $this->poll($m2);
        $c = $this->poll($m3);
        $d = $this->poll($m3);
        $this->sets->setSkipped($m2, true);

        self::assertSame($a, $this->live->step($this->eventId, 1), 'Ilman aktiivista Seuraava aloittaa ensimmäisestä');
        self::assertSame($c, $this->live->step($this->eventId, 1), 'Ohitettu sarja M2 jää väliin');
        self::assertSame($d, $this->live->step($this->eventId, 1));
        self::assertNull($this->live->step($this->eventId, 1), 'Viimeisen jälkeen ei siirrytä');
        self::assertSame($d, $this->live->activeId($this->eventId));
        self::assertSame($c, $this->live->step($this->eventId, -1));
        self::assertSame($a, $this->live->step($this->eventId, -1));

        // Ohitetun sarjan kysymyksen voi silti näyttää suoraan, ja siitä jatketaan järjestyksessä.
        self::assertTrue($this->live->activate($this->eventId, $b));
        self::assertSame($c, $this->live->step($this->eventId, 1));
    }

    public function testReorderingSetsChangesSequence(): void
    {
        $m1 = $this->set('M1');
        $m2 = $this->set('M2');
        $a = $this->poll($m1);
        $b = $this->poll($m2);
        $this->sets->move($m2, -1);
        self::assertSame($b, $this->live->step($this->eventId, 1));
        self::assertSame($a, $this->live->step($this->eventId, 1));
    }

    public function testParticipantSeesOnlyOpenOrClosedActivePollWithPublicFields(): void
    {
        $s = $this->set('M1');
        $a = $this->poll($s, 'Näkyykö?');
        self::assertNull($this->live->participantPoll($this->event()), 'Ei aktiivista: odotusnäkymä');

        $this->live->activate($this->eventId, $a);
        self::assertNull($this->live->participantPoll($this->event()), 'Luonnos ei näy osallistujalle');

        $this->live->open($this->eventId, $a);
        $poll = $this->live->participantPoll($this->event());
        self::assertIsArray($poll);
        self::assertSame(['id', 'type', 'prompt', 'config', 'generation', 'status'], array_keys($poll));
        self::assertSame('open', $poll['status']);

        $this->polls->setStatus($a, 'closed');
        self::assertSame('closed', $this->live->participantPoll($this->event())['status'] ?? null, 'Suljettu näkyy tilana');
    }

    public function testVersionGrowsOnEveryVisibleChange(): void
    {
        $s = $this->set('M1');
        $a = $this->poll($s);
        $v = static fn (array $e): int => (int) $e['live_version'];
        $before = $v($this->event());
        $this->live->open($this->eventId, $a);
        $afterOpen = $v($this->event());
        self::assertGreaterThan($before, $afterOpen);
        $this->live->bump($this->eventId);
        self::assertGreaterThan($afterOpen, $v($this->event()));
    }

    public function testDeletingActivePollOrItsSetClearsActive(): void
    {
        $s = $this->set('M1');
        $a = $this->poll($s);
        $this->live->open($this->eventId, $a);
        $this->live->forgetSet($this->eventId, $s);
        $this->sets->delete($s);
        self::assertNull($this->live->activeId($this->eventId));
        self::assertNull($this->polls->find($a), 'Sarjan poisto poistaa kysymykset');
    }

    public function testCannotActivatePollOfAnotherEvent(): void
    {
        $other = (int) $this->events->create('Toinen', null)['id'];
        $set = $this->sets->create($other, 'X', 'X');
        self::assertIsInt($set);
        $foreign = (int) $this->polls->create($other, $set, 'words', 'Sana?', []);
        self::assertFalse($this->live->activate($this->eventId, $foreign));
        self::assertFalse($this->live->open($this->eventId, $foreign));
        self::assertNull($this->live->step($this->eventId, 1), 'Toisen luennon kysymykset eivät ole järjestyksessä');
    }

    public function testSlugAndTitleValidation(): void
    {
        self::assertSame('M1', SetRepository::cleanSlug(' m1 '));
        self::assertSame('CLOSE-SAT', SetRepository::cleanSlug('CLOSE-SAT'));
        foreach (['', '-M1', 'M 1', '<b>', str_repeat('A', 17), 5] as $bad) {
            self::assertNull(SetRepository::cleanSlug($bad), var_export($bad, true));
        }
        self::assertSame('M1 Cyber and society', SetRepository::cleanTitle("  M1\tCyber and\u{200B}society "));
        self::assertNull(SetRepository::cleanTitle(str_repeat('x', SetRepository::TITLE_MAX + 1)));
        $this->set('M1');
        self::assertIsString($this->sets->create($this->eventId, 'M1', 'Toinen'), 'Sama tunniste kahdesti');
    }

    /** Migraatio 005 rakentaa polls-taulun uudelleen: kyselyt ja vastaukset säilyvät, viiteavaimet pysyvät päällä. */
    public function testRebuildMigrationKeepsAnswersAndForeignKeys(): void
    {
        $dir = sys_get_temp_dir() . '/hessutalks-migr-' . bin2hex(random_bytes(4));
        mkdir($dir);
        $all = glob(dirname(__DIR__, 2) . '/migrations/*.sql') ?: [];
        foreach ($all as $f) {
            if (basename($f) < '005') {
                copy($f, $dir . '/' . basename($f));
            }
        }
        $file = $dir . '/test.sqlite';
        $old = new Database($file, $dir);
        $old->exec("INSERT INTO events (code, title, status, created_at) VALUES ('ABCDEF', 'Vanha', 'open', 1)");
        $old->exec("INSERT INTO poll_sets (event_id, slug, title, position, created_at) VALUES (1, 'M1', 'M1', 1, 1)");
        $old->exec("INSERT INTO polls (event_id, set_id, position, type, prompt, status, created_at, updated_at) VALUES (1, 1, 1, 'single', 'Q', 'open', 1, 1)");
        $old->exec("INSERT INTO poll_answers (poll_id, voter_hash, ciphertext, created_at) VALUES (1, 'h1', 'x', 1), (1, 'h2', 'y', 1)");
        unset($old);

        $new = new Database($file, dirname(__DIR__, 2) . '/migrations');
        self::assertSame(2, (int) ($new->one('SELECT COUNT(*) AS n FROM poll_answers')['n'] ?? 0), 'Vastaukset säilyvät');
        self::assertSame('Q', $new->one('SELECT prompt FROM polls WHERE id = 1')['prompt'] ?? null);
        self::assertSame(1, (int) ($new->one('PRAGMA foreign_keys')['foreign_keys'] ?? 0), 'Viiteavaimet takaisin päällä');
        $new->exec("INSERT INTO polls (event_id, set_id, type, prompt, created_at, updated_at) VALUES (1, 1, 'open', 'Avoin?', 1, 1)");
        $new->exec('DELETE FROM polls WHERE id = 1');
        self::assertSame(0, (int) ($new->one('SELECT COUNT(*) AS n FROM poll_answers')['n'] ?? -1), 'ON DELETE CASCADE toimii uudessa taulussa');
        array_map('unlink', glob($dir . '/*') ?: []);
        rmdir($dir);
    }

    /** Migraatio 004 siirtää aiemmat kyselyt oletussarjaan ja sulkee monta yhtä aikaa auki ollutta. */
    public function testMigrationMovesExistingPollsToDefaultSet(): void
    {
        $dir = sys_get_temp_dir() . '/hessutalks-migr-' . bin2hex(random_bytes(4));
        mkdir($dir);
        $all = glob(dirname(__DIR__, 2) . '/migrations/*.sql') ?: [];
        sort($all);
        foreach ($all as $f) {
            if (basename($f) < '004') {
                copy($f, $dir . '/' . basename($f));
            }
        }
        $file = $dir . '/test.sqlite';
        $old = new Database($file, $dir);
        $old->exec("INSERT INTO events (code, title, status, created_at) VALUES ('ABCDEF', 'Vanha', 'open', 1)");
        foreach (['open', 'open', 'draft'] as $i => $status) {
            $old->exec("INSERT INTO polls (event_id, type, prompt, status, created_at, updated_at) VALUES (1, 'words', ?, ?, 1, 1)", ['Q' . $i, $status]);
        }
        unset($old);

        $new = new Database($file, dirname(__DIR__, 2) . '/migrations');
        $set = $new->one("SELECT * FROM poll_sets WHERE event_id = 1");
        self::assertSame('KYSELYT', $set['slug'] ?? null);
        $rows = $new->all('SELECT set_id, position, status FROM polls ORDER BY id');
        self::assertSame([(int) $set['id']], array_values(array_unique(array_map('intval', array_column($rows, 'set_id')))));
        self::assertSame([1, 2, 3], array_map('intval', array_column($rows, 'position')));
        self::assertSame(['closed', 'closed', 'draft'], array_column($rows, 'status'));
        array_map('unlink', glob($dir . '/*') ?: []);
        rmdir($dir);
    }
}
