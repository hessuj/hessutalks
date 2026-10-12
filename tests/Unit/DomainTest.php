<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Unit;

use HessuTalks\Database;
use HessuTalks\Repository\EventRepository;
use HessuTalks\Repository\KeyRepository;
use HessuTalks\Repository\NicknameRepository;
use HessuTalks\Repository\QuestionRepository;
use HessuTalks\Security\Clock;
use HessuTalks\Security\FormToken;
use HessuTalks\Security\RateLimiter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DomainTest extends TestCase
{
    private Database $db;
    private Clock $clock;

    protected function setUp(): void
    {
        $this->db = new Database(':memory:', dirname(__DIR__, 2) . '/migrations');
        $this->clock = new Clock();
        $this->clock->freeze(1_800_000_000);
    }

    // ------------------------------------------------------------ luentokoodit

    public function testGeneratedCodesUseSafeAlphabet(): void
    {
        for ($i = 0; $i < 200; $i++) {
            $code = EventRepository::generateCode();
            self::assertSame(1, preg_match('/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/', $code), $code);
        }
    }

    /** @return iterable<array{string, ?string}> */
    public static function codeInputs(): iterable
    {
        yield ['abc234', 'ABC234'];
        yield [' ab c-234 ', 'ABC234'];
        yield ['ABC23', null];
        yield ['ABC2345', null];
        yield ['ABCD10', null];               // 1 ja 0 eivät kuulu aakkostoon
        yield ["' OR 1=1 --", null];
        yield ['ÄBC234', null];
    }

    #[DataProvider('codeInputs')]
    public function testNormalizeCode(string $in, ?string $expected): void
    {
        self::assertSame($expected, EventRepository::normalizeCode($in));
    }

    public function testEventTitleLengthIsValidated(): void
    {
        $repo = new EventRepository($this->db, $this->clock);
        $this->expectException(\InvalidArgumentException::class);
        $repo->create(str_repeat('x', 121), null);
    }

    public function testEventClosesAutomatically(): void
    {
        $repo = new EventRepository($this->db, $this->clock);
        $event = $repo->create('Luento', 2);
        self::assertTrue($repo->isOpen($event));
        $this->clock->advance(2 * 3600 + 1);
        self::assertFalse($repo->isOpen($event));
    }

    // ------------------------------------------------------------ nimimerkit

    /** @return iterable<array{mixed, ?string}> */
    public static function nicknames(): iterable
    {
        yield ['Kahvikuppi42', 'Kahvikuppi42'];
        yield ['  Äijä   _7 ', 'Äijä _7'];
        yield ['ab', 'ab'];
        yield ['a', null];
        yield [str_repeat('x', 25), null];
        yield ['etu.suku@example.com', null];   // ei sähköpostiosoitteita
        yield ['-alkaa-viivalla', null];
        yield ['<script>', null];
        yield ["rivin\nvaihto", 'rivin vaihto'];
        yield [123, null];
        yield [null, null];
    }

    #[DataProvider('nicknames')]
    public function testNicknameCleaning(mixed $in, ?string $expected): void
    {
        self::assertSame($expected, NicknameRepository::clean($in));
    }

    public function testNicknameUniquenessIsCaseAndSeparatorInsensitive(): void
    {
        self::assertSame(NicknameRepository::canonical('Kahvi Kuppi'), NicknameRepository::canonical('kahvi-kuppi'));
        self::assertSame(NicknameRepository::canonical('KAHVI_KUPPI'), NicknameRepository::canonical('kahvi.kuppi'));
        self::assertNotSame(NicknameRepository::canonical('kahvi1'), NicknameRepository::canonical('kahvi2'));
    }

    public function testNicknameClaimIsUniquePerEvent(): void
    {
        $events = new EventRepository($this->db, $this->clock);
        $a = (int) $events->create('A', null)['id'];
        $b = (int) $events->create('B', null)['id'];
        $nicks = new NicknameRepository($this->db, $this->clock, str_repeat('cd', 32));

        $claim = $nicks->claim($a, 'Kahvi Kuppi');
        self::assertNotNull($claim);
        self::assertNull($nicks->claim($a, 'kahvi-kuppi'), 'Sama nimimerkki samalla luennolla');
        self::assertNotNull($nicks->claim($b, 'Kahvi Kuppi'), 'Eri luennolla sama nimimerkki on sallittu');

        self::assertSame($claim['id'], $nicks->verify($a, 'KAHVI KUPPI', $claim['secret']));
        self::assertNull($nicks->verify($a, 'Kahvi Kuppi', strrev($claim['secret'])));
        self::assertNull($nicks->verify($b, 'Kahvi Kuppi', $claim['secret']), 'Omistajatunniste on luentokohtainen');
        self::assertNull($nicks->verify($a, 'Kahvi Kuppi', 'liian-lyhyt'));
    }

    public function testNicknameIsNotStoredInPlaintext(): void
    {
        $id = (int) (new EventRepository($this->db, $this->clock))->create('A', null)['id'];
        (new NicknameRepository($this->db, $this->clock, str_repeat('cd', 32)))->claim($id, 'Salainen Nimimerkki');
        $dump = json_encode($this->db->all('SELECT * FROM nicknames'));
        self::assertIsString($dump);
        self::assertStringNotContainsStringIgnoringCase('salainen', $dump);
    }

    // ------------------------------------------------------------ salattu data

    public function testCiphertextValidation(): void
    {
        $kp = sodium_crypto_box_keypair();
        $valid = base64_encode(sodium_crypto_box_seal('{"t":"moi"}', sodium_crypto_box_publickey($kp)));
        self::assertTrue(QuestionRepository::isValidCiphertext($valid));
        self::assertFalse(QuestionRepository::isValidCiphertext(base64_encode(random_bytes(48))), 'liian lyhyt');
        self::assertFalse(QuestionRepository::isValidCiphertext(base64_encode(random_bytes(16385))), 'liian pitkä');
        self::assertFalse(QuestionRepository::isValidCiphertext('selväkielinen kysymys'));
        self::assertFalse(QuestionRepository::isValidCiphertext($valid . '!'));
        self::assertFalse(QuestionRepository::isValidCiphertext(['array']));
    }

    public function testKeyValidationAndCreateOnce(): void
    {
        $repo = new KeyRepository($this->db, $this->clock);
        $good = [
            'public_key' => base64_encode(random_bytes(32)),
            'enc_secret_key' => base64_encode(random_bytes(48)),
            'nonce' => base64_encode(random_bytes(24)),
            'salt' => base64_encode(random_bytes(16)),
            'opslimit' => 3,
            'memlimit' => 67108864,
        ];
        self::assertNull(KeyRepository::validate($good));
        self::assertNotNull(KeyRepository::validate(['opslimit' => 1] + $good));
        self::assertNotNull(KeyRepository::validate(['memlimit' => 1024] + $good));
        self::assertNotNull(KeyRepository::validate(['public_key' => base64_encode(random_bytes(31))] + $good));
        self::assertTrue($repo->createOnce($good));
        self::assertFalse($repo->createOnce($good), 'Avaimia ei voi korvata');
        self::assertFalse($repo->rewrap(['public_key' => base64_encode(random_bytes(32))] + $good), 'Eri julkinen avain');
        self::assertTrue($repo->rewrap(['salt' => base64_encode(random_bytes(16))] + $good));
    }

    // ------------------------------------------------------------ tokenit ja rajoitin

    public function testFormToken(): void
    {
        $t = new FormToken(str_repeat('ef', 32), $this->clock);
        $token = $t->issue(5);
        self::assertTrue($t->verify($token, 5));
        self::assertFalse($t->verify($token, 6), 'Toinen luento');
        self::assertFalse($t->verify(substr($token, 0, -1) . (str_ends_with($token, 'a') ? 'b' : 'a'), 5), 'Muokattu');
        self::assertFalse($t->verify('9999999999.' . str_repeat('0', 64), 5), 'Väärennetty');
        $this->clock->advance(FormToken::TTL + 1);
        self::assertFalse($t->verify($token, 5), 'Vanhentunut');
    }

    public function testRateLimiterSlidingWindow(): void
    {
        $l = new RateLimiter($this->db, $this->clock);
        for ($i = 0; $i < 3; $i++) {
            self::assertTrue($l->hit('x', 3, 60));
        }
        self::assertFalse($l->hit('x', 3, 60));
        self::assertTrue($l->hit('y', 3, 60), 'Eri ämpäri');
        $this->clock->advance(61);
        self::assertTrue($l->hit('x', 3, 60));
    }
}
