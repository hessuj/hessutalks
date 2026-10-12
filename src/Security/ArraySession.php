<?php

declare(strict_types=1);

namespace HessuTalks\Security;

/** Muistissa toimiva istunto testejä varten. */
final class ArraySession implements Session
{
    /** @var array<string, mixed> */
    public array $data = [];
    public int $regenerations = 0;
    private bool $started = false;

    public function start(): void
    {
        $this->started = true;
    }

    public function get(string $key): mixed
    {
        return $this->data[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $this->data[$key] = $value;
    }

    public function remove(string $key): void
    {
        unset($this->data[$key]);
    }

    public function regenerate(): void
    {
        $this->regenerations++;
    }

    public function destroy(): void
    {
        $this->data = [];
        $this->started = false;
    }

    public function isStarted(): bool
    {
        return $this->started;
    }
}
