<?php

declare(strict_types=1);

namespace HessuTalks\Import;

use HessuTalks\Repository\PollRepository;
use HessuTalks\Repository\SetRepository;

/**
 * Kysymyssarjojen JSON-muoto (tuonti ja vienti), jotta kysymykset voi pitää versionhallinnassa.
 *
 *   { "event": { "title": "…" },
 *     "sets": [ { "id": "M1", "title": "…", "questions": [ { "type": "single", "text": "…", … } ] } ] }
 *
 * Kysymystyypit ja niiden vastine sovelluksessa:
 *   single, multi      → monivalinta (options, correct = oikeiden indeksit, explanations = selitys per vaihtoehto)
 *   scale              → min–max 1–5 tai 1–7 = Likert, 0–10 = asteikko (minLabel, maxLabel)
 *   wordcloud          → sanapilvi (enintään 3 sanaa)
 *   open               → avoin teksti (oletus 280 merkkiä, maxLength 280–3500), multipleAnswers = useita vastauksia
 *   qa                 → ei tueta; käytetään fallbackType-kenttää, jos se on annettu
 *
 * Tuonti on kaikki tai ei mitään: virheet estävät tuonnin, varoitukset kertovat ohitetuista kysymyksistä.
 * Tiedosto on luennoitsijan omaa julkista sisältöä, mutta se validoidaan kuten käsin luodut kysymykset.
 */
final class SetFormat
{
    public const MAX_BYTES = 60000;
    public const VERSION = 1;

    /**
     * @return array{sets: list<array{slug: string, title: string, polls: list<array{type: string, prompt: string, config: array<string, mixed>}>}>,
     *               title: string|null, errors: list<string>, warnings: list<string>}
     */
    public static function parse(string $raw): array
    {
        $result = ['sets' => [], 'title' => null, 'errors' => [], 'warnings' => []];
        if (strlen($raw) > self::MAX_BYTES) {
            $result['errors'][] = 'Tiedosto on liian suuri (enintään ' . intdiv(self::MAX_BYTES, 1000) . ' kt).';
            return $result;
        }
        try {
            $data = json_decode($raw, true, 10, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            $result['errors'][] = 'Tiedosto ei ole kelvollista JSONia: ' . $e->getMessage();
            return $result;
        }
        if (!is_array($data) || !is_array($data['sets'] ?? null) || !array_is_list($data['sets'])) {
            $result['errors'][] = 'Tiedostosta puuttuu sets-lista.';
            return $result;
        }
        $title = is_array($data['event'] ?? null) ? ($data['event']['title'] ?? null) : null;
        $result['title'] = is_string($title) ? SetRepository::cleanTitle($title) : null;

        $seen = [];
        foreach ($data['sets'] as $si => $set) {
            $where = 'Sarja ' . ($si + 1);
            if (!is_array($set)) {
                $result['errors'][] = $where . ': ei ole objekti.';
                continue;
            }
            $slug = SetRepository::cleanSlug($set['id'] ?? null);
            $setTitle = SetRepository::cleanTitle($set['title'] ?? null);
            if ($slug === null) {
                $result['errors'][] = $where . ': id puuttuu tai on virheellinen (1–16 merkkiä A–Z, 0–9, - tai _).';
                continue;
            }
            $where = 'Sarja ' . $slug;
            if (isset($seen[$slug])) {
                $result['errors'][] = $where . ': sama id on tiedostossa kahdesti.';
                continue;
            }
            $seen[$slug] = true;
            if ($setTitle === null) {
                $result['errors'][] = $where . ': title puuttuu tai on liian pitkä (enintään ' . SetRepository::TITLE_MAX . ' merkkiä).';
                continue;
            }
            $questions = $set['questions'] ?? [];
            if (!is_array($questions) || !array_is_list($questions)) {
                $result['errors'][] = $where . ': questions ei ole lista.';
                continue;
            }
            $polls = [];
            foreach ($questions as $qi => $q) {
                $qWhere = $where . ', kysymys ' . ($qi + 1);
                $mapped = is_array($q) ? self::question($q) : 'ei ole objekti.';
                if (is_string($mapped)) {
                    $result['errors'][] = $qWhere . ': ' . $mapped;
                } elseif ($mapped['skip'] !== null) {
                    $result['warnings'][] = $qWhere . ' ohitetaan: ' . $mapped['skip'];
                } else {
                    $polls[] = ['type' => $mapped['type'], 'prompt' => $mapped['prompt'], 'config' => $mapped['config']];
                }
            }
            $result['sets'][] = ['slug' => $slug, 'title' => $setTitle, 'polls' => $polls];
        }
        if ($result['sets'] === [] && $result['errors'] === []) {
            $result['errors'][] = 'Tiedostossa ei ole yhtään sarjaa.';
        }
        return $result;
    }

    /**
     * @param array<mixed> $q
     * @return array{type: string, prompt: string, config: array<string, mixed>, skip: string|null}|string
     */
    private static function question(array $q, int $depth = 0): array|string
    {
        $type = $q['type'] ?? null;
        $text = $q['text'] ?? null;
        $skip = static fn (string $why): array => ['type' => '', 'prompt' => '', 'config' => [], 'skip' => $why];
        switch ($type) {
            case 'single':
            case 'multi':
                $options = $q['options'] ?? null;
                if (!is_array($options) || in_array('', array_map(static fn ($o) => is_string($o) ? trim($o) : $o, $options), true)) {
                    return 'options puuttuu tai siinä on tyhjä vaihtoehto.';
                }
                $local = $type;
                $config = ['options' => $options, 'correct' => $q['correct'] ?? [], 'explanations' => $q['explanations'] ?? []];
                break;
            case 'scale':
                $min = $q['min'] ?? 1;
                $max = $q['max'] ?? 5;
                $labels = ['min_label' => $q['minLabel'] ?? '', 'max_label' => $q['maxLabel'] ?? ''];
                if ($min === 1 && ($max === 5 || $max === 7)) {
                    $local = 'likert';
                    $config = ['points' => $max] + $labels;
                } elseif ($min === 0 && $max === 10) {
                    $local = 'scale';
                    $config = $labels;
                } else {
                    return 'asteikon pitää olla 1–5, 1–7 tai 0–10.';
                }
                break;
            case 'wordcloud':
                $words = $q['maxWords'] ?? 3;
                if (!is_int($words) || $words < 1 || $words > 3) {
                    return 'maxWords voi olla 1–3.';
                }
                $local = 'words';
                $config = [];
                break;
            case 'qa':
                $fallback = $q['fallbackType'] ?? null;
                if ($depth === 0 && is_string($fallback) && $fallback !== 'qa') {
                    $mapped = self::question(['type' => $fallback] + $q, 1);
                    if (is_array($mapped) && $mapped['skip'] !== null) {
                        return $skip('Q&A (tykkäykset) ei ole käytössä, ja varatyyppi ' . $fallback . ': ' . $mapped['skip']);
                    }
                    return $mapped;
                }
                return $skip('Q&A (tykkäykset) ei ole käytössä eikä varatyyppiä (fallbackType) ole annettu.');
            case 'open':
                $local = 'open';
                $config = ['multiple' => ($q['multipleAnswers'] ?? false) === true]
                    + (array_key_exists('maxLength', $q) ? ['max' => $q['maxLength']] : []);
                break;
            default:
                return 'tuntematon type ' . (is_string($type) ? '"' . mb_substr($type, 0, 20) . '"' : '') . '.';
        }
        $valid = PollRepository::validate($local, $text, $config);
        if (is_string($valid)) {
            return lcfirst($valid);
        }
        return ['type' => $local, 'prompt' => $valid[0], 'config' => $valid[1], 'skip' => null];
    }

    /**
     * Vienti samaan muotoon (tuonti ja vienti ovat toistensa käänteiset).
     * @param list<array<string, mixed>> $sets
     * @param list<array<string, mixed>> $polls
     * @return array<string, mixed>
     */
    public static function export(string $title, array $sets, array $polls): array
    {
        $out = [];
        foreach ($sets as $set) {
            $questions = [];
            foreach ($polls as $p) {
                if ($p['set_id'] === $set['id']) {
                    $questions[] = self::exportQuestion((string) $p['type'], (string) $p['prompt'], is_array($p['config']) ? $p['config'] : []);
                }
            }
            $out[] = ['id' => $set['slug'], 'title' => $set['title'], 'questions' => $questions];
        }
        return ['format' => 'hessutalks-sets', 'version' => self::VERSION, 'event' => ['title' => $title], 'sets' => $out];
    }

    /**
     * @param array<string, mixed> $c
     * @return array<string, mixed>
     */
    private static function exportQuestion(string $type, string $prompt, array $c): array
    {
        $labels = ['minLabel' => (string) ($c['min_label'] ?? ''), 'maxLabel' => (string) ($c['max_label'] ?? '')];
        return match ($type) {
            'single', 'multi' => ['type' => $type, 'text' => $prompt, 'options' => $c['options'] ?? []]
                + (isset($c['correct']) ? ['correct' => $c['correct']] : [])
                + (isset($c['explanations']) ? ['explanations' => $c['explanations']] : []),
            'likert' => ['type' => 'scale', 'text' => $prompt, 'min' => 1, 'max' => (int) ($c['points'] ?? 5)] + $labels,
            'scale' => ['type' => 'scale', 'text' => $prompt, 'min' => 0, 'max' => 10] + $labels,
            'open' => ['type' => 'open', 'text' => $prompt, 'multipleAnswers' => ($c['multiple'] ?? false) === true]
                + (is_int($c['max'] ?? null) && $c['max'] !== PollRepository::OPEN_MAX ? ['maxLength' => $c['max']] : []),
            default => ['type' => 'wordcloud', 'text' => $prompt, 'maxWords' => 3],
        };
    }
}
