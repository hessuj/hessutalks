<?php
/** @var \Closure $e @var \Closure $asset @var string $content */
// Pelkistetty pohja projektorinäytölle: ei ylä- eikä alapalkkia.
$title = isset($pageTitle) && is_string($pageTitle) ? $pageTitle . ' · HessuTalks' : 'HessuTalks';
$scriptList = isset($scripts) && is_array($scripts) ? $scripts : [];
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
<body class="presenter">
<?= $content ?>
<?php foreach ($scriptList as $src): ?>
<script src="<?= $e($asset((string) $src)) ?>" defer></script>
<?php endforeach; ?>
</body>
</html>
