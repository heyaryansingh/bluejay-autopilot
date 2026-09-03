"use client";

import { useState } from "react";
import ScheduleCard from "@/components/ScheduleCard";
import { YEARS, type Profile } from "@/lib/profile";
import type { Constraints, Schedule } from "@/lib/types";

type Result = {
  constraints: Constraints;
  semester: { name: string; year: string };
  lastUpdated: string;
  poolSize: number;
  schedules: Schedule[];
};

const EXAMPLES = [
  "15 credits, no 8ams, kills my Nat Sci req, professors people actually like",
  "Light 12-credit semester, nothing on Friday, something about the brain",
  "Hardest 18 credits you can build me. I want to suffer.",
  "I need a writing intensive and a quant course, afternoons only",
];

function constraintChips(c: Constraints): string[] {
  const out: string[] = [];
  const time = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    const ap = h < 12 ? "am" : "pm";
    return `${h % 12 === 0 ? 12 : h % 12}:${mm}${ap}`;
  };
  const DAY = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri" } as const;

  if (c.targetCredits) out.push(`${c.targetCredits} credits`);
  if (c.earliestStart) out.push(`nothing before ${time(c.earliestStart)}`);
  if (c.latestEnd) out.push(`done by ${time(c.latestEnd)}`);
  for (const d of c.freeDays ?? []) out.push(`${DAY[d]} free`);
  for (const a of c.requiredAreas ?? []) out.push(`area ${a}`);
  for (const r of c.requiredCourses ?? []) out.push(`must take ${r}`);
  if (c.minRating) out.push(`eval ≥ ${c.minRating}`);
  if (c.avoidFull) out.push("open seats only");
  if (c.writingIntensive) out.push("writing intensive");
  for (const k of c.keywords ?? []) out.push(k);
  for (const d of c.departments ?? []) out.push(d);
  return out;
}

type Live = { at: string; seats: Record<number, { size: number; enrolment: number }> };

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<Profile>({});

  /** Re-read enrolment for the courses on screen; the snapshot goes stale fast. */
  async function checkSeats(r: Result) {
    setChecking(true);
    try {
      const ids = [...new Set(r.schedules.flatMap((s) => s.picks.map((p) => p.course.id)))];
      const res = await fetch("/api/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      const seats: Live["seats"] = {};
      for (const c of json.courses ?? [])
        for (const sec of c.sections ?? [])
          seats[sec.id] = { size: sec.size, enrolment: sec.enrolment };
      setLive({ at: new Date(json.checkedAt).toLocaleTimeString(), seats });
    } catch {
      /* stale numbers are better than a broken page */
    } finally {
      setChecking(false);
    }
  }

  async function run(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLive(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, profile }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`);
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:py-16">
      <header className="mb-10">
        <div className="label mb-3 flex items-center gap-3">
          <span>Johns Hopkins University</span>
          <span className="h-px flex-1 bg-rule" />
          <span>Homewood</span>
        </div>
        <h1 className="display text-5xl leading-[0.95] sm:text-7xl">
          Blue&nbsp;Jay
          <br />
          <span className="text-blue">Autopilot</span>
        </h1>
        <p className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-ink-soft">
          Describe the semester you want in one sentence. Get real,
          conflict-free schedules built from the live course catalog and
          actual JHU course evaluations.
        </p>
      </header>

      <section className="rule-double pt-6">
        <label htmlFor="prompt" className="label">
          Describe your semester
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <textarea
            id="prompt"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(prompt);
              }
            }}
            placeholder="15 credits, no 8ams, kills my Nat Sci req, professors people actually like"
            className="card flex-1 resize-none px-4 py-3 text-[1.02rem] outline-none placeholder:text-ink-faint focus:border-blue"
          />
          <button
            onClick={() => run(prompt)}
            disabled={busy || !prompt.trim()}
            className="mono h-fit self-stretch bg-blue px-6 py-3 text-xs tracking-[0.18em] text-paper uppercase transition hover:bg-[var(--blue-soft)] disabled:cursor-not-allowed disabled:opacity-35 sm:self-auto"
          >
            {busy ? "Solving" : "Build it"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-rule pt-4">
          <div>
            <label htmlFor="year" className="label block">
              Class year
            </label>
            <select
              id="year"
              value={profile.year ?? ""}
              onChange={(e) =>
                setProfile((p) => ({ ...p, year: e.target.value || undefined }))
              }
              className="mono mt-1 border-b border-rule bg-transparent py-1 text-[0.82rem] outline-none focus:border-blue"
            >
              <option value="">any</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-40 flex-1">
            <label htmlFor="major" className="label block">
              Major
            </label>
            <input
              id="major"
              value={profile.major ?? ""}
              onChange={(e) =>
                setProfile((p) => ({ ...p, major: e.target.value || undefined }))
              }
              placeholder="Neuroscience"
              className="mono mt-1 w-full border-b border-rule bg-transparent py-1 text-[0.82rem] outline-none placeholder:text-ink-faint focus:border-blue"
            />
          </div>

          <div>
            <label htmlFor="credits" className="label block">
              Credits {profile.credits ?? "—"}
            </label>
            <input
              id="credits"
              type="range"
              min={9}
              max={20}
              step={1}
              value={profile.credits ?? 15}
              onChange={(e) =>
                setProfile((p) => ({ ...p, credits: Number(e.target.value) }))
              }
              className="mt-2 w-36 accent-[var(--blue)]"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setPrompt(ex);
                run(ex);
              }}
              disabled={busy}
              className="rounded-full border border-rule px-3 py-1 text-[0.78rem] text-ink-soft transition hover:border-blue hover:text-blue disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {busy && (
        <p className="display working mt-10 text-2xl">
          Reading the catalog, checking evaluations, ruling out conflicts…
        </p>
      )}

      {error && (
        <p className="mt-10 border-l-2 border-crimson pl-3 text-ink-soft">
          {error}
        </p>
      )}

      {result && (
        <>
          <section className="mt-10">
            <div className="label mb-2">What I understood</div>
            <div className="flex flex-wrap gap-2">
              {constraintChips(result.constraints).map((c) => (
                <span
                  key={c}
                  className="mono border border-blue/30 bg-blue/5 px-2 py-1 text-[0.72rem] text-blue"
                >
                  {c}
                </span>
              ))}
              {constraintChips(result.constraints).length === 0 && (
                <span className="text-[0.85rem] text-ink-faint">
                  No hard constraints — optimising purely on course quality.
                </span>
              )}
            </div>
            {result.constraints.notes && (
              <p className="mt-2 text-[0.85rem] text-ink-faint italic">
                {result.constraints.notes}
              </p>
            )}
          </section>

          {result.schedules.length > 0 && (
            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={() => checkSeats(result)}
                disabled={checking}
                className="mono border border-blue px-3 py-1.5 text-[0.7rem] tracking-[0.14em] text-blue uppercase transition hover:bg-blue hover:text-paper disabled:opacity-40"
              >
                {checking ? "Checking…" : "Check live seats"}
              </button>
              {live && (
                <span className="mono text-[0.7rem] text-ink-faint">
                  seat counts as of {live.at}
                </span>
              )}
            </div>
          )}

          {result.schedules.length === 0 ? (
            <p className="mt-10 border-l-2 border-crimson pl-3 text-ink-soft">
              Nothing in {result.semester.name} {result.semester.year} satisfies
              all of that at once. Loosen one constraint — usually the time
              window or the credit target — and try again.
            </p>
          ) : (
            <section className="mt-8 space-y-8">
              {result.schedules.map((s, i) => (
                <ScheduleCard key={i} schedule={s} index={i} live={live?.seats} />
              ))}
            </section>
          )}

          <footer className="mono mt-12 border-t border-rule pt-4 text-[0.68rem] leading-relaxed text-ink-faint">
            {result.semester.name} {result.semester.year} · {result.poolSize}{" "}
            schedulable Homewood courses · catalog last updated{" "}
            {result.lastUpdated} · course data from the public jhu.semester.ly
            API · evaluation scores are historical and may predate the listed
            instructor
          </footer>
        </>
      )}
    </main>
  );
}
