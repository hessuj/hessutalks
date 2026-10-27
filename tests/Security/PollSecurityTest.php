<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\Repository\LiveRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\SetRepository;
use HessuTalks\Tests\Support\AppTestCase;

/**
 * Kyselyiden tietoturva: vastaukset vain salattuina avoimeen kyselyyn, ei henkilötietoja eikä
 * evästeitä, osallistuja näkee vain avoimet kyselyt, ja hallinnan reitit vaativat kirjautumisen.
 */
final class PollSecurityTest extends AppTestCase
{
    private string $code;
    private int $eventId;
    private string $token;
    private int $setId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->createKeys();
        $event = $this->createEvent();
        $this->code = (string) $event['code'];
        $this->eventId = (int) $event['id'];
        $this->token = $this->formToken($this->code);
        $this->setId = $this->set($this->eventId, 'M1');
    }

    private function set(int $eventId, string $slug): int
    {
        $id = (new SetRepository($this->db, $this->clock))->create($eventId, $slug, 'Sarja ' . $slug);
        self::assertIsInt($id);
        return $id;
    }

    private static function voter(string $seed = 'v'): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $seed, true)), '+/', '-_'), '=');
    }

    /** @param array<string, mixed> $config */
    private function poll(string $status = 'open', string $type = 'single', array $config = ['options' => ['A', 'B']], ?int $eventId = null): int
    {
        $repo = new PollRepository($this->db, $this->clock, str_repeat('ab', 32));
        $valid = PollRepository::validate($type, 'Kysymys?', $config);
        self::assertIsArray($valid);
        $event = $eventId ?? $this->eventId;
        $id = (int) $repo->create($event, $eventId === null ? $this->setId : $this->set($event, 'S' . random_int(1, 99999)), $type, $valid[0], $valid[1]);
        // Avoin kysely on aina luennon aktiivinen kysymys.
        if ($status === 'open') {
            (new LiveRepository($this->db))->open($event, $id);
        } else {
            $repo->setStatus($id, $status);
        }
        return $id;
    }

    /** @param array<string, mixed> $extra */
    private function answer(int $poll, array $extra = []): \HessuTalks\Http\Response
    {
        return $this->request('POST', '/api/polls/answer', $extra + [
            'code' => $this->code, 'token' => $this->token, 'poll' => $poll,
            'voter' => self::voter(), 'ciphertext' => $this->seal('{"v":1,"p":' . $poll . ',"a":0}'),
        ]);
    }

    public function testParticipantSeesOnlyActivePollWithoutAnswers(): void
    {
        $r = $this->request('GET', '/api/live?code=' . $this->code);
        self::assertSame(200, $r->status);
        self::assertNull($this->json($r)['poll'], 'Ei aktiivista kysymystä: odotusnäkymä');

        $this->poll('draft', 'words', []);
        $open = $this->poll('open');
        self::assertSame(201, $this->answer($open)->status);

        $r = $this->request('GET', '/api/live?code=' . $this->code);
        $data = $this->json($r);
        self::assertSame($open, $data['poll']['id']);
        self::assertSame('open', $data['poll']['status']);
        self::assertSame(['id', 'type', 'prompt', 'config', 'generation', 'status'], array_keys($data['poll']));
        self::assertStringNotContainsString('ciphertext', $r->body);
        self::assertStringNotContainsString('voter', $r->body);
        self::assertStringNotContainsString('answer', $r->body);

        $same = $this->request('GET', '/api/live?code=' . $this->code . '&v=' . $data['v']);
        self::assertSame(['v' => $data['v'], 'unchanged' => true], $this->json($same));
        self::assertSame(405, $this->request('POST', '/api/live', ['code' => $this->code])->status);
    }

    public function testUnknownOrClosedEventPolls(): void
    {
        self::assertSame(404, $this->request('GET', '/api/live?code=ZZZZZZ')->status);
        self::assertSame(404, $this->request('GET', '/api/live?code=%3Cscript%3E')->status);
        $this->db->exec("UPDATE events SET status = 'closed' WHERE id = ?", [$this->eventId]);
        self::assertSame(410, $this->request('GET', '/api/live?code=' . $this->code)->status);
    }

    public function testAnswerStoresOnlyCiphertextAndNoVoterSecret(): void
    {
        $poll = $this->poll();
        $voter = self::voter('salainen-tunniste');
        self::assertSame(201, $this->answer($poll, ['voter' => $voter])->status);
        $dump = (string) json_encode($this->db->all('SELECT * FROM poll_answers')) . json_encode($this->db->all('SELECT * FROM rate_limits'));
        self::assertStringNotContainsString($voter, $dump);
        self::assertStringNotContainsString('203.0.113.7', $dump, 'IP-osoitetta ei tallenneta');
    }

    public function testSameBrowserReplacesItsAnswer(): void
    {
        $poll = $this->poll();
        $this->answer($poll);
        $this->answer($poll);
        $this->answer($poll, ['voter' => self::voter('toinen')]);
        self::assertSame(2, (int) ($this->db->one('SELECT COUNT(*) AS n FROM poll_answers')['n'] ?? 0));
    }

    public function testAnswerRequiresOpenPollOfThisEvent(): void
    {
        self::assertSame(409, $this->answer($this->poll('draft'))->status);
        self::assertSame(409, $this->answer($this->poll('closed'))->status);
        $notActive = $this->poll('draft');
        (new PollRepository($this->db, $this->clock, str_repeat('ab', 32)))->setStatus($notActive, 'open');
        self::assertSame(409, $this->answer($notActive)->status, 'Auki mutta ei aktiivinen: ei vastauksia');
        self::assertSame(409, $this->answer(999999)->status);
        self::assertSame(409, $this->answer(0, ['poll' => '1'])->status, 'Kyselyn id:n pitää olla kokonaisluku');

        $other = $this->createEvent('Toinen');
        $foreign = $this->poll('open', 'single', ['options' => ['A', 'B']], (int) $other['id']);
        self::assertSame(409, $this->answer($foreign)->status, 'Toisen luennon kyselyyn ei voi vastata tämän luennon lomakkeella');
        self::assertSame(0, (int) ($this->db->one('SELECT COUNT(*) AS n FROM poll_answers')['n'] ?? -1));
    }

    public function testAnswerRequiresTokenOriginAndCiphertext(): void
    {
        $poll = $this->poll();
        self::assertSame(403, $this->answer($poll, ['token' => 'vaara'])->status);
        self::assertSame(403, $this->request('POST', '/api/polls/answer', [
            'code' => $this->code, 'token' => $this->token, 'poll' => $poll, 'voter' => self::voter(), 'ciphertext' => $this->seal('x'),
        ], ['Origin' => 'https://evil.example'])->status);
        self::assertSame(422, $this->answer($poll, ['ciphertext' => base64_encode('{"a":0}')])->status, 'Selväkielinen vastaus hylätään');
        self::assertSame(422, $this->answer($poll, ['ciphertext' => base64_encode(random_bytes(PollRepository::CIPHERTEXT_MAX_BYTES + 10))])->status);
        self::assertSame(422, $this->answer($poll, ['voter' => 'lyhyt'])->status);
        self::assertSame(405, $this->request('GET', '/api/polls/answer')->status);
    }

    public function testAnswerRateLimitPerVoter(): void
    {
        $poll = $this->poll();
        for ($i = 0; $i < 30; $i++) {
            self::assertSame(201, $this->answer($poll)->status);
        }
        self::assertSame(429, $this->answer($poll)->status);
        self::assertSame(201, $this->answer($poll, ['voter' => self::voter('toinen')])->status);
    }

    public function testPollEndpointsSetNoCookies(): void
    {
        $poll = $this->poll();
        foreach ([$this->request('GET', '/api/live?code=' . $this->code), $this->answer($poll)] as $r) {
            self::assertArrayNotHasKey('Set-Cookie', $r->headers);
        }
        self::assertFalse($this->session->isStarted());
    }

    /** @return iterable<array{string, string}> */
    public static function adminRoutes(): iterable
    {
        yield ['GET', '/admin/api/events/1/polls'];
        yield ['POST', '/admin/api/events/1/polls'];
        yield ['GET', '/admin/api/events/1/poll-answers'];
        yield ['POST', '/admin/api/polls/1/update'];
        yield ['POST', '/admin/api/polls/1/status'];
        yield ['POST', '/admin/api/polls/1/reset'];
        yield ['POST', '/admin/api/polls/1/delete'];
        yield ['POST', '/admin/api/polls/1/move'];
        yield ['POST', '/admin/api/events/1/sets'];
        yield ['POST', '/admin/api/events/1/live'];
        yield ['POST', '/admin/api/events/1/lang'];
        yield ['POST', '/admin/api/sets/1/update'];
        yield ['POST', '/admin/api/sets/1/move'];
        yield ['POST', '/admin/api/sets/1/skip'];
        yield ['POST', '/admin/api/sets/1/delete'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('adminRoutes')]
    public function testAdminPollRoutesRequireLogin(string $method, string $path): void
    {
        $this->poll();
        $this->session->start();
        $this->session->set('csrf', str_repeat('c', 64));
        $r = $this->request($method, $path, $method === 'POST' ? ['status' => 'open'] : null, ['X-CSRF-Token' => str_repeat('c', 64)]);
        self::assertSame(401, $r->status, $path);
        self::assertStringNotContainsString('ciphertext', $r->body);
    }

    public function testAdminCanManagePollsAndReadCiphertexts(): void
    {
        $csrf = $this->loginAdmin();
        $h = ['X-CSRF-Token' => $csrf];
        self::assertSame(403, $this->request('POST', '/admin/api/events/' . $this->eventId . '/polls', ['type' => 'words', 'prompt' => 'X?'])->status, 'CSRF vaaditaan');
        self::assertSame(422, $this->request('POST', '/admin/api/events/' . $this->eventId . '/polls', ['type' => 'eval', 'prompt' => 'X?'], $h)->status);

        $likert = ['type' => 'likert', 'prompt' => 'Samaa mieltä?', 'config' => ['points' => 5, 'min_label' => 'Ei', 'max_label' => 'Kyllä']];
        self::assertSame(422, $this->request('POST', '/admin/api/events/' . $this->eventId . '/polls', $likert, $h)->status, 'Sarja vaaditaan');
        $foreignSet = $this->set((int) $this->createEvent('Toinen')['id'], 'X');
        self::assertSame(422, $this->request('POST', '/admin/api/events/' . $this->eventId . '/polls', $likert + ['set_id' => $foreignSet], $h)->status, 'Toisen luennon sarja');

        $r = $this->request('POST', '/admin/api/events/' . $this->eventId . '/polls', $likert + ['set_id' => $this->setId], $h);
        self::assertSame(201, $r->status, $r->body);
        $poll = $this->json($r)['poll'];
        self::assertSame('draft', $poll['status']);
        self::assertSame($this->setId, $poll['set_id']);
        self::assertStringEndsWith('/k/' . $this->code, $poll['url'], 'Kyselyn linkki on luennon linkki');

        self::assertSame(200, $this->request('POST', '/admin/api/polls/' . $poll['id'] . '/status', ['status' => 'open'], $h)->status);
        self::assertSame(422, $this->request('POST', '/admin/api/polls/' . $poll['id'] . '/status', ['status' => 'x'], $h)->status);
        self::assertSame(201, $this->answer((int) $poll['id'])->status);

        $answers = $this->json($this->request('GET', '/admin/api/events/' . $this->eventId . '/poll-answers?after=0'));
        self::assertCount(1, $answers['answers']);
        self::assertSame(16, strlen($answers['answers'][0]['voter']));
        $opened = sodium_crypto_box_seal_open(base64_decode($answers['answers'][0]['ciphertext']), $this->keypair);
        self::assertSame('{"v":1,"p":' . $poll['id'] . ',"a":0}', $opened);

        self::assertSame(200, $this->request('POST', '/admin/api/polls/' . $poll['id'] . '/reset', [], $h)->status);
        $after = $this->json($this->request('GET', '/admin/api/events/' . $this->eventId . '/poll-answers?after=0'));
        self::assertSame([], $after['answers']);
        self::assertSame(2, $after['generations'][(string) $poll['id']]);
        self::assertSame(200, $this->request('POST', '/admin/api/polls/' . $poll['id'] . '/delete', [], $h)->status);
        self::assertSame(404, $this->request('POST', '/admin/api/polls/' . $poll['id'] . '/status', ['status' => 'open'], $h)->status);
    }

    public function testPollPromptIsNotRenderedAsHtmlOnServer(): void
    {
        $repo = new PollRepository($this->db, $this->clock, str_repeat('ab', 32));
        $id = (int) $repo->create($this->eventId, $this->setId, 'words', '<img src=x onerror=alert(1)>', []);
        (new LiveRepository($this->db))->open($this->eventId, $id);
        self::assertStringNotContainsString('<img', $this->request('GET', '/k/' . $this->code)->body);
        // JSON-vastauksessa teksti on dataa; selain lisää sen DOMiin vain textContentilla (testattu alla).
        self::assertStringContainsString('application/json', $this->request('GET', '/api/live?code=' . $this->code)->headers['Content-Type'] ?? '');
    }

    public function testAdminControlsSetsAndActiveQuestion(): void
    {
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $base = '/admin/api/events/' . $this->eventId;
        self::assertSame(422, $this->request('POST', $base . '/sets', ['slug' => '<b>', 'title' => 'X'], $h)->status, 'Tunniste ei voi sisältää HTML:ää');
        self::assertSame(409, $this->request('POST', $base . '/sets', ['slug' => 'm1', 'title' => 'Sama'], $h)->status, 'Tunniste on uniikki');
        $r = $this->request('POST', $base . '/sets', ['slug' => 'm2', 'title' => 'Moduuli 2'], $h);
        self::assertSame(201, $r->status, $r->body);
        $m2 = $this->json($r)['sets'][1]['id'];
        self::assertSame('M2', $this->json($r)['sets'][1]['slug']);

        $a = $this->poll('draft');
        $b = (int) (new PollRepository($this->db, $this->clock, str_repeat('ab', 32)))->create($this->eventId, $m2, 'words', 'Sana?', []);
        $live = fn (array $body): array => $this->json($this->request('POST', $base . '/live', $body, $h));
        self::assertSame($a, $live(['action' => 'next'])['active']);
        self::assertSame($b, $live(['action' => 'next'])['active']);
        self::assertSame(409, $this->request('POST', $base . '/live', ['action' => 'next'], $h)->status, 'Viimeisen jälkeen');
        self::assertNull($live(['action' => 'activate', 'poll' => null])['active']);
        self::assertSame(422, $this->request('POST', $base . '/live', ['action' => 'drop'], $h)->status);

        // Ohitetun sarjan kysymykset jäävät pois järjestyksestä.
        self::assertSame(422, $this->request('POST', '/admin/api/sets/' . $m2 . '/skip', ['skipped' => 'yes'], $h)->status);
        self::assertSame(200, $this->request('POST', '/admin/api/sets/' . $m2 . '/skip', ['skipped' => true], $h)->status);
        self::assertSame($a, $live(['action' => 'next'])['active']);
        self::assertSame(409, $this->request('POST', $base . '/live', ['action' => 'next'], $h)->status);

        // Toisen luennon kyselyä ei voi aktivoida tämän luennon kautta.
        $foreign = $this->poll('draft', 'words', [], (int) $this->createEvent('Toinen')['id']);
        self::assertSame(404, $this->request('POST', $base . '/live', ['action' => 'activate', 'poll' => $foreign], $h)->status);

        // Avaaminen tekee aktiiviseksi; sarjan poisto poistaa kysymykset ja aktiivisuuden.
        self::assertSame(200, $this->request('POST', '/admin/api/polls/' . $b . '/status', ['status' => 'open'], $h)->status);
        self::assertSame($b, $this->json($this->request('GET', $base . '/polls'))['active']);
        self::assertSame(200, $this->request('POST', '/admin/api/sets/' . $m2 . '/delete', [], $h)->status);
        $state = $this->json($this->request('GET', $base . '/polls'));
        self::assertNull($state['active']);
        self::assertSame([$a], array_column($state['polls'], 'id'));
        self::assertNull($this->json($this->request('GET', '/api/live?code=' . $this->code))['poll']);
    }

    /** H11: luento suljetaan perjantaina ja avataan lauantaina: sama koodi toimii ja tulokset säilyvät. */
    public function testEventCanBeClosedAndReopenedWithAnswersKept(): void
    {
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $friday = $this->poll('open');
        self::assertSame(201, $this->answer($friday)->status);

        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $this->eventId . '/status', ['status' => 'closed'], $h)->status);
        self::assertSame(410, $this->request('GET', '/k/' . $this->code)->status, 'Suljettu luento');
        self::assertSame(410, $this->request('GET', '/api/live?code=' . $this->code)->status);
        self::assertSame(410, $this->answer($friday)->status, 'Suljetulle luennolle ei voi vastata');

        // Lauantaina ylläpidon istunto on vanhentunut (enintään 8 h): kirjaudutaan uudelleen.
        $this->clock->freeze($this->clock->now() + 17 * 3600);
        self::assertSame(401, $this->request('POST', '/admin/api/events/' . $this->eventId . '/status', ['status' => 'open'], $h)->status);
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $this->eventId . '/status', ['status' => 'open'], $h)->status);
        self::assertSame(200, $this->request('GET', '/k/' . $this->code)->status, 'Sama koodi toimii lauantaina');
        $answers = $this->json($this->request('GET', '/admin/api/events/' . $this->eventId . '/poll-answers?after=0'));
        self::assertCount(1, $answers['answers'], 'Perjantain vastaukset tallessa');
        self::assertSame($friday, $answers['answers'][0]['poll_id']);
    }

    public function testEventLanguageIsDefaultForParticipants(): void
    {
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $fi = ['Accept-Language' => 'fi-FI,fi;q=0.9'];
        self::assertStringContainsString('<html lang="fi"', $this->request('GET', '/k/' . $this->code, null, $fi)->body);
        self::assertSame(422, $this->request('POST', '/admin/api/events/' . $this->eventId . '/lang', ['lang' => 'sv'], $h)->status);
        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $this->eventId . '/lang', ['lang' => 'en'], $h)->status);
        self::assertStringContainsString('<html lang="en"', $this->request('GET', '/k/' . $this->code, null, $fi)->body, 'Luennon kieli voittaa selaimen kielen');
        self::assertStringContainsString('<html lang="fi"', $this->request('GET', '/k/' . $this->code . '?lang=fi', null, $fi)->body, 'Osallistujan oma valinta voittaa');
    }

    public function testBrowserScriptsNeverUseHtmlInjectionSinks(): void
    {
        foreach (glob(dirname(__DIR__, 2) . '/public/assets/js/*.js') ?: [] as $file) {
            $js = (string) file_get_contents($file);
            self::assertSame(0, preg_match('/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(/', $js), basename($file));
            self::assertSame(0, preg_match('/postMessage\([^)]*[\'"]\*[\'"]/', $js), basename($file) . ': postMessage vain omaan originiin');
        }
    }
}
