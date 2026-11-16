# Question import file (JSON)

[Suomi](tuontimuoto.md) · **English**

This describes the file format of HessuTalks question sets. *Tuo JSON* (import JSON) in the admin view reads the file,
and *Vie JSON* (export JSON) produces the same format. The description is written so that it can be given to an AI
as is (see [Creating the file with AI](#creating-the-file-with-ai)).

## Structure

The file is one JSON object with the lecture (`event`) and a list of question sets (`sets`). Sets are imported
in file order, as are the questions within a set.

```json
{
  "event": { "title": "Cybersecurity Basics" },
  "sets": [
    {
      "id": "M1",
      "title": "M1 Threats and risks",
      "questions": [
        { "type": "wordcloud", "text": "Cybersecurity in one word?", "maxWords": 1 },
        { "type": "single", "text": "Which of these is the most typical sign of a phishing message?",
          "options": ["Urgency and threats", "A signature", "The company logo"],
          "correct": [0],
          "explanations": ["Correct: urgency makes people act without thinking.", "A signature can be forged.", "A logo can be copied."] },
        { "type": "multi", "text": "Which of these are personal data?",
          "options": ["Name", "IP address", "Temperature"], "correct": [0, 1] },
        { "type": "scale", "text": "I can easily recognise a phishing message.", "min": 1, "max": 5,
          "minLabel": "Strongly disagree", "maxLabel": "Strongly agree" },
        { "type": "scale", "text": "How likely would you recommend this course?", "min": 0, "max": 10 },
        { "type": "open", "text": "Reflect: how is your organisation prepared for ransomware?",
          "maxLength": 3500, "multipleAnswers": false }
      ]
    }
  ]
}
```

| Field | Required | Content |
|---|---|---|
| `event.title` | no | Name of the lecture or course |
| `sets` | yes | List of sets, at least one |
| `sets[].id` | yes | Set identifier: 1–16 characters `A–Z`, `0–9`, `-` or `_`, starting with a letter or digit. Lowercase is converted to uppercase. Unique in the file and in the lecture |
| `sets[].title` | yes | Set name, at most 120 characters |
| `sets[].questions` | no | List of questions (default empty) |

Unknown fields are ignored. The `format` and `version` fields included in exports do not affect import.

## Question types

Every question has `type` and `text` (question text, 1–300 characters).

| `type` | Additional fields |
|---|---|
| `single` | Multiple choice, one answer. `options`: 2–10 options, each at most 120 characters. `correct`: at most one index of the correct option (0-based). `explanations`: an explanation for every option, each at most 300 characters |
| `multi` | Multiple choice, several answers. Like `single`, but `correct` may contain several indexes |
| `scale` | `min` and `max`: 1–5 or 1–7 (Likert) or 0–10 (scale). Default 1–5. `minLabel` and `maxLabel`: end-point labels, at most 40 characters |
| `wordcloud` | Word cloud. `maxWords` 1–3 (the app always allows up to 3 words) |
| `open` | Open text. `maxLength`: 280–3500 characters (default 280, for reflection tasks 3500, about 500 words). `multipleAnswers`: `true` = a participant can send several answers |
| `qa` | Not in use. Imported as the type in `fallbackType` (e.g. `"fallbackType": "open"`), otherwise skipped with a warning |

`correct` and `explanations` are optional. They are not sent to participants until the lecturer reveals the correct
answer. If `explanations` is given, there must be exactly as many explanations as options (an empty string is a valid
explanation).

## Limits and errors

- The file is at most 60 kB.
- A lecture can have at most 50 sets and 100 questions.
- Import is all or nothing: a single error prevents the whole import. Before saving, the admin view shows a summary
  of the sets to import, questions to skip and errors.
- A set identifier already used in the lecture is an error. Change the identifier if you import the same set again.

## Creating the file with AI

Questions do not have to be written by hand. When you give an AI (e.g. Claude or ChatGPT) your learning material and
this description, it can produce an importable file directly. No other description or examples are needed.

1. Attach the learning material (lecture slides, notes, learning objectives) and this file to the conversation.
2. Describe the kind of questions you want. Example request:

   > Using the attached lecture material, create a HessuTalks import file according to the attached description.
   > One set per part of the lecture. In each set one opening question (word cloud or scale), two multiple-choice
   > questions with correct answers and explanations, and one reflection question. Language English.
   > Return only the JSON.

3. Save the answer as a `.json` file and import it in the admin view (*Tuo JSON*). The summary lists any errors,
   which you can give back to the AI to fix.
4. Check the questions and correct answers with *Esikatsele* (preview) before the lecture. The AI can make mistakes.

Attach only material you are allowed to give to the AI service you use. Do not attach students' personal data.
