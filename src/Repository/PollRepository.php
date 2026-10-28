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
    public const TYPES = ['single', 'multi', 'words', 'likert', 'scale', 'open'];
    public const STATUSES = ['draft', 'open', 'closed'];
    public const MAX_PER_EVENT = 100;
    public const MAX_ANSWERS = 3000;
    public const PROMPT_MAX = 300;
    public const OPTION_MAX = 120;
    public const OPTIONS_MIN = 2;
    public const OPTIONS_MAX = 10;
    public const LABEL_MAX = 40;
    public const EXPLANATION_MAX = 300;
    /** Asetukset, joita ei näytetä osallistujalle ennen paljastusta (oikeat vastaukset ja selitykset). */
    public const PRIVATE_CONFIG = ['correct', 'explanations'];
    /** Avoimen vastauksen enimmäispituus merkkeinä (tarkistetaan selaimissa, palvelin ei näe tekstiä). */
    public const OPEN_MAX = 280;
    /** Vastaukset ovat lyhyitä; 280 merkin avoin vastaus (enintään 4 tavua/merkki) mahtuu salattuna reilusti. */
    public const CIPHERTEXT_MAX_BYTES = 2048;
    /** Salattu moderointitieto (piilotetut vastaukset ja sanat). */
    public const MODERATION_MAX_BYTES = 32768;

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
                $answer = self::answerKey($type, count($options), $c);
                return is_string($answer) ? $answer : [$p, ['options' => $options] + $answer];
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
            case 'open':
                // multiple: osallistuja voi lähettää useita vastauksia (muuten uusi korvaa vanhan).
                return [$p, ['multiple' => ($c['multiple'] ?? false) === true]];
            default: // words
                return [$p, []];
        }
    }

    /**
     * Oikeat vastaukset (vaihtoehtojen indeksit) ja vaihtoehtokohtaiset selitykset, molemmat valinnaisia.
     * Yhden vastauksen kysymyksessä oikeita on enintään yksi.
     * @param array<mixed> $c
     * @return array{correct?: list<int>, explanations?: list<string>}|string
     */
    private static function answerKey(string $type, int $count, array $c): array|string
    {
        $out = [];
        $correct = $c['correct'] ?? [];
        if (!is_array($correct) || !array_is_list($correct)) {
            return 'Oikeat vastaukset pitää antaa vaihtoehtojen numeroina.';
        }
        foreach ($correct as $i) {
            if (!is_int($i) || $i < 0 || $i >= $count) {
                return 'Oikea vastaus viittaa vaihtoehtoon, jota ei ole.';
            }
        }
        $correct = array_values(array_unique($correct));
        sort($correct);
        if ($type === 'single' && count($correct) > 1) {
            return 'Yhden vastauksen kysymyksessä voi olla vain yksi oikea vastaus.';
        }
        if ($correct !== []) {
            $out['correct'] = $correct;
        }
        $explanations = $c['explanations'] ?? [];
        if (!is_array($explanations) || !array_is_list($explanations) || ($explanations !== [] && count($explanations) !== $count)) {
            return 'Selityksiä pitää olla yksi jokaista vaihtoehtoa kohden.';
        }
        $clean = [];
        foreach ($explanations as $e) {
            $text = self::cleanText($e ?? '', self::EXPLANATION_MAX);
            if ($text === null) {
                return 'Selityksessä saa olla enintään ' . self::EXPLANATION_MAX . ' merkkiä.';
            }
            $clean[] = $text;
        }
        if (array_filter($clean, static fn (string $t): bool => $t !== '') !== []) {
            $out['explanations'] = $clean;
        }
        return $out;
    }

    /**
     * Osallistujalle näytettävät asetukset: ilman oikeita vastauksia ja selityksiä.
     * @param array<string, mixed> $config
     * @return array<string, mixed>
     */
    public static function publicConfig(array $config): array
    {
        return array_diff_key($config, array_flip(self::PRIVATE_CONFIG));
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

    /**
     * Luo kyselyn sarjan loppuun. null = luennon kiintiö täynnä.
     * @param array<string, mixed> $config
     */
    public function create(int $eventId, int $setId, string $type, string $prompt, array $config): ?int
    {
        if ($this->countForEvent($eventId) >= self::MAX_PER_EVENT) {
            return null;
        }
        $now = $this->clock->now();
        $max = $this->db->one('SELECT COALESCE(MAX(position), 0) AS p FROM polls WHERE set_id = ?', [$setId]);
        $this->db->exec(
            'INSERT INTO polls (event_id, set_id, position, type, prompt, config, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$eventId, $setId, (int) ($max['p'] ?? 0) + 1, $type, $prompt, self::encode($config), 'draft', $now, $now],
        );
        return $this->db->lastId();
    }

    /** Siirtää kyselyä sarjansa sisällä yhden askeleen (-1 ylös, 1 alas). */
    public function move(int $id, int $dir): bool
    {
        $poll = $this->find($id);
        if ($poll === null || ($dir !== -1 && $dir !== 1)) {
            return false;
        }
        $ids = array_map(
            static fn (array $r): int => (int) $r['id'],
            $this->db->all('SELECT id FROM polls WHERE set_id = ? ORDER BY position ASC, id ASC', [(int) $poll['set_id']]),
        );
        $i = array_search($id, $ids, true);
        $j = is_int($i) ? $i + $dir : -1;
        if (!is_int($i) || $j < 0 || $j >= count($ids)) {
            return false;
        }
        [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        foreach ($ids as $pos => $pid) {
            $this->db->exec('UPDATE polls SET position = ? WHERE id = ?', [$pos + 1, $pid]);
        }
        return true;
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        $row = $this->db->one('SELECT * FROM polls WHERE id = ?', [$id]);
        return $row === null ? null : self::decodeRow($row);
    }

    /**
     * Kaikki luennon kyselyt vastausmäärineen (ylläpitäjälle), sarjojen ja kyselyjen järjestyksessä.
     * skipped kertoo, onko kyselyn sarja ohitettu.
     * @return list<array<string, mixed>>
     */
    public function forEvent(int $eventId): array
    {
        $rows = $this->db->all(
            'SELECT p.*, s.skipped AS skipped, (SELECT COUNT(*) FROM poll_answers a WHERE a.poll_id = p.id) AS answer_count
             FROM polls p JOIN poll_sets s ON s.id = p.set_id
             WHERE p.event_id = ? ORDER BY s.position ASC, s.id ASC, p.position ASC, p.id ASC',
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

    /**
     * Poistaa vastaukset, moderoinnin ja tuloskoosteen ja kasvattaa sukupolvea, jotta ylläpitäjän selain
     * lataa tulokset alusta. Tulokset piilotetaan ja paljastus perutaan (koeajon jälkeen puhdas aloitus).
     */
    public function reset(int $id): void
    {
        $this->db->exec('DELETE FROM poll_answers WHERE poll_id = ?', [$id]);
        $this->db->exec(
            'UPDATE polls SET generation = generation + 1, moderation = NULL, summary = NULL, results_visible = 0, revealed = 0,
             updated_at = ? WHERE id = ?',
            [$this->clock->now(), $id],
        );
    }

    public static function isValidModeration(mixed $value): bool
    {
        return QuestionRepository::isValidCiphertext($value)
            && strlen((string) base64_decode((string) $value, true)) <= self::MODERATION_MAX_BYTES;
    }

    public function setResultsVisible(int $id, bool $visible): bool
    {
        // Piilotettaessa kooste poistetaan: osallistujat eivät näe vanhentunutta lukua seuraavalla näytöllä.
        return $this->db->exec(
            'UPDATE polls SET results_visible = ?, summary = CASE WHEN ? = 1 THEN summary ELSE NULL END WHERE id = ?',
            [$visible ? 1 : 0, $visible ? 1 : 0, $id],
        ) === 1;
    }

    public function setRevealed(int $id, bool $revealed): bool
    {
        return $this->db->exec('UPDATE polls SET revealed = ? WHERE id = ?', [$revealed ? 1 : 0, $id]) === 1;
    }

    /**
     * Tuloskooste osallistujille (päätös P2): vain monivalinnat ja asteikot, vain määrät ja tunnusluvut.
     * Luennoitsijan selain laskee sen puretuista vastauksista; palvelin tarkistaa muodon ja rajat.
     * @param array<string, mixed> $poll
     * @return array{voters: int, counts: list<int>, from?: int, mean?: float, median?: float}|null
     */
    public static function validSummary(array $poll, mixed $in): ?array
    {
        if (!is_array($in) || !is_int($in['voters'] ?? null) || $in['voters'] < 0 || $in['voters'] > self::MAX_ANSWERS) {
            return null;
        }
        $counts = $in['counts'] ?? null;
        $config = is_array($poll['config'] ?? null) ? $poll['config'] : [];
        $size = match ($poll['type'] ?? '') {
            'single', 'multi' => count(is_array($config['options'] ?? null) ? $config['options'] : []),
            'likert' => ($config['points'] ?? 5) === 7 ? 7 : 5,
            'scale' => 11,
            default => 0,
        };
        if ($size === 0 || !is_array($counts) || !array_is_list($counts) || count($counts) !== $size) {
            return null;
        }
        foreach ($counts as $n) {
            if (!is_int($n) || $n < 0 || $n > self::MAX_ANSWERS) {
                return null;
            }
        }
        $out = ['voters' => $in['voters'], 'counts' => $counts];
        if ($poll['type'] === 'likert' || $poll['type'] === 'scale') {
            $from = $poll['type'] === 'scale' ? 0 : 1;
            $out['from'] = $from;
            foreach (['mean', 'median'] as $k) {
                $v = $in[$k] ?? null;
                if ($v === null) {
                    continue;
                }
                if ((!is_int($v) && !is_float($v)) || $v < $from || $v > $from + $size - 1) {
                    return null;
                }
                $out[$k] = round((float) $v, 2);
            }
        }
        return $out;
    }

    /** @param array<string, mixed>|null $summary */
    public function setSummary(int $id, ?array $summary): bool
    {
        return $this->db->exec(
            'UPDATE polls SET summary = ? WHERE id = ? AND results_visible = 1',
            [$summary === null ? null : self::encode($summary), $id],
        ) === 1;
    }

    /** Tallentaa luennoitsijan salatun moderointitiedon (null = ei piilotuksia). */
    public function setModeration(int $id, ?string $ciphertext): bool
    {
        return $this->db->exec('UPDATE polls SET moderation = ? WHERE id = ?', [$ciphertext, $id]) === 1;
    }

    /**
     * Tallentaa vastauksen. Saman vastaajan aiempi vastaus korvataan, paitsi jos kysely sallii useita
     * vastauksia (avoin teksti, multiple): silloin jokainen vastaus on oma rivinsä, eikä niitä voi
     * tietokannasta yhdistää samaan vastaajaan. false = kiintiö täynnä.
     */
    public function answer(int $pollId, string $voter, string $ciphertext, bool $multiple = false): bool
    {
        $hash = $multiple ? $this->voterHash($pollId, $voter . '|' . bin2hex(random_bytes(16))) : $this->voterHash($pollId, $voter);
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
     * @return list<array{id: int, poll_id: int, voter: string, ciphertext: string, ts: int}>
     */
    public function answersForEvent(int $eventId, int $afterId = 0): array
    {
        $rows = $this->db->all(
            'SELECT a.id, a.poll_id, a.voter_hash, a.ciphertext, a.created_at FROM poll_answers a
             JOIN polls p ON p.id = a.poll_id
             WHERE p.event_id = ? AND a.id > ? ORDER BY a.id ASC LIMIT 2000',
            [$eventId, $afterId],
        );
        return array_map(static fn (array $r): array => [
            'id' => (int) $r['id'],
            'poll_id' => (int) $r['poll_id'],
            'voter' => substr((string) $r['voter_hash'], 0, 16),
            'ciphertext' => (string) $r['ciphertext'],
            'ts' => (int) $r['created_at'],
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
        foreach (['id', 'event_id', 'set_id', 'position', 'generation', 'created_at', 'updated_at', 'answer_count'] as $k) {
            if (isset($row[$k])) {
                $row[$k] = (int) $row[$k];
            }
        }
        foreach (['skipped', 'results_visible', 'revealed'] as $k) {
            if (isset($row[$k])) {
                $row[$k] = (bool) $row[$k];
            }
        }
        return $row;
    }
}
