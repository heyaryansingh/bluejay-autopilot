# Blue Jay Autopilot

**Describe your semester in one sentence. Get three real, conflict-free JHU schedules.**

> *"15 credits, no 8ams, kills my Nat Sci req, professors people actually like"*

Built on **Grok** for the Grok hackathon at Johns Hopkins.

---

## The idea

Course registration at Hopkins means opening SIS, guessing at course numbers,
cross-referencing evaluations you can't easily search, and manually checking
that nothing collides on Tuesday. This collapses that into one sentence.

## The architecture decision that matters

Grok is deliberately **not allowed to build the schedule.**

```
your sentence
   └─> Grok ───────────> Constraints   (credits, times, free days, areas, rating floor)
                              │
   catalog + evaluations ─────┤
                              ▼
                          solver  ──> conflict-free schedules   [plain TypeScript]
                              │
                              ▼
                            Grok ──> the honest verdict on each
```

Ask any LLM to "build me a 15-credit schedule" and it will hand you two
classes that meet at 1:30pm on Tuesday. It reads beautifully and it is wrong.

So the model does the two things it is genuinely better at than code —
understanding a messy human sentence, and writing a judgement about a
tradeoff — and the combinatorial search stays in `lib/solver.ts`, where a
randomised-restart search produces schedules that are conflict-free *by
construction*. The API route independently re-verifies with `hasConflict()`
and returns a 500 rather than ever shipping an overlap.

That split is the whole design. It's why the output is trustworthy.

## What it actually knows

| Signal | Source |
|---|---|
| Meeting times, rooms, days | live JHU catalog |
| Seats taken vs. cap, waitlist | live, re-checkable on demand |
| **Real course evaluation scores** | JHU evaluations, per course and instructor |
| **Student reaction counts** | FIRE / LOVE / INTERESTING / HARD / BORING / CRAP |
| Distribution areas (H N S Q E) and named foci | catalog |
| Prerequisites | pre-extracted prereq graph |
| Credits, level, department | catalog |

All of it from the **public, unauthenticated** `jhu.semester.ly` API. No SIS
key required — SIS itself is key-gated and rejects anonymous requests.

## Quick start

```bash
npm install
cp .env.example .env.local     # add your XAI_API_KEY
npm run dev
```

Open http://localhost:3000. The repo ships with a catalog snapshot, so it
runs immediately — no crawl needed.

```bash
npm run crawl    # optional: refresh the snapshot (~10 min, 497 departments)
npm run check    # self-checks, including conflict-freedom on real data
```

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `XAI_API_KEY` | — | Grok. The default provider. |
| `XAI_MODEL` | `grok-4.6` | |
| `ANTHROPIC_API_KEY` | — | Optional fallback provider. |
| `LLM_PROVIDER` | auto | Force `xai` or `anthropic`. |

**With no key at all it still works.** `lib/heuristic.ts` is a rule-based
constraint parser that takes over automatically, so a rate limit mid-demo
degrades the output instead of ending it. The solver is unaffected either way.

## Two upstream traps

Both produce confidently wrong output rather than an error, so they're worth
naming:

1. **`areas` arrives char-exploded and space-stripped.** `"EQ, Science and
   Data"` comes back as `["E","Q",",","S","c","i",...]`. Rejoined, it's a
   comma-separated mix of distribution codes (1–3 uppercase letters) *and*
   named foci. Split on the first comma and `"EthicsandFoundations"` becomes
   the letters E,T,H,I,C,S — which reports Psychology as an Engineering
   course.
2. **The department vocabulary has two naming shapes.** 57 `"AS "`/`"EN "`
   prefixed entries are a near-empty legacy shape; the 440 unprefixed ones
   hold the real courses. Filtering on the prefixed names returns junk and
   silently misses most of the catalog.

## Verification

`npm run check` runs unit tests on the time and area parsing, then asserts
against the **real crawled catalog** that solved schedules have zero
conflicts, honour free days and time windows, hit the credit target, cover
required distribution areas, and return *nothing at all* rather than
something invalid when constraints are impossible.

## Honest limits

- Evaluation scores are historical and may predate the currently listed
  instructor. The UI states this in the footer.
- Prerequisites are **surfaced, not enforced** — the API exposes a
  regex-extracted prereq list, not your transcript.
- Homewood undergrad only (`AS.` / `EN.` course codes).
- Courses with no fixed meeting time (most online and Engineering for
  Professionals sections) can't be placed on a weekly grid and are excluded.
- Class year maps to plausible course levels as a heuristic, not a
  degree-audit rule.

## License

The `jhu.semester.ly` project is GPL-3.0. This is an independent client of
its public HTTP API and contains none of its source.
