# HangulHub — Korean Exam Studio

A locally hosted study app for Korean (or any language exam) that replaces a
buggy flashcard app plus a general-purpose notebook tool. Organise material as
**courses → chapters → files**, then use each function on the files you choose.

## Run it

```sh
./start.sh
```

Then open **http://127.0.0.1:8765** in your browser. Everything (your API key,
files, decks, tests, chat history) stays in the `data/` folder on this machine.
No account, no cloud.

First run needs Python 3.11+ and internet access to install the file-reading
libraries. If you'd rather run it manually:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

## Setup (one minute)

1. Click the gear icon (top right) in the app.
2. Paste your DeepSeek API key.
3. Defaults: base URL `https://api.deepseek.com/v1`, model `deepseek-v4-flash`.
   Change either if your provider differs, then **Test connection**.

The key is stored only in `data/settings.json` on this computer.

## Workflow

### Courses and chapters
- **Add course** in the left sidebar, e.g. "TOPIK II prep". Set a target level —
  the AI uses it to pitch questions.
- Add **chapters** like "Vocabulary week 1" or "Past papers 2024".
- Add files to a chapter (drag & drop, choose file, or paste text).

Supported files: Excel (`.xlsx`), CSV/TSV, plain text/Markdown, Word (`.docx`)
and digital PDFs. Excel/CSV files become vocabulary tables; PDF/Word/text become
reading material. Scanned (image-only) PDFs need OCR and are not supported.

### Flashcards
- **Write your own cards**: type front/back pairs straight into the page, then
  **Save deck**. `Enter` in a back box moves to the next card (and adds a row at
  the end of the list); rows with an empty front are skipped. Decks made this way
  are labelled "written by you" in the library.
- Pick one or more vocab files (Excel/CSV, text, or PDF) → choose which column
  is the front (word) and
  which are shown on the back (meaning, example) → build.
- **✎ Edit cards** on any deck — in the library or while studying — rewrites the
  front/back text, adds new cards or removes ones you no longer need. Cards you
  keep hold on to their learning progress.
- PDF vocab lists work too: Hangul-then-English lines like "학교 school" and
  tab/column layouts are detected automatically.
- Cards appear in random order, never the file order.
- Tap a card to flip it, then mark **Correct / Uncertain / Wrong**.
- **Correct** cards leave the round; **Uncertain/Wrong** cards re-enter the pool
  and appear again later.
- The familiarity % = cards marked correct ÷ total. Progress survives closing
  the app. **Relearn** (top right) returns every card to the pool and resets the
  counters to 0%.

### AI Multiple Choice
- Optionally pick source files, enter 1–999 questions, and describe the quiz in
  the text box (e.g. "past-tense endings, TOPIK II level").
- With no files selected it makes a grammar-only quiz from general knowledge.
- Answer everything, submit, and review explanations question by question.

### Paper → Online Test
- Upload past papers (PDF/Word/text), then convert one or more.
- The AI keeps the paper's real section titles, question counts and marks.
  Listening questions without transcripts are adapted to text-based questions
  (the section title is kept, with a note).
- Answer the whole paper online, submit, and receive per-section scores,
  per-question feedback and an estimated band.

### AI Mock Paper
- Generate from this chapter's files or from **every past paper in the course**.
- The AI writes a brand-new paper that mirrors the structure and difficulty of
  your uploaded papers, then you sit it and get graded the same way.

### Ask AI
- Notebook-style chat with the files in a chapter — explain grammar, translate,
  or make revision lists from your own materials.

## Where data lives

`data/` contains JSON files:

| Folder/file | Contents |
| --- | --- |
| `courses.json` | Course index |
| `course_*.json` | Each course, its chapters and file metadata |
| `files/*.json` | Extracted content from each uploaded file |
| `uploads/` | Original uploaded bytes |
| `decks/*.json` | Flashcard decks + study progress |
| `tests/*.json` | Generated tests + attempts/results |
| `chats/*.json` | Chat history per chapter |
| `settings.json` | API key, model, base URL |

Copy or back up the whole `data/` folder to move your study history to another
machine.

## Notes and limitations

- The app binds to `127.0.0.1` only — it is not exposed to the network.
- Audio-based listening sections can't be played from static text; transcripts
  in your PDFs are used when available.
- Very large or scanned PDFs may need to be split/OCRed first.
- Sample files for a quick trial are in `samples/`.
