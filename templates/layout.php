<?php
/** @var \Closure $e @var \Closure $url @var \Closure $asset @var \Closure $t @var string $lang @var string $content */
$title = isset($pageTitle) && is_string($pageTitle) ? $pageTitle . ' · HessuTalks' : 'HessuTalks';
$scriptList = isset($scripts) && is_array($scripts) ? $scripts : [];
$bodyClass = isset($bodyClass) && is_string($bodyClass) ? $bodyClass : '';
$lq = isset($langQuery) && is_string($langQuery) ? $langQuery : '';
$switch = isset($langSwitch) && $langSwitch === true;
?><!doctype html>
<html lang="<?= $e($lang) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title><?= $e($title) ?></title>
<link rel="icon" href="<?= $e($asset('favicon.svg')) ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= $e($asset('css/app.css')) ?>">
</head>
<body class="<?= $e($bodyClass) ?>">
<div class="screen">
<header class="topbar">
  <a class="brand" href="<?= $e($url('/') . $lq) ?>"><span class="brand-mark">▚</span> HESSUTALKS</a>
<?php if ($switch): ?>
  <nav class="lang-switch" aria-label="<?= $e($t('lang.label')) ?>">
    <a href="?lang=fi" hreflang="fi" lang="fi"<?= $lang === 'fi' ? ' aria-current="true"' : '' ?>>FI</a>
    <a href="?lang=en" hreflang="en" lang="en"<?= $lang === 'en' ? ' aria-current="true"' : '' ?>>EN</a>
  </nav>
<?php endif; ?>
</header>
<main id="main">
<?= $content ?>
</main>
<footer class="foot">
  <span><?= $e($t('foot.encrypted')) ?></span>
  <a href="<?= $e($url('/tietosuoja') . $lq) ?>"><?= $e($t('foot.privacy')) ?></a>
</footer>
</div>
<?php foreach ($scriptList as $src): ?>
<script src="<?= $e($asset((string) $src)) ?>" defer></script>
<?php endforeach; ?>
</body>
</html>
