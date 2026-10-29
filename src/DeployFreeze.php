<?php

declare(strict_types=1);

namespace HessuTalks;

/**
 * Julkaisujäädytys: tapahtuman aikana tuotantoon ei julkaista (vaatimus 8).
 *
 * Ikkunat ovat GitHubin production-ympäristön muuttujassa DEPLOY_FREEZE (ei julkisessa repossa: tarkat
 * luentoajat kertoisivat, milloin palvelunesto haittaisi eniten). Yksi ikkuna riviä kohden Suomen aikaa:
 *   2026-11-13 14:00  2026-11-13 20:30   # kuvaus
 * Tyhjät rivit ja #-kommentit ohitetaan.
 */
final class DeployFreeze
{
    public const TIMEZONE = 'Europe/Helsinki';

    /**
     * @return list<array{from: \DateTimeImmutable, to: \DateTimeImmutable, label: string}>
     * @throws \InvalidArgumentException virheellinen rivi (jäädytys ei saa ohittua kirjoitusvirheen takia)
     */
    public static function parse(string $spec): array
    {
        $tz = new \DateTimeZone(self::TIMEZONE);
        $out = [];
        $lines = preg_split('/\R/', $spec);
        foreach ($lines === false ? [] : $lines as $n => $line) {
            $label = '';
            if (str_contains($line, '#')) {
                [$line, $label] = explode('#', $line, 2);
            }
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (preg_match('/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/', $line, $m) !== 1) {
                throw new \InvalidArgumentException('Rivi ' . ($n + 1) . ': odotettiin "VVVV-KK-PP HH:MM VVVV-KK-PP HH:MM".');
            }
            $from = \DateTimeImmutable::createFromFormat('!Y-m-d H:i', $m[1], $tz);
            $to = \DateTimeImmutable::createFromFormat('!Y-m-d H:i', $m[2], $tz);
            if ($from === false || $to === false || $from->format('Y-m-d H:i') !== $m[1] || $to->format('Y-m-d H:i') !== $m[2] || $to <= $from) {
                throw new \InvalidArgumentException('Rivi ' . ($n + 1) . ': virheellinen päivämäärä tai loppu ennen alkua.');
            }
            $out[] = ['from' => $from, 'to' => $to, 'label' => trim($label)];
        }
        return $out;
    }

    /**
     * Deploy-vaiheen päätös: [exit-koodi, viesti]. Viestit päätyvät julkisen repon Actions-lokiin, joten niissä
     * ei ole ikkunoiden aikoja eikä kuvauksia. Virheellinen aikataulu estää julkaisun (ei ohitu kirjoitusvirheen takia).
     *
     * @return array{0: int, 1: string}
     */
    public static function decide(string $spec, \DateTimeImmutable $now, bool $override): array
    {
        try {
            $window = self::activeWindow($spec, $now);
        } catch (\InvalidArgumentException $e) {
            return [1, '::error title=Julkaisujäädytys::DEPLOY_FREEZE-muuttuja on virheellinen. ' . $e->getMessage()];
        }
        if ($window === null) {
            return [0, trim($spec) === '' ? 'Ei julkaisujäädytyksiä (DEPLOY_FREEZE tyhjä).' : 'Ei julkaisujäädytystä nyt.'];
        }
        if ($override) {
            return [0, '::warning title=Julkaisujäädytys ohitettu::Julkaistaan jäädytyksen aikana (käsin käynnistetty hätäjulkaisu).'];
        }
        return [1, '::error title=Julkaisujäädytys::Jäädytys on voimassa, tuotantoon ei julkaista. Hätätapauksessa: Run workflow → Ohita julkaisujäädytys.'];
    }

    /** Palauttaa voimassa olevan ikkunan kuvauksen tai null, jos julkaisu on sallittu. */
    public static function activeWindow(string $spec, \DateTimeImmutable $now): ?string
    {
        foreach (self::parse($spec) as $w) {
            if ($now >= $w['from'] && $now < $w['to']) {
                return $w['from']->format('d.m.Y H:i') . '–' . $w['to']->format('H:i') . ' (' . self::TIMEZONE . ')'
                    . ($w['label'] !== '' ? ' ' . $w['label'] : '');
            }
        }
        return null;
    }
}
