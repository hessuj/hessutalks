<?php

declare(strict_types=1);

namespace HessuTalks;

use PDO;

/**
 * SQLite-yhteys. Kaikki kyselyt tehdään parametrisoituina (prepared statements).
 */
final class Database
{
    private PDO $pdo;

    public function __construct(string $path, private readonly string $migrationsDir)
    {
        if ($path !== ':memory:') {
            $dir = dirname($path);
            if (!is_dir($dir)) {
                mkdir($dir, 0700, true);
            }
            $isNew = !is_file($path);
        }
        $this->pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_STRINGIFY_FETCHES => false,
        ]);
        if (isset($isNew) && $isNew) {
            @chmod($path, 0600);
        }
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA busy_timeout = 5000');
        $this->pdo->exec('PRAGMA secure_delete = ON');
        if ($path !== ':memory:') {
            $this->pdo->exec('PRAGMA journal_mode = WAL');
        }
        $this->migrate();
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    /**
     * @param array<string|int, scalar|null> $params
     * @return list<array<string, mixed>>
     */
    public function all(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        /** @var list<array<string, mixed>> */
        return $st->fetchAll();
    }

    /**
     * @param array<string|int, scalar|null> $params
     * @return array<string, mixed>|null
     */
    public function one(string $sql, array $params = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string|int, scalar|null> $params */
    public function exec(string $sql, array $params = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public function lastId(): int
    {
        return (int) $this->pdo->lastInsertId();
    }

    private function migrate(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
        $files = glob($this->migrationsDir . '/*.sql');
        $files = $files === false ? [] : $files;
        sort($files);
        foreach ($files as $file) {
            $name = basename($file);
            if ($this->one('SELECT name FROM schema_migrations WHERE name = ?', [$name]) !== null) {
                continue;
            }
            $sql = (string) file_get_contents($file);
            // Taulun uudelleenrakennus (SQLite ei osaa muuttaa CHECK-ehtoja): viiteavaimet pois ajon ajaksi,
            // muuten vanhan taulun DROP poistaisi viittaavat rivit (ON DELETE CASCADE). Eheys tarkistetaan lopuksi.
            // PRAGMA foreign_keys ei vaikuta transaktion sisällä, joten se asetetaan ennen transaktiota.
            $fkOff = str_contains($sql, '-- hessutalks:foreign-keys-off');
            if ($fkOff) {
                $this->pdo->exec('PRAGMA foreign_keys = OFF');
            }
            $this->pdo->beginTransaction();
            try {
                $this->pdo->exec($sql);
                if ($fkOff && $this->all('PRAGMA foreign_key_check') !== []) {
                    throw new \RuntimeException('Migraatio ' . $name . ' rikkoi viite-eheyden.');
                }
                $this->exec('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [$name, time()]);
                $this->pdo->commit();
            } catch (\Throwable $e) {
                $this->pdo->rollBack();
                throw $e;
            } finally {
                if ($fkOff) {
                    $this->pdo->exec('PRAGMA foreign_keys = ON');
                }
            }
        }
    }
}
