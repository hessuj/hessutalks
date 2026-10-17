<?php

declare(strict_types=1);

namespace HessuTalks\Repository;

use HessuTalks\Database;
use HessuTalks\Security\Clock;

/**
 * Luennon kyselyt ja niiden salatut vastaukset.
 *
 * Kysymysteksti ja vaihtoehdot ovat luennoitsijan julkista sisältöä, joten ne tarkistetaan täällä.
 * Vastaukset ovat sealed boxeja: palvelin ei näe sisältöä, vaan tulokset lasketaan ylläpitäjän selaimessa.
 * Vastaajasta tallennetaan vain kyselykohtainen HMAC selaimen satunnaisesta tunnisteesta,
 * joten saman selaimen vastauksia eri kyselyissä ei voi yhdistää tietokannasta.
 */
final class PollRepository
{
    public const TYPES = ['single', 'multi', 'words', 'likert', 'scale'];
    public const STATUSES = ['draft', 'open', 'closed'];
    public const MAX_PER_EVENT = 100;
    public const MAX_ANSWERS = 3000;
    public const PROMPT_MAX = 300;
    public const OPTION_MAX = 120;
    public const OPTIONS_MIN = 2;
    public const OPTIONS_MAX = 10;
    public const LABEL_MAX = 40;
    /** Vastaukset ovat lyhyitä; salattu JSON mahtuu tähän reilusti. */
    public const CIPHERTEXT_MAX_BYTES = 2048;

    public function __construct(
        private readonly Database $db,
        private readonly Clock $clock,
        private readonly string $appSecret,
    ) {
    }

    /**
     * Tarkistaa ja siistii kyselyn. Palauttaa [prompt, config] tai virheilmoituksen merkkijonona.
     * @return array{0: string, 1: array<string, mixed>}|string
     */
    public static function validate(mixed $type, mixed $prompt, mixed $config): array|string
    {
        if (!is_string($type) || !in_array($type, self::TYPES, true)) {
            return 'Tuntematon kysymystyyppi.';
        }
        $p = self::cleanText($prompt, self::PROMPT_MAX);
        if ($p === null || $p === '') {
            return 'Kysymyksessä pitää olla 1–' . self::PROMPT_MAX . ' merkkiä.';
        }
        $c = is_array($config) ? $config : [];
        switch ($type) {
            case 'single':
            case 'multi':
                $options = [];
                foreach (is_array($c['options'] ?? null) ? $c['options'] : [] as $o) {
                    $clean = self::cleanText($o, self::OPTION_MAX);
                    if ($clean === null) {
                        return 'Vaihtoehdossa saa olla enintään ' . self::OPTION_MAX . ' merkkiä.';
                    }
                    if ($clean !== '') {
                        $options[] = $clean;
                    }
                }
                if (count($options) < self::OPTIONS_MIN || count($options) > self::OPTIONS_MAX) {
                    return 'Vaihtoehtoja pitää olla ' . self::OPTIONS_MIN . '–' . self::OPTIONS_MAX . '.';
                }
                return [$p, ['options' => $options]];
            case 'likert':
                $points = $c['points'] ?? 5;
                if (!in_array($points, [5, 7], true)) {
                    return 'Likert-asteikossa voi olla 5 tai 7 kohtaa.';
                }
                $labels = self::labels($c);
                return is_string($labels) ? $labels : [$p, ['points' => $points] + $labels];
            case 'scale':
                $labels = self::labels($c);
                return is_string($labels) ? $labels : [$p, ['min' => 0, 'max' => 10] + $labels];
            default: // words
                return [$p, []];
        }
    }

    /**
     * @param array<mixed> $c
     * @return array{min_label: string, max_label: string}|string
     */
    private static function labels(array $c): array|string
    {
        $min = self::cleanText($c['min_label'] ?? '', self::LABEL_MAX);
        $max = self::cleanText($c['max_label'] ?? '', self::LABEL_MAX);
        if ($min === null || $max === null) {
            return 'Ääripäiden selitteissä saa olla enintään ' . self::LABEL_MAX . ' merkkiä.';
        }
        return ['min_label' => $min, 'max_label' => $max];
    }

    /** Trimmaa ja poistaa ohjausmerkit. null = liian pitkä tai ei merkkijono. */
    private static function cleanText(mixed $value, int $max): ?string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
            return null;
        }
        $text = trim((string) preg_replace('/[\p{Cc}\p{Cf}]+/u', ' ', $value));
        $text = (string) preg_replace('/ {2,}/', ' ', $text);
        return mb_strlen($text) > $max ? null : $text;
    }

    public static function isValidCiphertext(mixed $value): bool
    {
        if (!QuestionRepository::isValidCiphertext($value)) {
            return false;
        }
        return strlen((string) base64_decode((string) $value, true)) <= self::CIPHERTEXT_MAX_BYTES;
    }

    /** Selaimen satunnainen vastaajatunniste (32 tavua base64url). */
    public static function isValidVoter(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[A-Za-z0-9_-]{43}$/', $value) === 1;
    }

    private function voterHash(int $pollId, string $voter): string
    {
        return hash_hmac('sha256', 'voter|' . $pollId . '|' . $voter, $this->appSecret);
    }

    /** @param array<string, mixed> $config */
    public function create(int $eventId, string $type, string $prompt, array $config): ?int
    {
        if ($this->countForEvent($eventId) >= self::MAX_PER_EVENT) {
            return null;
        }
        $now = $this->clock->now();
        $this->db->exec(
            'INSERT INTO polls (event_id, type, prompt, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$eventId, $type, $prompt, self::encode($config), 'draft', $now, $now],
        );
        return $this->db->lastId();
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        $row = $this->db->one('SELECT * FROM polls WHERE id = ?', [$id]);
        return $row === null ? null : self::decodeRow($row);
    }

    /**
     * Kaikki luennon kyselyt vastausmäärineen (ylläpitäjälle).
     * @return list<array<string, mixed>>
     */
    public function forEvent(int $eventId): array
    {
        $rows = $this->db->all(
            'SELECT p.*, (SELECT COUNT(*) FROM poll_answers a WHERE a.poll_id = p.id) AS answer_count
             FROM polls p WHERE p.event_id = ? ORDER BY p.id ASC',
            [$eventId],
        );
        return array_map(self::decodeRow(...), $rows);
    }

    /**
     * Avoimet kyselyt osallistujalle: vain julkiset kentät.
     * @return list<array<string, mixed>>
     */
    public function openForEvent(int $eventId): array
    {
        $rows = $this->db->all(
            "SELECT id, type, prompt, config, generation FROM polls WHERE event_id = ? AND status = 'open' ORDER BY id ASC",
            [$eventId],
        );
        return array_map(self::decodeRow(...), $rows);
    }

    public function countForEvent(int $eventId): int
    {
        $row = $this->db->one('SELECT COUNT(*) AS n FROM polls WHERE event_id = ?', [$eventId]);
        return (int) ($row['n'] ?? 0);
    }

    public function countAnswers(int $pollId): int
    {
        $row = $this->db->one('SELECT COUNT(*) AS n FROM poll_answers WHERE poll_id = ?', [$pollId]);
        return (int) ($row['n'] ?? 0);
    }

    /**
     * Päivittää kysymystekstin ja asetukset. Vaihtoehtojen määrää ei voi muuttaa, kun vastauksia on,
     * koska vastaukset viittaavat vaihtoehtojen järjestysnumeroihin.
     * @param array<string, mixed> $config
     */
    public function update(int $id, string $prompt, array $config): ?string
    {
        $poll = $this->find($id);
        if ($poll === null) {
            return 'Kyselyä ei löytynyt.';
        }
        if ($this->countAnswers($id) > 0 && self::shape($poll['config']) !== self::shape($config)) {
            return 'Vaihtoehtojen määrää tai asteikkoa ei voi muuttaa, kun kyselyyn on vastattu. Tyhjennä vastaukset ensin.';
        }
        $this->db->exec(
            'UPDATE polls SET prompt = ?, config = ?, updated_at = ? WHERE id = ?',
            [$prompt, self::encode($config), $this->clock->now(), $id],
        );
        return null;
    }

    /** @param mixed $config */
    private static function shape(mixed $config): string
    {
        $c = is_array($config) ? $config : [];
        return count(is_array($c['options'] ?? null) ? $c['options'] : []) . '|' . (string) json_encode($c['points'] ?? null);
    }

    public function setStatus(int $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) {
            throw new \InvalidArgumentException('Tuntematon tila.');
        }
        return $this->db->exec(
            'UPDATE polls SET status = ?, updated_at = ? WHERE id = ?',
            [$status, $this->clock->now(), $id],
        ) === 1;
    }

    public function delete(int $id): bool
    {
        return $this->db->exec('DELETE FROM polls WHERE id = ?', [$id]) === 1;
    }

    /** Poistaa vastaukset ja kasvattaa sukupolvea, jotta ylläpitäjän selain lataa tulokset alusta. */
    public function reset(int $id): void
    {
        $this->db->exec('DELETE FROM poll_answers WHERE poll_id = ?', [$id]);
        $this->db->exec(
            'UPDATE polls SET generation = generation + 1, updated_at = ? WHERE id = ?',
            [$this->clock->now(), $id],
        );
    }

    /** Tallentaa vastauksen; saman vastaajan aiempi vastaus korvataan. false = kiintiö täynnä. */
    public function answer(int $pollId, string $voter, string $ciphertext): bool
    {
        $hash = $this->voterHash($pollId, $voter);
        $existing = $this->db->one('SELECT id FROM poll_answers WHERE poll_id = ? AND voter_hash = ?', [$pollId, $hash]);
        if ($existing === null && $this->countAnswers($pollId) >= self::MAX_ANSWERS) {
            return false;
        }
        $this->db->exec(
            'INSERT OR REPLACE INTO poll_answers (poll_id, voter_hash, ciphertext, created_at) VALUES (?, ?, ?, ?)',
            [$pollId, $hash, $ciphertext, $this->clock->now()],
        );
        return true;
    }

    /**
     * Luennon kyselyjen vastaukset id:n jälkeen (ylläpitäjän selain päivittää tulokset tästä).
     * voter on lyhennetty tiiviste, jolla korvaava vastaus tunnistetaan.
     * @return list<array{id: int, poll_id: int, voter: string, ciphertext: string}>
     */
    public function answersForEvent(int $eventId, int $afterId = 0): array
    {
        $rows = $this->db->all(
            'SELECT a.id, a.poll_id, a.voter_hash, a.ciphertext FROM poll_answers a
             JOIN polls p ON p.id = a.poll_id
             WHERE p.event_id = ? AND a.id > ? ORDER BY a.id ASC LIMIT 2000',
            [$eventId, $afterId],
        );
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'poll_id' => (int) $r['poll_id'],
            'voter' => substr((string) $r['voter_hash'], 0, 16),
            'ciphertext' => (string) $r['ciphertext'],
        ], $rows);
    }

    /** @param array<string, mixed> $config */
    private static function encode(array $config): string
    {
        return (string) json_encode($config, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function decodeRow(array $row): array
    {
        $config = json_decode((string) ($row['config'] ?? '{}'), true);
        $row['config'] = is_array($config) ? $config : [];
        foreach (['id', 'event_id', 'generation', 'created_at', 'updated_at', 'answer_count'] as $k) {
            if (isset($row[$k])) {
                $row[$k] = (int) $row[$k];
            }
        }
        return $row;
    }
}
