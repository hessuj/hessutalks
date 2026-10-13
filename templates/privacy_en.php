<?php /** @var \Closure $e @var \Closure $url */ $lq = isset($langQuery) && is_string($langQuery) ? $langQuery : ''; ?>
<section class="card narrow prose">
  <h1>Privacy</h1>
  <p>HessuTalks does not collect personal data about participants. Questions and feedback are sent using only a nickname.</p>
  <h2>What is stored</h2>
  <ul>
    <li>Your message and nickname are encrypted in your browser with the lecturer's public key. The server stores only the encrypted data and the time it was sent.</li>
    <li>To make sure two people cannot use the same nickname, the server stores a keyed hash of the nickname. The server does not store the nickname itself.</li>
    <li>Your browser remembers your nickname and a random identifier that lets only you send messages with that nickname. Your browser also remembers the language you chose. This data stays on your device. You can delete it by clearing this site's data in your browser.</li>
    <li>The application uses no cookies and no analytics, and it does not store your IP address.</li>
  </ul>
  <h2>Please note</h2>
  <p>Do not write your own name, contact details or other identifying information in your nickname or message.</p>
  <p>The server operator (web host) may keep ordinary technical logs, such as IP addresses, to keep the service running. The application does not use them.</p>
  <h2>Retention</h2>
  <p>A lecture's messages and nickname hashes are deleted when the lecturer deletes the lecture.</p>
  <p><a class="btn ghost" href="<?= $e($url('/') . $lq) ?>">Back</a></p>
</section>
