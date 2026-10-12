<?php

declare(strict_types=1);

namespace HessuTalks\Security;

final class NativeSession implements Session
{
    public function __construct(
        private readonly string $savePath,
        private readonly string $cookiePath,
        private readonly bool $secure,
    ) {
    }

    public function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        if (!is_dir($this->savePath)) {
            mkdir($this->savePath, 0700, true);
        }
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.gc_maxlifetime', '28800');
        session_save_path($this->savePath);
        // __Host-etuliite: vain HTTPS, ei Domain-attribuuttia, polku "/".
        session_name($this->secure ? '__Host-hessutalks' : 'hessutalks_dev');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => $this->secure ? '/' : ($this->cookiePath === '' ? '/' : $this->cookiePath),
            'secure' => $this->secure,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
    }

    public function get(string $key): mixed
    {
        return $_SESSION[$key] ?? null;
    }

    public function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public function remove(string $key): void
    {
        unset($_SESSION[$key]);
    }

    public function regenerate(): void
    {
        session_regenerate_id(true);
    }

    public function destroy(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            $p = session_get_cookie_params();
            setcookie((string) session_name(), '', [
                'expires' => time() - 3600,
                'path' => $p['path'],
                'secure' => $p['secure'],
                'httponly' => true,
                'samesite' => 'Strict',
            ]);
            session_destroy();
        }
    }

    public function isStarted(): bool
    {
        return session_status() === PHP_SESSION_ACTIVE;
    }
}
