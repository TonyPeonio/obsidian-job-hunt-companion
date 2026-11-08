# Job Hunt Companion

An [Obsidian](https://obsidian.md) plugin for students and early-career job seekers: paste a job
posting and get a **structured note** (deadline, salary, location, requirements, keywords, the
posting kept verbatim), move it through a **status workflow** with a dated timeline, see
everything on a **board** with what is due soon and what has gone quiet, and let a **local model**
(via [Ollama](https://ollama.com)) point out which of your resume bullets answer which
requirement and draft likely interview questions. Everything runs on your machine; nothing is sent
to a job board, a vendor or anyone else.

- **A note per application, in your vault.** `Jobs/<Company> - <Role>.md` with properties you can
  query with Dataview or Bases, the posting text as pasted, the requirements as a checklist to
  tick off, your notes, and a timeline of every status change.
- **Deterministic first, model second.** Dates (six common formats), salary ranges, location,
  remote/hybrid/on-site and contact emails are read with regular expressions and win over anything
  the model says. The model only fills what the regexes cannot: company, role, requirements,
  nice-to-haves and keywords. Its dates are re-read by the deterministic parser, never trusted as
  written. Without Ollama the regex pass and the board still work.
- **Grounded tailoring.** The model may only quote bullets that exist in your resume note; a
  deterministic check drops anything it cannot find and the note says how many were dropped.
  Rewordings are marked as suggestions. The resume is never edited.
- **Interview prep without invented answers.** Eight likely questions drawn from the posting's
  requirements and keywords, each with what the interviewer is checking, and an empty slot for
  your own answer.
- Free and open source, MIT licensed. No accounts, no API keys, no telemetry.

## Requirements

1. Obsidian 1.7.2 or later (desktop or mobile).
2. Optional: [Ollama](https://ollama.com) running locally (or on another machine on your network;
   set its URL in settings) with a chat model: `ollama pull qwen3.5:9b` (default; fits a 12 GB GPU),
   `qwen3.5:4b` for smaller cards. Without Ollama, *Add a posting* runs only the deterministic
   pass (dates, salary, location, emails, first line as the title) and the board, status workflow
   and calendar export work as usual; *Tailor* and *Interview prep* need the model.

## Usage

1. **Add a posting** (ribbon icon or command). Paste the posting text and, optionally, its URL.
   The note opens as `Jobs/<Company> - <Role>.md` with status `wishlist`. Check the frontmatter:
   the deadline and salary are what the regexes found, so a posting that says "end of month" will
   have an empty deadline for you to fill.
2. Tick the requirements you meet under `## Fit`; keep your own notes under `## Notes`.
3. When you apply, run **Change status** with the note open and pick *applied*: `applied_on` is
   set to today and the timeline gets a dated line. Keep going through phone screen, interview,
   offer, rejected or withdrawn.
4. **Open the board** writes `Jobs/Board.md`: what is due in the next 14 days, what has had no
   update in 21 days, then a table per status. Re-running it rewrites only that note.
5. With a posting note open, **Tailor resume to this posting** compares your resume note (set its
   path in settings; default `Resume.md`) with the posting and writes matches, keyword gaps and
   suggested rewordings under `## Tailoring`. **Draft interview prep** writes eight questions
   under `## Interview prep`.

### Commands

| Command | What it does |
|---|---|
| Add a posting | Paste a posting; regex pass + one local-model call; writes the posting note |
| Change status | Pick the next status (or any other); updates `status`, `applied_on` and the timeline |
| Open the board | Rewrites `Jobs/Board.md` (due soon, stale, a table per status); optional `.ics` export |
| Tailor resume to this posting | Matches resume bullets to requirements, names gaps, suggests rewordings under `## Tailoring` |
| Draft interview prep | Eight likely questions with what each checks, under `## Interview prep` |

### Note shape

````markdown
---
company: Acme Analytics
role: "Software Engineer, Data Platform"
status: wishlist
applied_on: ""
deadline: 2026-11-30
location: "Denver, CO"
remote: hybrid
salary: $85k–$100k per year
url: "https://…"
source: posting
keywords:
  - python
  - airflow
---

# Acme Analytics — Software Engineer, Data Platform

## Posting
```text
(the pasted text, verbatim, in a fence so its headings, #tags and links stay inert)
```

## Requirements
- 2+ years writing production Python
…

## Nice to have
## Fit
- [ ] 2+ years writing production Python
## Notes
## Timeline
- 2026-11-07 — added
- 2026-11-12 — applied
````

`## Tailoring` and `## Interview prep` are added (or replaced) by their commands. Everything else
in the note is yours; the plugin edits only the frontmatter key it changes and the section it
owns.

### How it works

**Deterministic pass.** Dates are read in `2026-11-30`, `11/30/2026` (day first when the first
number cannot be a month), `Nov 30`, `November 30, 2026`, `30 November 2026` and `30th Nov`
forms; month-day without a year takes the next occurrence on or after today. Only lines with
deadline wording ("deadline", "apply by", "applications close", "closing date", …) are
considered, lines about start or posting dates are skipped, and vague wording ("end of month",
"rolling") yields no deadline. Salaries need a currency symbol or code and an amount of at least
1,000 (`$85k–$100k`, `£40,000`, `85,000 - 100,000 USD`). Location comes from a `Location:` label
or a `City, ST` pair; remote/hybrid/on-site from the wording.

**Model pass.** One chat call (temperature 0.1, thinking off, JSON mode) with a fixed schema:
company, role, location, remote, deadline (copied as written), salary, requirements (≤ 8),
nice_to_have (≤ 5), keywords (≤ 12). The reply is parsed as JSON, every field is type-checked,
lists are capped and de-duplicated, the deadline text is run through the same date parser, and the
regex results win wherever both have a value. The first line of the posting is used as the role
only when the model gives none.

**Board.** Reads every posting note under the jobs folder (frontmatter with `company`, `role`,
`status`). "Last update" is the latest dated Timeline line. Due = active status, deadline within
14 days; stale = active status, no update for more than 21 days. Rejected and withdrawn postings
are listed in their tables but never flagged. The `.ics` export (optional) writes an all-day event
per upcoming deadline with a UID derived from the note path, so re-exports update rather than
duplicate.

**Tailoring.** The resume's bullet lines (`- `, `* `, `1. `) and the posting's requirements and
keywords go to the model (temperature 0.3, thinking off, JSON mode). Every quoted bullet is
normalised (case, punctuation, markdown emphasis) and must appear in the normalised resume text;
otherwise it is dropped and counted. At most 5 gaps and 3 rewordings are kept.

## Settings worth knowing

- **Jobs folder** (default `Jobs`) and **Resume note** (default `Resume.md`).
- **Export deadlines as a calendar file** and its path (default `Jobs/deadlines.ics`).
- **Ollama URL**, **Chat model**, **Context window**.

## Privacy and network use

The plugin makes network requests only to the Ollama URL you set (localhost by default), and only
when you run *Add a posting* (with Ollama reachable), *Tailor* or *Interview prep*. It does not
talk to job boards, does not fetch the posting URL you paste, and sends nothing anywhere else. It
reads the notes in the jobs folder and your resume note, and writes under the jobs folder. No
telemetry, no accounts.

## Development

```bash
npm install
npm run dev           # watch build → main.js
npm test              # unit tests (vitest), no Ollama needed
npm run build         # type-check + Obsidian review lint + production bundle
npm run posting:live  # extraction prompt against a running Ollama on two sample postings (2 calls)
```

To release: bump `version` in `manifest.json` and `package.json`, add the version to
`versions.json`, write `release-notes/<version>.md`, commit, then push a tag named exactly
`<version>`. The release workflow builds, tests, attests and publishes the GitHub release.

`src/core/` (extraction, posting schema and merge, note rendering and parsing, sections, status,
board, ICS, tailoring, interview prep, Ollama client) has no Obsidian dependency and is tested
against an in-memory vault; `src/main.ts`, the modals and the settings tab are the thin Obsidian
layer.

Job Hunt Companion is part of the Companion suite of local-first Obsidian plugins by Tony Peonio for
students and researchers: your machine does the work, every change is a diff you approve, and the
numbers are published. The others are Local Vault Agent (local Ollama agent that searches, compiles,
edits notes), Lecture Companion (live local lecture transcription, Canvas slides, Ollama summaries),
Canvas Companion (Canvas LMS assignments, grades and announcements as notes), Exam Companion
(day-by-day study plan, daily quizzes and flashcards), Paper Companion (Zotero search by meaning,
page-cited reading notes), Research Log Companion (append-only lab notebook with git, parameters,
data hashes), Meeting Companion (local meeting transcription, decisions, action items, weekly
digest), Fellowship Companion (grants and fellowships: deadlines, materials, letters, eligibility),
Code Companion (commits in the daily note, weekly report, TODOs), Teaching Companion (local-model
rubric grading with verbatim evidence) and Branching Table of Contents (parent/child properties as a
rooted family tree). All at [github.com/TonyPeonio](https://github.com/TonyPeonio).

## License

MIT
