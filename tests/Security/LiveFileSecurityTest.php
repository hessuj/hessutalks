<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\App;
use HessuTalks\Repository\LiveFile;
use HessuTalks\Repository\LiveRepository;
use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\SetRepository;
use HessuTalks\Tests\Support\AppTestCase;

/**
 * Osallistujien tilatiedosto (public/live/): Apache palvelee sen ilman PHP:tä (vaatimus 8, 150 osallistujaa).
 * Tiedostossa saa olla vain sama julkinen tila kuin /api/live-vastauksessa, nimen pitää olla arvaamaton,
 * ja suljetun tai poistetun luennon tila ei saa jäädä tiedostoon.
 */
final class LiveFileSecurityTest extends AppTestCase
{
    private string $dir;
    private string $code;
    private int $eventId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dir = sys_get_temp_dir() . '/hessutalks-live-' . bin2hex(random_bytes(6));
        $this->app = new App($this->config, $this->db, $this->session, $this->webauthn, $this->clock, dirname(__DIR__, 2), $this->dir);
        $this->createKeys();
        $event = $this->createEvent();
        $this->code = (string) $event['code'];
        $this->eventId = (int) $event['id'];
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                unlink($f);
            }
        }
        if (is_dir($this->dir)) {
            rmdir($this->dir);
        }
        parent::tearDown();
    }

    private function fileName(): string
    {
        $body = $this->request('GET', '/k/' . $this->code)->body;
        self::assertSame(1, preg_match('#data-live-file="/softa/hessutalks/live/([0-9a-f]{32}\.json)"#', $body, $m), 'Luennon sivu antaa tilatiedoston');
        return $m[1];
    }

    /** @return array<string, mixed> */
    private function file(): array
    {
        $json = file_get_contents($this->dir . '/' . $this->fileName());
        self::assertIsString($json);
        $data = json_decode($json, true);
        self::assertIsArray($data);
        return $data;
    }

    /** @param array<string, mixed> $config */
    private function openPoll(array $config): int
    {
        $setId = (int) (new SetRepository($this->db, $this->clock))->create($this->eventId, 'm1', 'M1');
        $repo = new PollRepository($this->db, $this->clock, str_repeat('ab', 32));
        $valid = PollRepository::validate('single', 'Mikä on oikein?', $config);
        self::assertIsArray($valid);
        $id = (int) $repo->create($this->eventId, $setId, 'single', $valid[0], $valid[1]);
        (new LiveRepository($this->db, new LiveFile($this->dir, $this->config->appSecret)))->open($this->eventId, $id);
        return $id;
    }

    public function testFileNameIsUnguessableAndContainsOnlyPublicState(): void
    {
        $name = $this->fileName();
        self::assertStringNotContainsStringIgnoringCase($this->code, $name);
        self::assertNotSame((new LiveFile($this->dir, str_repeat('cd', 32)))->name($this->eventId), $name, 'Nimi riippuu salaisesta avaimesta');
        self::assertSame(0644, fileperms($this->dir . '/' . $name) & 0777, 'Apache lukee, muut eivät kirjoita');
        self::assertSame(['v', 'poll', 'closed', 'closes_at'], array_keys($this->file()));
        self::assertNull($this->file()['poll']);
        self::assertFalse($this->file()['closed']);
        self::assertSame([], glob($this->dir . '/.*.json.*') ?: [], 'Ei väliaikaistiedostoja');
    }

    public function testFileEqualsApiLiveAndHidesAnswerKeyUntilReveal(): void
    {
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $poll = $this->openPoll(['options' => ['A', 'B', 'C'], 'correct' => [1], 'explanations' => ['Ei', 'Kyllä – oikein', 'Ei']]);
        $api = $this->json($this->request('GET', '/api/live?code=' . $this->code));
        self::assertSame($api['v'], $this->file()['v']);
        self::assertSame($api['poll'], $this->file()['poll'], 'Sama sisältö kuin /api/live');
        self::assertStringNotContainsString('Kyllä – oikein', (string) json_encode($this->file(), JSON_UNESCAPED_UNICODE), 'Ei selityksiä ennen paljastusta');
        self::assertNull($this->file()['poll']['reveal']);

        // Salatut vastaukset eivät päädy tiedostoon.
        $voter = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $sealed = $this->seal('{"v":1,"p":' . $poll . ',"a":1}');
        self::assertSame(201, $this->request('POST', '/api/polls/answer', [
            'code' => $this->code, 'token' => $this->formToken($this->code), 'poll' => $poll, 'voter' => $voter, 'ciphertext' => $sealed,
        ])->status);
        $raw = (string) file_get_contents($this->dir . '/' . $this->fileName());
        self::assertStringNotContainsString(substr($sealed, 0, 40), $raw);
        self::assertStringNotContainsString($voter, $raw);

        // Paljastus päivittää tiedoston heti (versio kasvaa).
        $before = $this->file()['v'];
        self::assertSame(200, $this->request('POST', '/admin/api/polls/' . $poll . '/reveal', ['revealed' => true], $h)->status);
        self::assertGreaterThan($before, $this->file()['v']);
        self::assertSame(['correct' => [1], 'explanations' => ['Ei', 'Kyllä – oikein', 'Ei']], $this->file()['poll']['reveal']);
        self::assertSame(['options'], array_keys($this->file()['poll']['config']), 'config pysyy julkisena');
    }

    public function testClosedEventFileHasNoPollAndDeletedEventFileIsRemoved(): void
    {
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $this->openPoll(['options' => ['A', 'B']]);
        $name = $this->fileName();
        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $this->eventId . '/status', ['status' => 'closed'], $h)->status);
        $data = json_decode((string) file_get_contents($this->dir . '/' . $name), true);
        self::assertTrue($data['closed']);
        self::assertNull($data['poll'], 'Suljetun luennon kysymys ei jää tiedostoon');
        self::assertSame(410, $this->request('GET', '/api/live?code=' . $this->code)->status, 'Selain kysyy syyn PHP:ltä');

        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $this->eventId . '/delete', [], $h)->status);
        self::assertFileDoesNotExist($this->dir . '/' . $name, 'Poisto poistaa myös tilatiedoston (vaatimus 7.8)');
    }

    public function testEventPageReplacesStaleFile(): void
    {
        // Esim. palautettu tietokanta tai uudelleen käytetty luennon id: samannimisessä tiedostossa vanha tila.
        $name = $this->fileName();
        file_put_contents($this->dir . '/' . $name, '{"v":999,"poll":{"id":1,"prompt":"Vanha kysymys"},"closed":false,"closes_at":null}');
        $this->fileName();
        self::assertSame(0, $this->file()['v']);
        self::assertNull($this->file()['poll'], 'Luennon sivu kirjoittaa ajantasaisen tilan');
    }

    public function testUnwritableDirectoryFallsBackToApi(): void
    {
        $blocker = $this->dir . '-tiedosto';
        touch($blocker);   // hakemiston paikalla tavallinen tiedosto: kirjoitus epäonnistuu
        $this->app = new App($this->config, $this->db, $this->session, $this->webauthn, $this->clock, dirname(__DIR__, 2), $blocker);
        try {
            $body = $this->request('GET', '/k/' . $this->code)->body;
            self::assertStringContainsString('data-live-file=""', $body, 'Ei tiedostonimeä: selain käyttää /api/live-reittiä');
            self::assertSame(200, $this->request('GET', '/api/live?code=' . $this->code)->status);
        } finally {
            unlink($blocker);
        }
    }

    public function testApacheServesOnlyAppFilesWithoutPhpOrCache(): void
    {
        $htaccess = (string) file_get_contents(dirname(__DIR__, 2) . '/public/live/.htaccess');
        self::assertMatchesRegularExpression('/^RewriteEngine Off$/m', $htaccess, 'Puuttuva tiedosto ei ohjaudu PHP:lle');
        self::assertMatchesRegularExpression('/^Require all denied$/m', $htaccess);
        self::assertStringContainsString('<FilesMatch "^[0-9a-f]{32}\.json$">', $htaccess, 'Vain sovelluksen kirjoittamat nimet');
        self::assertStringContainsString('Header set Cache-Control "no-store"', $htaccess);
    }
}
