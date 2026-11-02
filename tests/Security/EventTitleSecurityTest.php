<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use HessuTalks\Tests\Support\AppTestCase;

/**
 * Luennon otsikon muokkaus (esim. kirjoitusvirhe tuotannossa 2.11.): vain kirjautunut ylläpitäjä CSRF-tokenilla,
 * samat rajat kuin luonnissa, ohjausmerkit pois, ja osallistujan sivu näyttää otsikon aina escapoituna.
 * Liittymiskoodi ei muutu, joten diojen QR-koodit toimivat edelleen.
 */
final class EventTitleSecurityTest extends AppTestCase
{
    public function testTitleCanBeEditedOnlyWithLoginAndCsrf(): void
    {
        $event = $this->createEvent('Moder Management of IT');
        $id = (int) $event['id'];
        $path = '/admin/api/events/' . $id . '/title';

        $token = $this->loginAdmin();
        self::assertSame(403, $this->request('POST', $path, ['title' => 'Ilman tokenia'])->status, 'CSRF-token vaaditaan');

        $r = $this->request('POST', $path, ['title' => '  Modern Management of IT  '], ['X-CSRF-Token' => $token]);
        self::assertSame(200, $r->status);
        self::assertSame('Modern Management of IT', $this->json($r)['event']['title']);
        self::assertSame($event['code'], $this->json($r)['event']['code'], 'Koodi ja QR pysyvät samoina');
    }

    public function testInvalidTitlesAreRejected(): void
    {
        $id = (int) $this->createEvent()['id'];
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        foreach (['', '   ', str_repeat('x', 121), 123, null, ['a']] as $bad) {
            self::assertSame(422, $this->request('POST', '/admin/api/events/' . $id . '/title', ['title' => $bad], $h)->status, var_export($bad, true));
        }
        $r = $this->request('POST', '/admin/api/events/' . $id . '/title', ['title' => "Rivi\nvaihto\u{202E}ja ohjaus"], $h);
        self::assertSame(200, $r->status);
        self::assertStringNotContainsString("\n", $this->json($r)['event']['title'], 'Ohjausmerkit pois');
        self::assertStringNotContainsString("\u{202E}", $this->json($r)['event']['title']);
    }

    public function testTitleIsEscapedOnParticipantPage(): void
    {
        $this->createKeys();
        $event = $this->createEvent();
        $h = ['X-CSRF-Token' => $this->loginAdmin()];
        $xss = '<script>alert(1)</script><img src=x onerror=alert(2)>';
        self::assertSame(200, $this->request('POST', '/admin/api/events/' . $event['id'] . '/title', ['title' => $xss], $h)->status);
        $body = $this->request('GET', '/k/' . $event['code'])->body;
        self::assertStringNotContainsString('<script>alert(1)', $body);
        self::assertStringNotContainsString('<img src=x', $body);
        self::assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $body);
    }
}
