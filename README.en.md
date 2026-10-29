# HessuTalks

[Suomi](README.md) · **English**

End-to-end encrypted question and feedback channel for lectures and talks.
Participants join a lecture with a code or QR code and send questions under a nickname.
Only the lecturer can read the messages.

Address: <https://hessujarvinen.com/hessutalks/>

## How it works

1. The lecturer creates a lecture in the admin view. The app gives a 6-character code and a QR code.
2. The participant opens the page, chooses a nickname and writes a question or feedback.
3. The message and nickname are encrypted in the participant's browser with the lecturer's public key.
4. The lecturer unlocks the messages in their own browser with a passkey or passphrase. They update in real time,
   and the QR code, a single question or the question list can be shown on the projector.

### Polls and question sets

A lecture consists of **question sets** (e.g. modules `M1`, `M4`) containing questions in order.
Question types: multiple choice (one or several answers), open text (280 characters, optionally several answers), word cloud (1–3 words, 30 characters), Likert scale (5 or 7 points) and a 0–10 scale.

1. On the lecture page, create the sets (*Uusi sarja*, new set) and their questions (*Uusi kysymys*, new question) before the lecture.
   Sets and questions can be moved with the arrows, and a set can be **skipped** during the lecture. The questions of a skipped
   set are left out of the Next/Previous order, but their answers are kept.
2. A lecture has one **active question** at a time, seen by all participants. In the control bar,
   *Seuraava →* and *← Edellinen* (next/previous) change the active question, *Avaa vastauksille* and *Sulje vastaukset*
   (open/close for answers) control answering, and *Odotusnäkymä* (waiting screen) removes the active question.
   An active question in draft state is shown on the projector, but participants see the waiting screen
   (*Waiting for the next question…*) until you open it. Only the active question can be open.
3. Participants use the same lecture QR code or link the whole time. The view changes by itself within about
   a second without reloading the page. After a connection loss the page reconnects, and the participant's own answer survives a reload.
4. **Results and reveal:** results are hidden at first (the projector shows the question, the options and the answer count).
   *Näytä tulokset* (show results) brings them to the projector and, as a summary, to the participants' phones (multiple choice and scales).
   *Paljasta oikea vastaus* (reveal correct answer) highlights the correct options and shows the explanations, if the question has a correct answer.
   Correct answers and explanations are entered in the question form or the JSON file, and they are not sent to participants before the reveal.
5. *Aktiivinen projektorille* (active to projector) opens a window that follows the active question and its results (without an active question
   it shows the lecture QR code). *Tulokset projektorille* (results to projector) shows the results of a single question in its own window.
6. **Moderation:** an open-text answer can be hidden with the *Piilota* (hide) button and a word-cloud word by clicking it. A hidden item disappears from the projector immediately.
   The profanity filter (English and Finnish) hides matches automatically, and they wait for approval (⚠ … ✓).
   Hidden items are stored on the server encrypted with the lecturer's key, so they persist across reloads.

Polls are answered without a nickname. Answers are encrypted in the browser like questions, and results
are computed in the lecturer's browser, so the admin view must be open and unlocked. A new answer from the same browser
replaces the earlier one until the poll is closed.

#### Preview, duplicate, move and CSV

- **Esikatsele** (preview) opens the question in the participant layout (a phone-sized window, no answer is sent) and
  **Esikatsele projektorilla** (preview on projector) in the presenter view before opening it.
- **Monista** (duplicate) copies a set with its questions but without answers (the identifier gets the suffix `-2`). A question can be moved to another set
  from the *Siirrä sarjaan…* (move to set) menu. Answers are kept.
- **Vie CSV** (export CSV, whole lecture) and a set's **CSV**: question, option or text, answer count and timestamp, no participant identifiers.
  Answers are decrypted in your browser, so the server does not see the file contents. Separator `;` and UTF-8 BOM, so Excel opens the file directly.
  Texts starting like a formula (`=`, `+`, `-`, `@`) are prefixed with an apostrophe (CSV injection prevention).

#### Import and export as JSON

*Tuo JSON* (import JSON) reads sets from a file, so questions can be kept in version control and copied for future
courses. Before saving, the app shows a summary: sets to import, questions to skip and errors.
Import is all or nothing. An error (including a set identifier already used in the lecture) prevents the whole import.
*Vie JSON* (export JSON, whole lecture) and a set's *Vie* (export) download the same format. Example: [tests/fixtures/mmoit-2026.json](tests/fixtures/mmoit-2026.json).

```json
{ "event": { "title": "…" },
  "sets": [ { "id": "M4", "title": "M4 Case", "questions": [
    { "type": "single", "text": "What is your FIRST action?", "options": ["A", "B"], "correct": [1], "explanations": ["…", "…"] },
    { "type": "scale", "text": "…", "min": 1, "max": 5, "minLabel": "Strongly disagree", "maxLabel": "Strongly agree" },
    { "type": "wordcloud", "text": "Cybersecurity in one word?", "maxWords": 3 } ] } ] }
```

| `type` | In the app |
|---|---|
| `single`, `multi` | Multiple choice. `correct` = indexes of the correct options (0-based), `explanations` = one explanation per option. Both optional, and neither is shown to participants. |
| `scale` | `min`–`max` 1–5 or 1–7 = Likert, 0–10 = scale |
| `wordcloud` | Word cloud, `maxWords` 1–3 |
| `open` | Open text, `multipleAnswers` = several answers |
| `qa` | Not supported; imported as the type in `fallbackType`, if given |

**Participant language** is chosen per lecture (creation form or lecture page): *English*, *Suomi* or by browser language.
Participants can still switch language with the FI/EN toggle.

### Presenter view, keyboard shortcuts and phone remote

*Aktiivinen projektorille* is the main presenter view for Teams sharing and the room projector. The corner always shows
the QR code, join code and answer count, and the question is in a large font (over 40 px at 1080p).

| Key | Action |
|---|---|
| → / PageDown | Next question (also a wireless presentation remote) |
| ← / PageUp | Previous question |
| Space | Open / close for answers |
| R | Show / hide results |
| A | Reveal correct answer |
| Q | Large QR code full screen |
| T | Light / dark theme (presenter window) |
| F or double-click | Full screen (presenter window) |

The keys work in the presenter window and the admin view (not in form fields). The presenter window does not use the API itself
but sends the command to the admin window.

**Phone remote:** sign in to the admin view on your phone and choose *Puhelinohjain* (phone remote, on the start view) or the lecture's *Ohjain* (remote).
Large buttons control the active question while you walk around the room. The remote does not decrypt messages, so no encryption key is needed.
The laptop driving the projector picks up the changes within a couple of seconds.

### Projector presentation

When the projector is connected as an extended display (not mirrored), the lecture's *…projektorille* (to projector) buttons open
a separate presenter window (`/admin/esitys`) on the second display. The admin view stays on the laptop screen.

- Chrome and Edge place the window automatically (Window Management API). The first time,
  the browser asks for permission to *manage windows*. If the pop-up is blocked because of the permission prompt, press the button again.
- In other browsers the window opens as a normal window: drag it to the projector display.
- Double-click or the F key toggles full screen, Esc exits.
- Questions, feedback and each poll open in their own windows, which can be open at the same time.
  Lists and results update automatically. Pressing the button brings the window to the front.
- *Tyhjennä projektori* (clear projector) blanks the display. The display is also cleared on sign-out and when the admin page is closed.

### No personal data

- The nickname is mandatory and unique within a lecture. The server stores only a keyed hash of it.
- The browser remembers the nickname and a random owner identifier (localStorage). Only the same browser can
  use a claimed nickname, and at the next lecture the same nickname is suggested.
- No emails, names, cookies, analytics or IP address storage for participants.

### Language

The participant pages are in Finnish and English (the admin view is always in Finnish). The language comes from the browser
settings and can be switched with the FI/EN toggle in the top corner. The choice is remembered only in the browser
(localStorage). Translations are in `src/I18n.php`, and a test ensures that every
key has both languages.

## Security in brief

| Layer | Solution |
|---|---|
| Message confidentiality | libsodium `crypto_box_seal` (X25519 + XSalsa20-Poly1305) in the browser |
| Private key | Unlocked in the browser with a passkey (WebAuthn PRF) or, as a fallback, a passphrase (Argon2id, 64 MiB). The server sees neither |
| Admin sign-in | Passkey (WebAuthn), user verification required, no passwords |
| Session | `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, 30 min idle / 8 h maximum |
| CSRF | Origin and `Sec-Fetch-Site` check + CSRF token (admin) / stateless HMAC form token (participant) |
| XSS | Strict CSP without `unsafe-inline`, decrypted messages inserted into the DOM only with `textContent` |
| Abuse | Per-nickname and per-lecture limits, single-use challenges, security log |
| Storage | SQLite outside the webroot, parametrized queries, `secure_delete` |

Detailed threat model and residual risks: [SECURITY.en.md](SECURITY.en.md).

## CI/CD pipeline

Every push and pull request runs:

- **PHPUnit**: unit tests and security tests (CSRF, origin, access control, injection, XSS,
  nickname ownership, rate limits, session timeouts, security headers, absence of personal data)
- **PHPStan** level 8 + strict rules
- **composer audit**: known vulnerabilities in dependencies
- **Semgrep (SAST)**: PHP, JavaScript, OWASP Top 10, secrets
- **Gitleaks**: leaked secrets in the whole git history
- **OWASP ZAP baseline (DAST)**: scan of the running application
- **CodeQL**: JavaScript security analysis
- **Vendor integrity**: SHA-256 check of browser libraries
- **Crypto tests**: interoperability of the browser and admin encryption format

When everything passes on the `main` branch, the app is deployed over FTPS to the web host and production is smoke-tested.

**Deploy freeze:** during the time windows in `.github/deploy-freeze.txt` (Finnish time) the deploy job stops, and nothing
is deployed to production. This covers, for example, the lecture on Fri 13.11. 14:00–20:30 and Sat 14.11. 08:30–15:30. In an emergency,
*Actions → CI/CD → Run workflow* and select *Ohita julkaisujäädytys* (skip deploy freeze). The file format is checked by PHPUnit in every PR.

ZAP rules are in `.zap/rules.tsv`: FAIL breaks CI, WARN is reported and IGNORE is skipped with a justification.

### Dependency updates (Dependabot)

Dependabot checks GitHub Actions and Composer package updates weekly and opens
a pull request for them (`.github/dependabot.yml`). A new version is proposed only after it has been published for
7 days. All Actions updates are grouped into one PR, and they stay pinned to a commit SHA.

- Read the PR changes and release notes and merge when CI is green.
- If the PR has fallen behind `main`, comment `@dependabot rebase`. If new updates have arrived in the group
  meanwhile, Dependabot closes the old PR and opens a new one.
- A randomly failed job (e.g. ZAP exit code 3) is re-run from the PR's *Checks* tab
  (*Re-run failed jobs*).

## Deployment (cPanel)

Directory layout on the web host:

```
~/public_html/hessutalks/               FTP account root = app URL folder  ← deploy
    index.php, .htaccess, assets/       public files
    app/                                application code, direct access blocked
~/hessutalks-data/                      config.php, database, sessions  ← outside the webroot,
                                        deploy never touches this
```

The deploy account is restricted to the application folder only. Even if the credentials leaked, they would give no
access to the database or other parts of the site.

1. **PHP version:** cPanel → *MultiPHP Manager* → hessujarvinen.com → **PHP 8.4** (ea-php84).
   Make sure the extensions `sodium`, `pdo_sqlite`, `mbstring` and `intl` are enabled (*Select PHP Version → Extensions*).
2. **FTP account:** cPanel → *FTP Accounts* → e.g. `deploy-hessutalks@hessujarvinen.com`.
   Set the Directory field to the application folder under the site root (`public_html`): `public_html/hessutalks`.
3. **GitHub:** (a deploy starts from a push to `main` or *Actions → CI/CD → Run workflow*) repo → *Settings → Environments* → create the environment `production` and add the secrets:
   - `FTP_SERVER`: e.g. `ftp.hessujarvinen.com`
   - `FTP_USERNAME`: the full user name of the FTP account
   - `FTP_PASSWORD`: the FTP account password

   If the app is not at `https://hessujarvinen.com/hessutalks`, add the variable `APP_URL` under
   *Settings → Secrets and variables → Actions → Variables*.
   Optionally add *Required reviewers* → yourself to the environment, so every deploy waits for your approval.
4. **Configuration file:** after the app has been deployed once, open cPanel → *Terminal* and run:
   ```sh
   php ~/public_html/hessutalks/app/bin/init.php --origin=https://hessujarvinen.com --base=/hessutalks
   ```
   The command creates `~/hessutalks-data/config.php` directly in the right place in the home directory,
   outside the site, with the correct file permissions. It prints a **setup token**, which you should save for a moment.
   The app finds the configuration automatically.

   *If cPanel has no Terminal:* run the same command on your own machine in the repo root (`php bin/init.php … --data=/home/CPANEL-USER/hessutalks-data --out=config.php`,
   requires PHP, e.g. `brew install php`). Then upload `config.php` with File Manager to the `hessutalks-data` folder in the home directory (permissions `700`/`600`).
5. **First sign-in:** open `https://hessujarvinen.com/hessutalks/admin`, enter the setup token and create a passkey.
   Then create the encryption keys with a passphrase. Save the passphrase in a password manager
   and keep the downloaded backup file safe.
6. **Backup passkey:** add a second passkey from the *Asetukset* (settings) page, for example on your phone.
7. **Unlock with a passkey:** sign in once with each passkey and unlock the key with the passphrase. The app
   stores an encrypted per-passkey copy, after which Touch ID / Face ID alone also unlocks the questions.
   Requires PRF support (Safari 18 / macOS 15 / iOS 18, Chrome, Edge). Otherwise the passphrase is asked as before.

## Local development

```sh
composer install
php bin/init.php --dev                  # creates var/config.php and prints the setup token
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
```

Admin: <http://localhost:8080/admin>. Passkeys work on `localhost` without HTTPS.

`HESSUTALKS_CONFIG=var/config.php php bin/seed-demo.php` creates test keys and an open lecture and prints
its code. CI uses it for the ZAP scan. The script refuses to run with production settings.

Tests:

```sh
vendor/bin/phpunit --testdox
vendor/bin/phpstan analyse --memory-limit=1G
node --test tests/js/*.test.mjs
scripts/verify-vendor.sh
scripts/e2e.sh          # browser tests: real Chrome (headless) and a virtual passkey
```

The browser tests (`tests/e2e/`) start their own server with a temporary database. They drive
the admin view and the participant side by side in their own windows and verify acceptance tests, see
[docs/hyvaksymistestit.en.md](docs/hyvaksymistestit.en.md). They require Chrome (preinstalled on macOS, otherwise `CHROME=...`).

## Browser libraries

`public/assets/vendor/` contains the [libsodium.js](https://github.com/jedisct1/libsodium.js) and
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) libraries (both open source, licenses in the same directory).
They are fetched directly from the source repositories with `scripts/update-vendor.sh`, and their SHA-256 sums are pinned in `VENDOR.lock`.
No libraries are loaded from a CDN.

## Status

The requirements of the MMoIT 2026 course (13.–14.11.2026) have been implemented, and the load test with 150 participants passed in production on 29.10.2026.
Acceptance tests and their verification: [docs/hyvaksymistestit.en.md](docs/hyvaksymistestit.en.md).
Remaining: a trial run with real devices and Teams. The 200-participant load test has been postponed, and question upvotes (Q&A, COULD) were left out.

## License

MIT, © Hessu Järvinen
