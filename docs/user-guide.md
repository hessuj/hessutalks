# HessuTalks user guide

[Suomi](kayttoohje.md) · **English**

HessuTalks is a question, feedback and poll channel for lectures. Participants join on their phones with a code or
QR code, ask questions under a nickname and answer polls. All messages and answers are encrypted on the participant's
device, and only the lecturer can read them.

In the pictures, a red frame marks the button or area being described. The number on the frame refers to the list below the picture.

**Contents**

1. [Getting started](#1-getting-started)
2. [Creating a lecture](#2-creating-a-lecture)
3. [Preparing questions](#3-preparing-questions)
4. [Participant view](#4-participant-view)
5. [During the lecture: questions on screen](#5-during-the-lecture-questions-on-screen)
6. [Results and moderation](#6-results-and-moderation)
7. [Participants' questions and feedback](#7-participants-questions-and-feedback)
8. [Phone remote](#8-phone-remote)
9. [Settings and signing in](#9-settings-and-signing-in)
10. [Keyboard shortcuts](#10-keyboard-shortcuts)

The admin view is always in Finnish, so this guide gives the Finnish button label followed by its meaning in brackets. Participant pages and projector texts are in English or Finnish according to the lecture language.

## 1. Getting started

Setup is done once. You need the setup token, which is printed when the administrator creates the configuration
file, and a device that supports passkeys (e.g. Touch ID, Face ID, Windows Hello or a security key).

### 1.1 Enable the admin view

Open the admin view. The administrator gives you its address.

![Enable the admin view](kuvat/en/01-kayttoonotto.png)

1. **Käyttöönottotunnus** (setup token): paste the token here.
2. **Passkeyn nimi** (passkey name): a device name to recognise the passkey later (e.g. *MacBook Pro*).
3. **Luo passkey** (create passkey): the browser asks you to confirm with a fingerprint, face or PIN. There is no password.

### 1.2 Create encryption keys

Messages are encrypted with a public key. They can only be opened with the private key, which is protected by a passphrase.

![Create encryption keys](kuvat/en/02-salausavaimet.png)

1. **Uusi tunnuslause** (new passphrase): at least 12 characters. Store it in a password manager.
2. **Toista tunnuslause** (repeat passphrase).
3. **Luo avaimet** (create keys): the browser downloads a key backup. Keep it safe.

> **Important:** if both the passphrase and the backup are lost, nobody can open the messages. The server never sees the passphrase.

## 2. Creating a lecture

### 2.1 New lecture

![New lecture](kuvat/en/03-luo-luento.png)

1. **Uuden luennon nimi** (name of the new lecture): shown to participants.
2. **Kysymykset auki** (questions open): how long participants can send messages (3 hours, a day, a week or until you close it).
3. **Osallistujien kieli** (participants' language): *English*, *Suomi* or by browser language. Participants can still switch language.
4. **Luo luento** (create lecture): opens the lecture page.

One lecture can cover a whole course: participants use the same code and nickname every time.

### 2.2 Lecture page: code and QR code

![Lecture code and QR code](kuvat/en/04-luennon-sivu.png)

1. **QR code**: show it on a slide or the projector. Participants join by scanning it.
2. **Join code**: six characters that can be typed on the home page.
3. **Link** to the participant page. Open it to see the participant view.
4. **Sulje kysymykset** (close questions): participants can no longer send messages. On a closed lecture the button reads *Avaa kysymykset* (open questions).
5. **Poista luento** (delete lecture): deletes the lecture and all its messages permanently.
6. **Osallistujien kieli** (participants' language): can be changed later. Projector texts change too.

### 2.3 Toolbar

![Toolbar](kuvat/en/05-tyokalupalkki.png)

1. **Muokkaa otsikkoa** (edit title): fixes the lecture name. The code and QR code stay the same, so links on slides keep working.
2. **Ohjain** (remote): the phone remote (see [section 8](#8-phone-remote)).
3. **Kaikki luennot** (all lectures): the lecture list.
4. **Asetukset** (settings): passkeys, encryption key and security log (see [section 9](#9-settings-and-signing-in)).
5. **Kirjaudu ulos** (sign out).

![Editing the title](kuvat/en/06-muokkaa-otsikkoa.png)

1. Type the new title.
2. **Tallenna otsikko** (save title).

### 2.4 Lecture list

![Lecture list](kuvat/en/37-luentolista.png)

1. A lecture row shows the code, name, number of new messages, creation time and number of messages.
2. **Avaa** (open): the lecture page.

## 3. Preparing questions

A lecture's questions are in **question sets**, for example one set per module or session.
Prepare the sets before the lecture in **Valmistelu** (preparation) mode.

### 3.1 Preparation tools

![Preparation tools](kuvat/en/11-valmistelu-tyokalut.png)

1. **Valmistelu** (preparation): create and edit sets and questions.
2. **▶ Luennolla** (in lecture): the mode used during the lecture (see [section 5](#5-during-the-lecture-questions-on-screen)).
3. **Tuo JSON** (import JSON): sets from a file (see [3.5](#35-import-and-export)).
4. **Vie JSON** (export JSON): all sets to a file, for example for the next course.
5. **Vie CSV** (export CSV): results as a table (Excel opens it directly).
6. **Vie Markdown** (export Markdown): a lecture report with questions, results and participants' messages.
7. **Uusi sarja** (new set).

### 3.2 New question set

![New question set](kuvat/en/07-uusi-sarja.png)

1. **Uusi sarja** (new set) opens the form.
2. **Tunniste** (identifier): a short code, e.g. `M1` (1–16 characters: A–Z, 0–9, - or _).
3. **Nimi** (name): the set title.
4. **Luo sarja** (create set).

### 3.3 New question

Press **Uusi kysymys** (new question) on the set row.

![New question](kuvat/en/08-uusi-kysymys.png)

1. **Kysymystyyppi** (question type, see the table below).
2. **Kysymys** (question): at most 300 characters.
3. **Vaihtoehdot** (options): one option per line, 2–10 options.
4. **Oikeat vastaukset** (correct answers): option numbers, e.g. `1` or `1, 3`. Leave empty if there is no correct answer.
5. **Selitykset** (explanations): an optional explanation for each option on its own line. Shown when you reveal the correct answer.
6. **Luo kysymys** (create question). A new question is a **draft**: participants do not see it until you open it.

Correct answers and explanations are not sent to participants before the reveal.

| Question type | Participant answers | Results |
|---|---|---|
| Monivalinta, yksi vastaus (multiple choice, one answer) | picks one | bars and percentages |
| Monivalinta, useita vastauksia (multiple choice, several answers) | picks one or more | bars and percentages |
| Sanapilvi (word cloud) | 1–3 words | word cloud, most common largest |
| Likert-asteikko (Likert scale) | 5 or 7 points | distribution, mean and median |
| Asteikko 0–10 (scale 0–10) | a number 0–10 | distribution, mean and median |
| Avoin teksti (open text) | free text | list, newest first |

Open text has its own settings:

![Open question](kuvat/en/09-avoin-kysymys.png)

1. **Kysymystyyppi** (question type): *Avoin teksti* (open text).
2. **Salli useita vastauksia** (allow several answers): a participant can send more than one answer. Otherwise a new answer replaces the previous one.
3. **Enimmäispituus** (maximum length): 280 characters by default. For reflection tasks up to 3,500 characters (about 500 words).

### 3.4 Set and question buttons

![Set buttons](kuvat/en/12-sarjan-painikkeet.png)

1. **↑ ↓**: move the set up or down.
2. **Ohita** (skip): leaves the set out of the *Next*/*Previous* order during the lecture. Answers are kept. *Palauta* (restore) brings it back.
3. **Muokkaa** (edit): identifier and name.
4. **Vie** (export): the set to a JSON file.
5. **CSV**: the set's results as a table.
6. **Monista** (duplicate): a copy of the set and its questions without answers.
7. **Uusi kysymys** (new question).
8. **Poista** (delete): the set, its questions and answers permanently.

![Question buttons](kuvat/en/13-kysymyskortti.png)

1. **↑ ↓**: move the question within the set.
2. **Esikatsele** (preview): the question as participants see it (a phone-sized window). No answer is sent.
3. **Esikatsele projektorilla** (preview on projector): the question in the presenter view in its own window.
4. **Muokkaa** (edit): question text, options and correct answers. The type cannot be changed.
5. **Siirrä sarjaan…** (move to set): moves the question with its answers to another set.
6. **Tyhjennä vastaukset** (clear answers): deletes the question's answers after confirmation. Only in preparation mode.
7. **Poista** (delete): the question and its answers permanently.
8. The correct answers are shown only to you (*Oikea: 1 · selitykset*, correct: 1 · explanations).

A published question also has **Palauta luonnokseksi** (return to draft): the question leaves the screen and the
participants, and results and the correct answer are hidden again. Given answers are kept.

<img src="kuvat/en/14-esikatselu.png" alt="Preview as a participant" width="260">

1. The preview has a notice at the top that no answer is sent.

### 3.5 Import and export

Questions can be written into a file and imported at once. The file format is described in a separate guide,
[Question import file](import-format.md). When you give an AI your learning material and that description, it can
produce an import file directly from the material.

![JSON import](kuvat/en/10-tuo-json.png)

1. **Tuo JSON** (import JSON): choose the file.
2. The summary shows the sets and questions to import and any errors. Nothing is saved yet.
3. **Tuo** (import): saves the sets. If the file has an error, nothing is imported.

Reports:

- **Vie CSV** (export CSV): question, option or text, answer count and timestamp. No participant identifiers.
- **Vie Markdown** (export Markdown): a report of the whole lecture: results as tables, correct answers, open answers
  and participants' questions and feedback. No nicknames.

Answers are decrypted for the reports in your own browser. The server does not see the report contents.

## 4. Participant view

### 4.1 Joining

A participant scans the QR code or opens the home page and types the code.

<img src="kuvat/en/15-etusivu.png" alt="Home page" width="260">

1. **Lecture code**: the lecture's six-character code.
2. **Continue**.

### 4.2 Lecture page

<img src="kuvat/en/16-osallistuja.png" alt="Participant page" width="260">

1. **Lecture questions**: questions opened by the lecturer appear here automatically within about a second.
2. **Nickname**: required and unique within the lecture. The nickname is only for messages. Polls are answered without it.
3. **Ask a question or give feedback**.
4. **FI / EN**: switch language.

### 4.3 Question or feedback

<img src="kuvat/en/17-kysy.png" alt="Writing a message" width="260">

1. **Nickname**: e.g. *Strawberry*. Do not use your own name.
2. **Question** or **Feedback**.
3. **Your message**: at most 2,000 characters.
4. **Send encrypted**: the message and nickname are encrypted on the device before sending.

<img src="kuvat/en/18-lahetetty.png" alt="Message sent" width="260">

1. The nickname is now reserved for this browser. At the next lecture it is suggested automatically.
2. Confirmation of the sent message.

### 4.4 Answering a poll

<img src="kuvat/en/23-osallistuja-vastaa.png" alt="Answering a poll" width="260">

1. Choose an option.
2. **Submit**. The answer can be changed until the poll is closed.

When you show the results and reveal the correct answer, participants see them on their own phones:

<img src="kuvat/en/26-osallistuja-tulokset.png" alt="Results for participants" width="260">

If several questions are on screen, they are shown one below the other, and participants can answer all open ones:

<img src="kuvat/en/31-osallistuja-useita.png" alt="Several questions" width="260">

## 5. During the lecture: questions on screen

### 5.1 Presenter screen

The presenter screen is a separate window for the projector or a Teams share. Connect the projector as an extended
display (not mirrored), so the admin view stays on the laptop screen.

![Presenter screen buttons](kuvat/en/19-esitysnayttopalkki.png)

1. **Avaa esitysnäyttö** (open presenter screen): opens the window. Chrome and Edge move it to the second display (the browser asks for permission once).
   In other browsers drag the window to the projector. Double-click or **F** switches to full screen.
2. **Kysymykset projektorille** (questions to projector): participants' questions as a list on screen.
3. **Palautteet projektorille** (feedback to projector): feedback as a list on screen.
4. **QR isona** (large QR): a large QR code over the whole screen (also **Q**).
5. **Tyhjennä näyttö** (clear screen): everything off the screen. Answers are kept.
6. The status shows whether the presenter screen is connected.

When nothing is on screen, it shows the QR code and joining instructions:

![Presenter screen waiting](kuvat/en/20-esitysnaytto-odotus.png)

![Large QR code](kuvat/en/34-iso-qr.png)

### 5.2 In-lecture mode

![In-lecture mode](kuvat/en/21-tila-luennolla.png)

1. **▶ Luennolla** (in lecture): a compact list of all questions. Edit and delete buttons are hidden, so nothing is deleted by accident.
2. **Clicking a row**: puts the question on screen and makes it active.
3. **+ Näytölle** (add to screen): adds the question to the screen next to the others. *✓ Näytöllä* (on screen) removes it.
4. **Ohita** (skip): leaves the set out of the *Next*/*Previous* order.

### 5.3 Control bar

The control bar controls the **active question**, that is, the one most recently put on screen.

![Control bar](kuvat/en/22-ohjauspalkki-luonnos.png)

1. The active question, its status (*Luonnos* draft, *Auki* open or *Suljettu* closed), set and answer count.
2. **← Edellinen** (previous): makes the previous question active.
3. **Seuraava →** (next): makes the next question active. Other questions on screen stay.
4. **Avaa vastauksille** (open for answers): participants see the question and can answer. A draft is shown on the projector but not to participants before it is opened.
5. **Näytä tulokset** (show results): results to the projector and participants' phones. Results are hidden at first.
6. **Paljasta oikea vastaus** (reveal correct answer): highlights the correct options and shows the explanations. Shown only if the question has a correct answer.
7. **Pois näytöltä** (off screen): the question leaves the projector and the participants. Answers are kept.
8. **Odotusnäkymä** (waiting view): all questions off the screen.

When the question is open, the buttons change:

![Control bar, question open](kuvat/en/27-ohjauspalkki-auki.png)

1. Status **Auki** (open).
2. **Sulje vastaukset** (close answers): no new answers are accepted.
3. **Piilota tulokset** (hide results).
4. **Piilota oikea vastaus** (hide correct answer).

### 5.4 On the projector

An open question on the projector. Results are hidden until you show them:

![Question on the projector](kuvat/en/24-esitysnaytto-kysymys.png)

1. The answer count updates within about a second.
2. The QR code and join code are always at the bottom for latecomers.

Results and the revealed correct answer:

![Results on the projector](kuvat/en/25-esitysnaytto-tulokset.png)

1. The correct option is highlighted, and the explanations are shown below the options.

### 5.5 Several questions on screen

You can keep several questions on screen at once, for example an opening poll and a word cloud. Add them from the
list with **+ Näytölle** (add to screen).

![Several questions in the control bar](kuvat/en/29-useita-naytolla.png)

1. The active question: keyboard shortcuts and the phone remote control it.
2. **Muut näytöllä** (others on screen): each has its own buttons (open, close, results, reveal, off screen).
3. **Aktiiviseksi** (make active): makes the question active.

The projector shows the questions as a grid (up to 12), and the text size is fitted to each tile:

![Grid on the projector](kuvat/en/30-esitysnaytto-ruudukko.png)

## 6. Results and moderation

Results are computed in your browser, because the answers are encrypted. Keep the admin view open during the lecture.

![Results in the admin view](kuvat/en/28-tulokset-hallinnassa.png)

In preparation mode, each question's results are under *Tulokset* (results) on its card.

### 6.1 Word cloud

![Word cloud moderation](kuvat/en/32-sanapilvi-moderointi.png)

1. **Click a word**: the word is hidden and disappears from the projector immediately.
2. **Piilotetut** (hidden): ↺ restores a word. The profanity filter (English and Finnish) hides matches automatically
   with the mark ⚠. Approve them with ✓ if they are appropriate.

### 6.2 Open answers

![Open answer moderation](kuvat/en/33-avoin-moderointi.png)

1. **Piilota** (hide): the answer disappears from the projector immediately.
2. **Piilotetut** (hidden): hidden answers and those stopped by the filter. Restore or approve them when needed.

Hidden items are stored on the server encrypted, so they persist when you reload the page.

## 7. Participants' questions and feedback

![Questions and feedback](kuvat/en/35-viestit.png)

1. **Kysymykset ja palaute** (questions and feedback) tab. The badge shows the number of new messages.
2. **Filters**: *Käsiteltävät* (to handle: new and answered), *Uudet* (new), *Vastatut* (answered), *Arkisto* (archive) and *Kaikki* (all).
3. **Näytä projektorilla** (show on projector): the message large on screen next to other content. The message is also marked answered.
4. **Merkitse vastatuksi** (mark answered). *Palauta uudeksi* (restore as new) undoes it.
5. **Arkistoi** (archive): hides the message from the list. Archived messages are not shown in projector lists or reports.
6. **Poista** (delete): the message permanently.

A message and the feedback list on the projector:

![Messages on the projector](kuvat/en/36-esitysnaytto-viestit.png)

## 8. Phone remote

With the phone remote you control the active question while walking in the room. Sign in to the admin view on your
phone. The remote does not decrypt messages, so the encryption key is not needed.

<img src="kuvat/en/39-avaa-kysymykset.png" alt="Unlock view on a phone" width="260">

1. **Avaa passkeylla** (unlock with passkey): opens the messages (not needed for the remote).
2. **Puhelinohjain** (phone remote): choose the lecture and press *Ohjaa* (control).
3. **Avaa tunnuslauseella** (unlock with passphrase): a fallback if the passkey cannot unlock the key.

<img src="kuvat/en/40-puhelinohjain.png" alt="Phone remote" width="260">

1. The active question, its status and answer count. The large buttons match the control bar buttons.

The laptop driving the projector picks up the remote's changes within a couple of seconds. The remote is also available from the **Ohjain** (remote) button on the lecture page.

## 9. Settings and signing in

![Settings](kuvat/en/38-asetukset.png)

1. **Uuden passkeyn nimi** (new passkey name): e.g. *iPhone*.
2. **Lisää passkey** (add passkey): add a backup passkey on another device so you do not lock yourself out.
3. **Lataa avaimen varmuuskopio** (download key backup).
4. **Vaihda tunnuslause** (change passphrase): type the new passphrase twice. A new backup is downloaded.
5. **Tietoturvaloki** (security log): sign-ins and admin changes.

Signing in:

<img src="kuvat/en/41-kirjaudu.png" alt="Signing in" width="260">

1. **Kirjaudu passkeylla** (sign in with passkey). If the passkey supports unlocking (PRF), the messages open at the same time.
   Otherwise type the passphrase once, after which the passkey is enough.

A session ends after 3 hours of inactivity and after 8 hours at the latest. The presenter screen is cleared when you
sign out or close the admin view.

## 10. Keyboard shortcuts

Shortcuts work in the admin view and the presenter window (not in form fields). They control the active question.

| Key | Action |
|---|---|
| → / PageDown | Next question (also a wireless presenter remote) |
| ← / PageUp | Previous question |
| Space | Open or close answers |
| R | Show or hide results |
| A | Reveal the correct answer |
| Q | Large QR code |
| T | Light or dark theme (presenter window) |
| F or double-click | Full screen (presenter window) |

---

The pictures were produced with test data using `scripts/e2e.sh "docs-screenshots.mjs fi" "docs-screenshots.mjs en"`.
Run it again when the user interface changes.
