# Acceptance tests – MMoIT 2026 (13.–14.11.2026)

[Suomi](hyvaksymistestit.md) · **English**

The tests in chapter 9 of the requirements document and their verification. Updated in the PR of each phase.

Legend: ✅ verified · 🟡 partly · ⏳ not yet implemented · 🧪 verified in a trial run with Hessu (real devices / Teams)

Verification methods:
- **PHPUnit**: `vendor/bin/phpunit` (CI runs it for every PR)
- **Node**: `node --test tests/js/*.test.mjs` (CI)
- **Load**: `scripts/e2e.sh load.mjs` (locally, admin and presenter window in a real Chrome) and `node scripts/load-test.mjs <participant link>` (any environment; in production only against a test lecture, `--production`).
- **Browser**: `scripts/e2e.sh` (`tests/e2e/`), real Chrome (headless) and a virtual passkey, admin and participant in their own windows. Run locally, not yet in CI.

| # | Test | Status | How verified |
|---|---|---|---|
| H1 | Joining with a QR code on iPhone, Android and laptop | 🧪 | Browser: the lecture link opens the waiting screen without sign-in (`live-polls.mjs`). Real devices in the trial run. |
| H2 | Presenter opens question T1, the view changes in under 2 s | ✅ | Browser: *Avaa vastauksille* (open for answers) → the participant view changed in 1.0–1.6 s without a reload (local server, polling 1.2 s). Production network latency is checked in the trial run. |
| H3 | Changing the answer in T1: only the latest counts | ✅ | Browser: answer and change → 1 answer in the admin view. PHPUnit `testSameBrowserReplacesItsAnswer`. |
| H4 | Closing prevents answering and the participant sees the state | ✅ | Browser: *Sulje vastaukset* (close answers) → "This poll is closed", fields disabled. PHPUnit `testAnswerRequiresOpenPollOfThisEvent` (also: open but not active → 409). |
| H5 | T2 scale: distribution and mean correct | ✅ | Node `results.test.mjs` (distributions and statistics). T2 = Likert 5 with labels. |
| H6 | T3: `<script>alert(1)</script>` is shown as text | ✅ | Browser `open-text.mjs`: the participant sends `<script>alert(1)</script><img src=x onerror=alert(2)>`, and it is shown as text in the admin view and on the projector. No element or alert dialog is created (the test would fail on an alert). Node `results.test.mjs` (text stays text), PHPUnit `testBrowserScriptsNeverUseHtmlInjectionSinks` (no innerHTML in any script). |
| H7 | Moderation in T3: a hidden item disappears immediately | ✅ | Browser `open-text.mjs`: *Piilota* (hide) → the answer disappeared from the projector within a few milliseconds. Hiding persists across reloads (encrypted on the server). The profanity filter hides matches for review; approval makes them visible. |
| H8 | A participant calls the presenter API → 401/403 | ✅ | PHPUnit `testAdminPollRoutesRequireLogin` (all poll, set and control routes → 401), `testProtectedRoutesRequireLogin`, CSRF → 403. |
| H9 | The same device answers 50 times with a script | ✅ | PHPUnit `testScriptedRepeatAnswersCountOnceAndAreRateLimited`: 50 attempts → 10 accepted, 40 get 429, one answer in the database; allowed again after a minute. Address limit `testAddressRateLimitDropsSilentlyAndForgetsAddress`: silent rejection, no IP address, the hash is deleted after the window. |
| H10 | Connection loss and recovery | ✅ | Browser: network off → "Connection lost. Reconnecting…", network back → the state updates. A reload shows the active question and the participant's own answer. |
| H11 | Closed on Friday, reopened on Saturday | ✅ | PHPUnit `testEventCanBeClosedAndReopenedWithAnswersKept`: closed → 410, reopened → the same code works, answers kept. The admin session expires overnight (8 h), so on Saturday you sign in again with a passkey. |
| H12 | Reordering and skipping sets during the event | ✅ | Browser: skipping, restoring and moving a set change the Next/Previous order. PHPUnit `LiveRepositoryTest`, `testAdminControlsSetsAndActiveQuestion`. Answers are kept (skipping deletes nothing). |
| H13 | Load: 150 participants | ✅ | Browser `load.mjs` + `scripts/load-test.mjs` (locally 28.10.): 150 participants, about 108 requests/s, 0 errors, state request p95 16 ms. An opened question was visible to everyone within 1.2 s. The delay from an answer to the answer count in the presenter view was at most 1,978 ms while the admin view refreshed every 2.5 s; the interval was shortened to 1 second, after which the delay was at most 677 ms (median 260 ms). **Production 28.10.:** HTTP 508 at about 90 participants (cPanel Entry Processes limit about 32). Fix: participants read the state from a static file (`live/`, Apache without PHP). Locally after that, 0 PHP state requests with 150 participants. **Production 29.10. (PR #20 deployed):** 150 participants for 305 s on a test lecture, 36,171 requests (118.6/s), 0 errors, 0 PHP state requests, state file p50 18 / p95 31 / max 142 ms. An opened question was visible to everyone within 1.2 s, 150/150 poll answers arrived (p95 40 ms), the presenter view updated smoothly (Hessu watched on the projector). The 200-participant SHOULD test was postponed (Hessu's decision 27.10.). |
| H14 | JSON import with the chapter 10 file | ✅ | PHPUnit `SetFormatTest::testCourseFileIsImportedCompletely`, `testImportCourseFileWithDryRunFirst` and browser `import-json.mjs`: the course file as such produces 9 sets and all 22 questions in the right order. Correct answers and explanations are kept, and the M6 Q&A is imported as open text (`fallbackType`). Export and re-import produce the same questions (`testExportRoundTrips`). |
| H15 | Presenter view readable in Teams sharing | 🧪 | Browser `presenter.mjs`: in a 1920×1080 view the question font is about 67 px (requirement about 40 px), code, QR and answer count always in the corner, large QR (Q), light theme (T). Actual readability in the Teams recipient's view in the trial run. |

## Status of the phases

| Phase | Content | Status |
|---|---|---|
| 1 | Admin sign-in: unlocking with a passkey (PRF) | ✅ PR #8–#10. Verified on Hessu's device: Safari + Apple Passwords. 1Password left out (Hessu's decision 28.10.), passphrase as fallback. |
| 2 | Sets, active question, waiting screen, participant language | ✅ PR #11 |
| 3 | JSON import and export | ✅ PR #12 |
| 4 | T3 open text, persistent moderation, profanity filter, T4 30 characters | ✅ PR #13 |
| 5 | Correct answer, explanations, reveal, show/hide results, results for participants (SHOULD 4.8) | ✅ PR #14 (`reveal.mjs`) |
| 6 | Presenter view, keyboard shortcuts (also presentation remote), large QR, themes, phone remote (SHOULD 5.3) | ✅ PR #15 (`presenter.mjs`) |
| 7 | Rate limits (device 10/min, address hash 600/min silently), deploy freeze | ✅ PR #16 (`DeployFreezeTest`) |
| 8 | SHOULD: CSV export (formula injection prevention), set duplication, moving a question, preview. (Results for participants, themes, profanity filter and phone remote were done in phases 4–6.) | ✅ this PR (`should.mjs`) |

## Requirements coverage

| Chapter | MUST | SHOULD | COULD |
|---|---|---|---|
| 3 Question types | T1 ✅ T2 ✅ T3 ✅ | T4 ✅ T5 ✅ | T6 Q&A ✖ (P6: replaced by open text) |
| 4 Participant | 1–7, 9 ✅ | 8 results for participants ✅ | |
| 5 Presenter | 5.1, 5.2, 5.4 ✅ | 5.1 themes ✅, 5.3 phone remote ✅, 5.4 CSV ✅ | |
| 6 Content | creating and editing in advance ✅ | JSON ✅, duplication and moving ✅ | preview ✅ |
| 7 Security | 1–5, 7–9 ✅ | 6 profanity filter ✅ | |
| 8 Performance | 443 + fallback connection ✅ (short polling), deploy freeze ✅, 150 participants and results in under 2 s ✅ (locally and in production 29.10.) | load test 200 ⏳ (postponed) | |
| 9 Acceptance tests | H2–H12, H14 ✅; H1, H15 in the trial run 🧪; H13 ✅ (production 29.10.) | | |
