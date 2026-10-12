<?php

declare(strict_types=1);

namespace HessuTalks\Security;

use HessuTalks\Http\Response;

/**
 * Tiukat HTTP-turvaotsakkeet jokaiseen vastaukseen.
 * - CSP ei salli inline-skriptejä eikä ulkoisia lähteitä.
 * - 'wasm-unsafe-eval' tarvitaan libsodiumin WebAssembly-moduulille (ei salli eval()-kutsua).
 */
final class SecurityHeaders
{
    public const CSP = "default-src 'none'; "
        . "script-src 'self' 'wasm-unsafe-eval'; "
        . "style-src 'self'; "
        . "img-src 'self' data:; "
        . "font-src 'self'; "
        . "connect-src 'self'; "
        . "manifest-src 'self'; "
        . "base-uri 'none'; "
        . "form-action 'self'; "
        . "frame-ancestors 'none'; "
        . "object-src 'none'";

    public static function apply(Response $response, bool $https): Response
    {
        $response
            ->withHeader('Content-Security-Policy', self::CSP . ($https ? '; upgrade-insecure-requests' : ''))
            ->withHeader('X-Content-Type-Options', 'nosniff')
            ->withHeader('X-Frame-Options', 'DENY')
            ->withHeader('Referrer-Policy', 'no-referrer')
            ->withHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()')
            ->withHeader('Cross-Origin-Opener-Policy', 'same-origin')
            ->withHeader('Cross-Origin-Embedder-Policy', 'require-corp')
            ->withHeader('Cross-Origin-Resource-Policy', 'same-origin')
            ->withHeader('Cache-Control', 'no-store, max-age=0')
            ->withHeader('X-Robots-Tag', 'noindex, nofollow');

        if ($https) {
            $response->withHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }
}
