<?php

declare(strict_types=1);

namespace HessuTalks\Security;

final class Clock
{
    private ?int $fixed = null;

    public function now(): int
    {
        return $this->fixed ?? time();
    }

    /** Testejä varten. */
    public function freeze(int $ts): void
    {
        $this->fixed = $ts;
    }

    public function advance(int $seconds): void
    {
        $this->fixed = $this->now() + $seconds;
    }
}
