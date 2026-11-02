<?php

declare(strict_types=1);

namespace HessuTalks\Tests\Security;

use PHPUnit\Framework\TestCase;

/**
 * Tietoturvaputken rakenne (MMoIT R25, R26): vaiheet järjestyksessä salaisuudet → SAST → SCA → SBOM → DAST,
 * raportit artefakteiksi, SCA pysähtyy CRITICAL-löydökseen, DAST ei koskaan tuotantoa vasten.
 * Toimitusketju: actionit commit-SHA:han, Trivy lukitulla SHA-256-summalla eikä kaapattuna actionina (CVE-2026-33634).
 */
final class PipelineSecurityTest extends TestCase
{
    /** @var array<string, string> jobin tunniste => jobin YAML-teksti */
    private static array $jobs = [];

    private static string $workflow = '';

    public static function setUpBeforeClass(): void
    {
        self::$workflow = (string) file_get_contents(dirname(__DIR__, 2) . '/.github/workflows/ci.yml');
        // Kommenttirivit pois: ne eivät ole määritystä (ja jobien väliset kommentit kuuluvat seuraavaan jobiin).
        $body = (string) preg_replace('/^\s*#.*\n/m', '', substr(self::$workflow, (int) strpos(self::$workflow, "\njobs:\n")));
        $parts = preg_split('/^  ([a-z][\w-]*):\n/m', $body, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [];
        for ($i = 1; $i + 1 < count($parts); $i += 2) {
            self::$jobs[$parts[$i]] = $parts[$i + 1];
        }
    }

    /** @return list<string> */
    private static function needs(string $job): array
    {
        self::assertArrayHasKey($job, self::$jobs, 'job puuttuu: ' . $job);
        if (!preg_match('/^    needs: (\[[^\]]*\]|[\w-]+)$/m', self::$jobs[$job], $m)) {
            return [];
        }
        return array_map('trim', explode(',', trim($m[1], '[]')));
    }

    public function testStagesRunInRequiredOrder(): void
    {
        self::assertSame([], self::needs('gitleaks'), '1) salaisuudet ensin');
        self::assertSame(['gitleaks'], self::needs('semgrep'), '2) SAST salaisuuksien jälkeen');
        self::assertSame(['semgrep'], self::needs('sca'), '3) SCA SASTin jälkeen');
        self::assertSame(['sca'], self::needs('sbom'), '4) SBOM SCA:n jälkeen');
        self::assertContains('sbom', self::needs('dast'), '5) DAST viimeisenä');
        foreach (['php', 'frontend', 'gitleaks', 'semgrep', 'sca', 'sbom', 'dast'] as $job) {
            self::assertContains($job, self::needs('deploy'), 'julkaisu odottaa: ' . $job);
        }
    }

    public function testEveryStageStoresItsReport(): void
    {
        $artifacts = ['gitleaks' => '1-gitleaks-raportti', 'semgrep' => '2-semgrep-raportti', 'sca' => '3-sca-raportti',
            'sbom' => '4-sbom-cyclonedx', 'dast' => '5-zap-raportti'];
        foreach ($artifacts as $job => $name) {
            self::assertMatchesRegularExpression('/(name|artifact_name): ' . preg_quote($name, '/') . '\n/', self::$jobs[$job], $job);
        }
        // Raportti tallennetaan myös silloin, kun vaihe löytää jotain (juuri silloin sitä tarvitaan).
        foreach (['gitleaks', 'semgrep', 'sca'] as $job) {
            self::assertMatchesRegularExpression('/- name: Tallenna raportti\n\s+if: always\(\)/', self::$jobs[$job], $job);
        }
        self::assertStringContainsString('--format cyclonedx', self::$jobs['sbom']);
        self::assertStringContainsString('scripts/sbom-vendor.py', self::$jobs['sbom'], 'selainkirjastot SBOMiin');
    }

    public function testScaStopsOnCritical(): void
    {
        self::assertMatchesRegularExpression('/trivy convert [^\n]*--severity CRITICAL --exit-code 1/', self::$jobs['sca']);
        self::assertStringNotContainsString('continue-on-error', self::$jobs['sca']);
    }

    public function testDastNeverTargetsProduction(): void
    {
        self::assertMatchesRegularExpression('#target: http://localhost:8080/#', self::$jobs['dast']);
        self::assertStringNotContainsString('APP_URL', self::$jobs['dast']);
        self::assertStringNotContainsString('hessujarvinen.com', self::$jobs['dast']);
    }

    public function testSupplyChainPinning(): void
    {
        preg_match_all('/^\s+(?:- )?uses: (\S+)/m', self::$workflow, $m);
        self::assertNotEmpty($m[1]);
        foreach ($m[1] as $uses) {
            self::assertMatchesRegularExpression('/@[0-9a-f]{40}$/', $uses, 'action ei ole lukittu SHA:han: ' . $uses);
            self::assertDoesNotMatchRegularExpression('#aquasecurity/(trivy-action|setup-trivy)#', $uses, 'kaapattu action');
        }
        $install = (string) file_get_contents(dirname(__DIR__, 2) . '/scripts/install-trivy.sh');
        self::assertMatchesRegularExpression('/^VERSION=\d+\.\d+\.\d+$/m', $install);
        self::assertMatchesRegularExpression('/^SHA256=[0-9a-f]{64}$/m', $install);
        self::assertStringContainsString('sha256sum --check --strict', $install);
        // Trivyn kaapatut versiot (CVE-2026-33634)
        self::assertDoesNotMatchRegularExpression('/^VERSION=0\.69\.[4-6]$/m', $install);
        foreach (['sca', 'sbom'] as $job) {
            self::assertStringContainsString('scripts/install-trivy.sh', self::$jobs[$job], $job);
        }
    }
}
