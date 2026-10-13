<?php

declare(strict_types=1);

namespace HessuTalks;

/**
 * Yksinkertainen PHP-template-renderöijä. Kaikki muuttujat on escapoitava
 * e()-funktiolla templateissa. Templatet eivät sisällä inline-skriptejä (CSP).
 * t('avain') palauttaa käännöksen muuttujan $lang kielellä (ks. I18n); oletus suomi.
 */
final class View
{
    public function __construct(
        private readonly string $templateDir,
        private readonly Config $config,
        private readonly string $assetVersion,
    ) {
    }

    /** @param array<string, mixed> $vars */
    public function render(string $template, array $vars = [], string $layout = 'layout'): string
    {
        $content = $this->renderFile($template, $vars);
        return $this->renderFile($layout, $vars + ['content' => $content]);
    }

    /** @param array<string, mixed> $vars */
    private function renderFile(string $name, array $vars): string
    {
        if (preg_match('/^[a-z_]+$/', $name) !== 1) {
            throw new \InvalidArgumentException('Virheellinen template.');
        }
        $file = $this->templateDir . '/' . $name . '.php';
        $e = static fn (mixed $v): string => htmlspecialchars((string) (is_scalar($v) ? $v : ''), ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
        $url = fn (string $path = '/'): string => $this->config->url($path);
        $asset = fn (string $path): string => $this->config->url('/assets/' . $path) . '?v=' . rawurlencode($this->assetVersion);
        $lang = is_string($vars['lang'] ?? null) && in_array($vars['lang'], I18n::LANGS, true) ? $vars['lang'] : I18n::DEFAULT;
        /** @param array<string, string|int> $params */
        $t = static fn (string $key, array $params = []): string => I18n::t($lang, $key, $params);

        ob_start();
        try {
            (static function (string $__file, array $__vars, \Closure $e, \Closure $url, \Closure $asset, \Closure $t, string $lang): void {
                extract($__vars, EXTR_SKIP);
                require $__file;
            })($file, $vars, $e, $url, $asset, $t, $lang);
        } catch (\Throwable $ex) {
            ob_end_clean();
            throw $ex;
        }
        return (string) ob_get_clean();
    }
}
