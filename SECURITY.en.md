# Security

[Suomi](SECURITY.md) · **English**

## Reporting vulnerabilities

Report vulnerabilities privately with GitHub's *Security → Report a vulnerability* feature.
Do not open a public issue.

## Assets to protect

1. The content of participants' messages
2. Participants' anonymity: the app does not collect personal data
3. Administrator access to the admin view
4. Availability of the service during a lecture

## Threat model

| Threat | Mitigation |
|---|---|
| Database or backup leaks | Messages and nicknames exist only encrypted. The private key is encrypted with an Argon2id passphrase. Only an HMAC hash of each nickname is stored. |
| Web host files are read | As above. In addition, `app_secret` protects the HMAC hashes and form tokens. |
| Unlocking the private key with a passkey | WebAuthn PRF: the passkey computes a secret value inside the device from a per-passkey salt. The browser derives a key from it and encrypts a copy of the private key with it. The server holds only the salt and the encrypted copy. The PRF value never leaves the browser, so a database leak does not reveal the key. A copy can be stored only for the passkey the session signed in with, and it is removed together with the passkey. The passphrase and backup remain as fallbacks. |
| Sign-in guessing or phishing | A passkey is bound to the origin, so there is no password to phish. Challenges are single-use and expire in 3 minutes. Sign-in attempts are rate-limited. |
| Session hijacking or fixation | `__Host-` cookie, `HttpOnly`, `SameSite=Strict`, identifier regenerated on sign-in, timeouts |
| CSRF | Exact Origin comparison, `Sec-Fetch-Site` check, CSRF token, JSON requests only |
| XSS via messages | CSP without inline scripts. Decrypted content is inserted into the DOM only with `textContent`. Templates are escaped. |
| Using someone else's nickname | The claim is bound to a random 256-bit owner identifier, of which the server stores only a hash |
| Projector presenter window | The presenter window has no encryption key and no crypto library. The admin window sends it only the text to display with `postMessage` to its own origin. The presenter window accepts messages only from its opener and from the same origin, and it requires sign-in. The display is cleared when the admin window is closed. |
| Presenter window commands | The presenter window has no access to the API. A keyboard shortcut sends a `postMessage` command to the admin window on its own origin. The admin view accepts messages only from its own presenter windows and only known commands, and performs the action as a normal signed-in request (CSRF token). |
| Phone remote | Requires sign-in (passkey) like the rest of the admin view, but no encryption key, because it does not handle message content. |
| Poll answers | The answer is encrypted in the browser (sealed box) and bound to the lecture and poll inside the encrypted content. The server accepts an answer only to the lecture's active and open question, and the participant sees only that question (no drafts, no other questions). The lecturer's browser rejects malformed answers or answers encrypted for another poll. The question text and options are the lecturer's public content and are stored in plaintext. |
| Moderation | Hidden answers and words, as well as filter approvals, are encrypted with the lecturer's public key (sealed box) before storage, so the server does not see hidden words. The profanity filter runs in the lecturer's browser. Open-text answers are displayed only with `textContent` (H6). |
| Multiple open-text answers | When a poll allows several answers, each answer gets a random hash, so answers from the same participant cannot be linked in the database. Limited by a rate limit and a per-poll maximum. |
| Results summary for participants (decision P2) | When the lecturer shows the results, their browser publishes a summary to the server (option counts, mean, median). This is a deliberate exception to the principle that the server does not see content: the summary is the same one shown on the projector and in Teams. Only multiple choice and scales, no open-text answers and no word cloud. The server checks the format and limits, and hiding removes the summary. |
| CSV export | Answers are decrypted in the lecturer's browser, so the server does not see the file. No participant identifiers. Formula injection prevention: participant text starting with `=`, `+`, `-` or `@` gets an apostrophe in front, so Excel does not execute it as a formula (e.g. `=HYPERLINK(...)`). |
| Preview | `/admin/esikatselu` requires sign-in and shows only public fields (no correct answers). No answer is sent. |
| Correct answers before the reveal | Correct answers and explanations are only in the admin API. The participant API (`/api/live`), the state file and the page filter them out, so they cannot be seen even with the browser's developer tools. |
| Participant state file (`live/`) | The shared server's PHP process limit was reached at about 90 participants, so the participant's browser reads the state from a static file that Apache serves without PHP. The content is the same public state as in the `/api/live` response: the active question, the options and, after the reveal, the correct answer. No encrypted answers, nicknames or messages. The name is a keyed hash of the lecture id and is given on the lecture page, so lecture codes cannot be probed through file names around the lookup limits. A closed lecture's file contains no question, and deleting the lecture deletes the file. `live/.htaccess` allows only names written by the app, prevents caching and does not route missing files to PHP. |
| Identifying a poll respondent | No nickname. Only a per-poll HMAC of the browser's random identifier is stored, so answers from the same browser in different polls cannot be linked in the database. |
| Moving a message to another lecture | The lecture code is inside the encrypted message. The admin view warns about a mismatch. |
| Spam | Per-nickname and per-lecture limits and per-lecture maximums |
| Mass submission of poll answers (H9) | At most 10 answers per minute per device and question (excess gets 429). In addition, 600 answers per minute per address (P3). The address limit drops excess answers **silently** (the script sees success, nothing is stored), so a script cannot tune its rate. Only a keyed hash of the address is stored, and the rows are deleted right after the one-minute window. The limit is generous because a lecture room may appear as one address (NAT). |
| Guessing lecture codes | Space 31⁶ ≈ 887 million. Failed lookups are rate-limited at the service level. |
| Supply chain | Browser libraries vendored with SHA-256 pinning, no CDN. Actions pinned to commit SHAs. Dependabot, composer audit. |

## Residual risks

- **Server takeover and JavaScript replacement.** All browser-based end-to-end encryption
  relies on the code delivered by the server. If an attacker can modify files on the web host,
  they can replace the script with one that leaks *future* messages or the passphrase. Messages already stored remain protected.
  Mitigations: deploys only through CI/CD, protection of the FTPS credentials and a production smoke test.
- **Loss of the passphrase.** Messages cannot be recovered without the passphrase. This is intentional.
- **Web host logs.** Apache may log IP addresses in server logs outside the application.
  The retention of at most 7 days required by requirement 7.7 is set in cPanel: *Raw Access* → disable
  *Archive logs in your home directory* or limit archiving, so logs rotate according to the host's default.
  The app itself does not store IP addresses.
- **Participants' own information.** If a participant writes personal data into a nickname or message,
  it is stored encrypted. The form advises against doing so.
- **Users on the same network.** Limits are not based on IP addresses, so a lecture room can be behind NAT without harm.
  This also means that an individual troublemaker can be limited only by nickname.
- **Multiplying poll votes.** Because respondents are not identified, a modified client can create
  new random identifiers and answer several times. Limits: form token, per-device rate limit,
  per-address rate limit and a per-poll maximum (3000). Polls suit surveying opinions and knowledge, not votes
  whose outcome has consequences.

## Administrator checklist

- Keep at least two passkeys (e.g. MacBook and iPhone).
- Save the passphrase in a password manager and the key backup in a safe place.
- Check *Asetukset → Tietoturvaloki* (settings → security log) from time to time.
- Delete old lectures when their messages are no longer needed.
