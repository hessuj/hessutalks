<?php
/** @var \Closure $e @var \Closure $url @var \Closure $asset @var string $content */
$title = isset($pageTitle) && is_string($pageTitle) ? $pageTitle . ' · HessuTalks' : 'HessuTalks';
$scriptList = isset($scripts) && is_array($scripts) ? $scripts : [];
$bodyClass = isset($bodyClass) && is_string($bodyClass) ? $bodyClass : '';
?><!doctype html>
<html lang="fi">
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
  <a class="brand" href="<?= $e($url('/')) ?>"><span class="brand-mark">▚</span> HESSUTALKS</a>
</header>
<main id="main">
<?= $content ?>
</main>
<footer class="foot">
  <span>Viestit salataan selaimessasi ennen lähetystä.</span>
  <a href="<?= $e($url('/tietosuoja')) ?>">Tietosuoja</a>
</footer>
</div>
<?php foreach ($scriptList as $src): ?>
<script src="<?= $e($asset((string) $src)) ?>" defer></script>
<?php endforeach; ?>
</body>
</html>
