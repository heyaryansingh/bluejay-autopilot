# Blue Jay Autopilot

One sentence in. Three real, conflict-free JHU schedules out.

> *"15 credits, no 8ams, kills my Nat Sci req, professors people actually like"*

Built for the Grok hackathon at Johns Hopkins.

## How it works

The interesting decision is what the model is **not** allowed to do.

```
your sentence
   └─> model  ─────────> Constraints  (credits, times, free days, areas, rating floor)
                              │
   catalog + evaluations ─────┤
                              ▼
                          solver  ──> conflict-free schedules   [plain TypeScript]
                              │
                              ▼
                           model  ──> the honest verdict on each
```

A language model asked to "build me a schedule" will cheerfully hand you two
classes that meet at the same time on Tuesday. So it never places a course.
It reads your sentence into constraints, and later it writes the verdict — the
actual scheduling is a randomised-restart search in `lib/solver.ts` where
every returned schedule is conflict-free *by construction*. The API route
re-verifies with `hasConflict()` before responding and fails loudly rather
than shipping an overlap.

## Data

Everything comes from the **public, unauthenticated** `jhu.semester.ly` API —
no SIS key required (SIS itself is key-gated and rejects anonymous requests).

| Source | What it gives |
|---|---|
| `POST /search/{term}/{year}/` | full course records, filterable by department/area/level |
| `GET /courses/{term}/{year}/id/{id}` | one course, used for live seat checks |
| `GET /school/jhu` | department, area, and level vocabularies |

Per course that yields: meeting times and rooms, section enrolment vs. cap,
instructors, credits, distribution areas, **real JHU course-evaluation
scores**, student reaction counts (FIRE / HARD / BORING / CRAP), and a
pre-extracted prerequisite graph.

Two upstream quirks the parser has to handle, both of which silently produce
wrong output if you miss them:

1. `areas` arrives **char-exploded and space-stripped** — `"EQ, Science and
   Data"` comes back as `["E","Q",",","S","c","i",...]`. It is a comma-joined
   mix of distribution codes (1–3 uppercase letters) and *named foci*. Split on
   the first comma and "EthicsandFoundations" becomes the letters E,T,H,I,C,S,
   which reports Psychology as an Engineering course.
2. The department vocabulary carries **two naming shapes** — 57 `"AS "`/`"EN "`
   prefixed entries that are a near-empty legacy shape, and 440 unprefixed ones
   holding the real courses. Filtering on the prefixed names returns junk.

## Running it

```bash
npm install
npm run crawl      # writes data/catalog.json (~10 min, all 497 departments)
npm run dev
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then open http://localhost:3000.

### Switching to Grok

```
LLM_PROVIDER=xai
XAI_API_KEY=xai-...
XAI_MODEL=grok-4
```

Nothing else changes — `lib/llm.ts` swaps the transport and keeps the same
schemas.

### No key at all

It still works. `lib/heuristic.ts` is a rule-based constraint parser used
automatically when no provider is configured, and as a fallback if the API
rate-limits mid-demo. Constraint quality drops; the solver does not.

## Checks

```bash
npm run check
```

Unit tests for the time/area parsing, then integration tests against the real
crawled catalog asserting that solved schedules have zero conflicts, honour
free days and time windows, hit the credit target, cover required distribution
areas, and return nothing at all rather than something invalid when the
constraints are impossible.

## Caveats

- Evaluation scores are historical and may predate the currently listed
  instructor. The UI says so in the footer.
- Prerequisites are surfaced but **not enforced** — the API exposes a
  regex-extracted prereq list, not your transcript.
- Homewood undergrad only (`AS.` / `EN.` course codes).
- Courses with no fixed meeting time (most online and Engineering for
  Professionals sections) can't be placed on a weekly grid and are excluded.
