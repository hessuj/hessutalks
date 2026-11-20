# HessuTalks

[Suomi](README.md) · **English**

End-to-end encrypted question and feedback channel for lectures and talks.
Participants join a lecture with a code or QR code and send questions under a nickname.
Only the lecturer can read the messages.

Address: <https://hessujarvinen.com/hessutalks/>

**User guide with screenshots:** [docs/user-guide.md](docs/user-guide.md)

## How it works

1. The lecturer creates a lecture in the admin view. The app gives a 6-character code and a QR code. The title can be edited later (*Muokkaa otsikkoa*, edit title), and the code stays the same.
2. The participant opens the page, chooses a nickname and writes a question or feedback.
3. The message and nickname are encrypted in the participant's browser with the lecturer's public key.
4. The lecturer unlocks the messages in their own browser with a passkey or passphrase. They update in real time,
   and the QR code, questions with their results and individual messages can be shown on the board (projector).

### Polls and question sets

A lecture consists of **question sets** (e.g. modules `M1`, `M4`) containing questions in order.
Question types: multiple choice (one or several answers), open text (default 280 characters, up to 3,500 or about 500 words for reflection tasks, optionally several answers), word cloud (1–3 words, 30 characters), Likert scale (5 or 7 points) and a 0–10 scale.

One lecture can cover a whole course or lecture series: the sets divide it into lectures (e.g. `L1`–`L4`), and participants
use the same code and nickname throughout the course. The admin lecture page has three tabs: *Kysymykset* (prepared
questions by set), *Vapaat kysymykset* (free-form questions) and *Palautteet* (feedback). The message tabs show the number of new ones.

The admin view has no separate modes and no active question: the actions for each question and message are on its row
([#60](https://github.com/hessuj/hessutalks/issues/60)).

1. Create the sets (*Uusi sarja*, new set) and their questions (*Uusi kysymys*, new question), or import them from a JSON file,
   before the lecture. *Sarja ▾* (set) on the set's title row opens editing, ordering, export, duplication and deletion of the set.
2. **The question row** holds the actions used during the lecture:
   - *Näytä taululla* (show on board) brings the question to the projector next to the others and opens it for answers with one button.
   - *Sulje* (close) stops accepting answers, and the question stays on the board (*Avaa vastauksille*, open for answers, reopens it).
   - *Poista taululta* (remove from board) takes the question off the projector and the participants' phones. Answers are kept,
     and showing it again opens it again.
   - *Näytä tulokset* (show results) and *Paljasta oikea vastaus* (reveal correct answer), see item 6.
3. **Clicking the row** opens the question's results and moderation and its editing below it: *Esikatsele* (preview), *Muokkaa* (edit),
   ordering, *Siirrä sarjaan…* (move to set), *Palauta luonnokseksi* (back to draft), *Tyhjennä vastaukset* (clear answers) and *Poista* (delete).
   *Piilota* (hide) closes it. Clearing answers and deleting are only here, behind a confirmation, so that answers given during the lecture are not deleted by accident.
4. **The board** can show several questions and messages at the same time: the projector shows them as a grid, and participants
   see the questions one below the other and can answer every open one. Only a question on the board can be open.
   *Palauta luonnokseksi* takes a published question off the board and away from participants and hides its results and correct
   answer. Given answers are kept, and the question can be shown again.
5. Participants use the same lecture QR code or link the whole time. The view changes by itself within about
   a second without reloading the page. After a connection loss the page reconnects, and the participant's own answer survives a reload.
6. **Results and reveal:** results are hidden at first (the projector shows the question, the options and the answer count).
   *Näytä tulokset* (show results) brings them to the projector and, as a summary, to the participants' phones (multiple choice and scales).
   *Paljasta oikea vastaus* (reveal correct answer) highlights the correct options and shows the explanations, if the question has a correct answer.
   Correct answers and explanations are entered in the question form or the JSON file, and they are not sent to participants before the reveal.
7. **Free-form questions and feedback** are shown on their own tabs, newest first. A message row has *Näytä taululla* /
   *Poista taululta* (at most 6 messages on the board at a time), *Merkitse vastatuksi* (mark as answered; feedback: *Merkitse käsitellyksi*,
   mark as handled), which *Palauta uudeksi* (back to new) undoes, and *Poista* (delete).
8. **The board row** at the top of the lecture page has *Avaa esitysnäyttö* (open presenter display, with the connection status), *QR isona*
   (large QR) and *Tyhjennä taulu* (clear board). The presenter display is a single window showing everything chosen for the board. Empty board: the lecture QR code.
9. **Moderation:** an open-text answer can be hidden with the *Piilota* (hide) button and a word-cloud word by clicking it in the
   question's expanded part. A hidden item disappears from the projector immediately.
   The profanity filter (English and Finnish) hides matches automatically, and they wait for approval (⚠ … ✓).
   Hidden items are stored on the server encrypted with the lecturer's key, so they persist across reloads.
10. **Archiving:** *Arkistoi* (archive) on the lecture page closes questions, clears the board and moves the lecture to the archive. Data is kept.
    Archiving is manual only. A lecture can be restored from the archive as closed and then reopened as usual.

Polls are answered without a nickname. Answers are encrypted in the browser like questions, and results
are computed in the lecturer's browser, so the admin view must be open and unlocked. A new answer from the same browser
replaces the earlier one until the poll is closed.

#### Preview, duplicate, move and CSV

- **Esikatsele** (preview, in the question's expanded part) opens the question in the participant layout (a phone-sized window,
  no answer is sent) and **Esikatsele projektorilla** (preview on projector) in the presenter view before opening it.
- **Monista** (duplicate) copies a set with its questions but without answers (the identifier gets the suffix `-2`). A question can be moved to another set
  from the *Siirrä sarjaan…* (move to set) menu. Answers are kept.
- **Vie CSV** (export CSV, whole lecture or from the set's *Sarja ▾* menu): question, option or text, answer count and timestamp, no participant identifiers.
  Answers are decrypted in your browser, so the server does not see the file contents. Separator `;` and UTF-8 BOM, so Excel opens the file directly.
  Texts starting like a formula (`=`, `+`, `-`, `@`) are prefixed with an apostrophe (CSV injection prevention).
- **Vie Markdown** (export Markdown): a report (`.md`) of the whole lecture or lecture series: sets, questions and results as tables, correct answers,
  open answers and the participants' questions and feedback. No nicknames; hidden and archived items are left out. Decrypted in your browser.

#### Import and export as JSON

*Tuo JSON* (import JSON) reads sets from a file, so questions can be kept in version control and copied for future
courses. Before saving, the app shows a summary: sets to import, questions to skip and errors.
Import is all or nothing. An error (including a set identifier already used in the lecture) prevents the whole import.
*Vie JSON* (export JSON, whole lecture or from the set's *Sarja ▾* menu) downloads the same format. Example: [tests/fixtures/mmoit-2026.json](tests/fixtures/mmoit-2026.json).
Full description of the file format: [docs/import-format.md](docs/import-format.md). When you give an AI your learning
material and this description, it can produce an import file directly from the material.

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
| `open` | Open text, `multipleAnswers` = several answers, `maxLength` = maximum length in characters 280–3500 (default 280). Participants see a counter, e.g. `240/3500`. The projector shows the first 280 characters of long answers, the admin view and CSV the full text. |
| `qa` | Not supported; imported as the type in `fallbackType`, if given |

**Participant language** is chosen per lecture (creation form or lecture page): *English*, *Suomi* or by browser language.
Participants can still switch language with the FI/EN toggle. The projector's own texts (e.g. the answer count and "Results will
be shown later") follow the same choice: *English* → English, *Suomi* and *by browser language* → Finnish. The admin view is always in Finnish.

### Presenter view and keyboard shortcuts

The presenter display is the lecture's presenter view for Teams sharing and the room projector. The bottom always shows the
QR code and join code, and each question shows its answer count. If there are more answers than fit, the tile scrolls. A single question fills the screen (question over 40 px at 1080p).
Several are split into a grid (at most 12), and the fonts shrink with the tile size.

| Key | Action |
|---|---|
| Q | Large QR code covering the screen (moves aside when you bring something to the board). Also works in the admin view. |
| T | Light / dark theme (presenter window) |
| F or double-click | Full screen (presenter window) |

Controlling questions with keys (next/previous, open, results, reveal) was removed when the admin view was simplified
([#60](https://github.com/hessuj/hessutalks/issues/60)): the actions are on the question's row. On a phone, the same actions
are in the **phone remote** ([#63](https://github.com/hessuj/hessutalks/issues/63), user guide section 5.5).

### Projector presentation

When the projector is connected as an extended display (not mirrored), *Avaa esitysnäyttö* opens the presenter window.
*Näytä taululla* (show on board) also opens it if it is not open. The admin view stays on the laptop
screen. The top of the lecture page shows whether the presenter display is connected (● yhdistetty).

- Chrome and Edge place the window automatically (Window Management API). The first time,
  the browser asks for permission to *manage windows*. If the browser blocks the pop-up, allow pop-ups for the page and press the button again.
- In other browsers the window opens as a normal window: drag it to the projector display.
- Double-click or the F key toggles full screen, Esc exits.
- There is only one presenter window: everything chosen for the screen is shown in it. Lists and results update automatically.
- The connection recovers by itself if the presenter window or the admin view is reloaded (in the admin view after unlocking the key).
- *Tyhjennä taulu* (clear board) removes everything from the board (the QR code remains). Questions on the board are closed,
  and answers are kept. The display is also cleared on sign-out and when the admin page is closed.

### No personal data

- The nickname is mandatory and unique within a lecture. The server stores only a keyed hash of it.
- The browser remembers the nickname and a random owner identifier (localStorage). Only the same browser can
  use a claimed nickname, and at the next lecture the same nickname is suggested.
- No emails, names, cookies, analytics or IP address storage for participants.

### Language

The participant pages are in Finnish and English (the admin view is always in Finnish). The language comes from the lecture setting
(participants' language), otherwise from the browser settings, and can be switched with the FI/EN toggle in the top corner. The choice is
remembered per lecture only in the browser (localStorage), so it does not affect other lectures. Translations are in `src/I18n.php`, and a test ensures that every
key has both languages.

## Security in brief

| Layer | Solution |
|---|---|
| Message confidentiality | libsodium `crypto_box_seal` (X25519 + XSalsa20-Poly1305) in the browser |
| Private key | Unlocked in the browser with a passkey (WebAuthn PRF) or, as a fallback, a passphrase (Argon2id, 64 MiB). The server sees neither |
| Admin sign-in | Passkey (WebAuthn), user verification required, no passwords |
| Session | `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, 3 h idle / 8 h maximum |
| CSRF | Origin and `Sec-Fetch-Site` check + CSRF token (admin) / stateless HMAC form token (participant) |
| XSS | Strict CSP without `unsafe-inline`, decrypted messages inserted into the DOM only with `textContent` |
| Abuse | Per-nickname and per-lecture limits, single-use challenges, security log |
| Storage | SQLite outside the webroot, parametrized queries, `secure_delete` |

Detailed threat model and residual risks: [SECURITY.en.md](SECURITY.en.md). An example of incident handling: [presenter display incident review](docs/incident-presenter.md).

## CI/CD pipeline

Every push and pull request runs the security stages in this order. Each stage stores its report as a run
artifact (*Actions → run → Artifacts*):

1. **Gitleaks**: leaked secrets in the whole git history
2. **Semgrep (SAST)**: PHP, JavaScript, OWASP Top 10, secrets
3. **Trivy (SCA)**: known vulnerabilities in dependencies (`composer.lock`). The pipeline stops on a CRITICAL finding.
4. **Trivy (SBOM)**: software bill of materials in CycloneDX JSON: PHP dependencies and vendored browser libraries
   with SHA-256 hashes (`scripts/sbom-vendor.py`)
5. **OWASP ZAP baseline (DAST)**: scan of a test instance started in CI, never production

Trivy is installed from its release with a pinned SHA-256 hash (`scripts/install-trivy.sh`), not as a GitHub Action:
`aquasecurity/trivy-action` was compromised in March 2026 (CVE-2026-33634).

In parallel:

- **PHPUnit**: unit tests and security tests (CSRF, origin, access control, injection, XSS,
  nickname ownership, rate limits, session timeouts, security headers, absence of personal data)
- **PHPStan** level 8 + strict rules
- **composer audit**: known vulnerabilities in dependencies
- **CodeQL**: JavaScript security analysis
- **Vendor integrity**: SHA-256 check of browser libraries
- **Crypto tests**: interoperability of the browser and admin encryption format

When everything passes on the `main` branch, the app is deployed over FTPS to the web host and production is smoke-tested.

**Deploy freeze:** during lectures the deploy job stops, and nothing is deployed to production. The time windows are in the
`production` environment variable `DEPLOY_FREEZE` (*Settings → Environments → production → Variables*), not in the public repo, and
the log does not reveal them. One window per line in Finnish time: `YYYY-MM-DD HH:MM  YYYY-MM-DD HH:MM  # description`. An invalid
variable blocks the deploy. In an emergency, *Actions → CI/CD → Run workflow* and select *Ohita julkaisujäädytys* (skip deploy freeze).

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

## Deployment

HessuTalks is a PHP 8.4 application that is installed on a web server in a directory of its own. No database
server is needed. The public directory contains `index.php` and the `assets/` folder, the application code is in
its `app/` subfolder (direct access denied), and the settings, database and sessions are in a data directory outside
the webroot. Installing on Apache, nginx or another server, creating the configuration file, a verification
checklist and updates: [docs/installation.md](docs/installation.md).

## Local development

```sh
composer install
php bin/init.php --dev                  # creates var/config.php and prints the setup token
HESSUTALKS_CONFIG=var/config.php php -S localhost:8080 -t public bin/dev-router.php
```

Open the admin view through the development server. Passkeys work on `localhost` without HTTPS.

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

The requirements of the MMoIT 2026 course have been implemented, and the load test with 150 participants passed in production.
Acceptance tests and their verification: [docs/hyvaksymistestit.en.md](docs/hyvaksymistestit.en.md).
Development tasks, user stories and specifications are kept as a backlog in [GitHub Issues](https://github.com/hessuj/hessutalks/issues). Question upvotes (Q&A, COULD) were left out.

## License

MIT, © Hessu Järvinen
