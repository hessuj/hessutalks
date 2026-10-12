<?php

declare(strict_types=1);

namespace HessuTalks\Security;

/**
 * Ylläpitäjän istunto. Osallistujat eivät saa evästeitä lainkaan.
 */
interface Session
{
    public function start(): void;

    public function get(string $key): mixed;

    public function set(string $key, mixed $value): void;

    public function remove(string $key): void;

    /** Vaihtaa istuntotunnisteen (session fixation -suojaus). */
    public function regenerate(): void;

    public function destroy(): void;

    public function isStarted(): bool;
}
