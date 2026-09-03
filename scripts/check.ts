/**
 * Self-check: run with `npm run check`.
 * Pure logic runs on fixtures; the integration half runs against the real
 * crawled catalog when data/catalog.json is present.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAreas, normalizeCatalog, toMinutes } from "../lib/catalog";
import { allMeetings, conflicts, hasConflict, solve } from "../lib/solver";
import type { Catalog, Course, Meeting } from "../lib/types";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const m = (day: string, start: number, end: number): Meeting =>
  ({ day, start, end, location: "x" }) as Meeting;

console.log("\nunit");

ok("toMinutes parses and rejects", () => {
  assert.equal(toMinutes("13:30"), 810);
  assert.equal(toMinutes("09:00"), 540);
  assert.equal(toMinutes(""), null);
  assert.equal(toMinutes("25:00"), null);
  assert.equal(toMinutes("TBA"), null);
});

ok("normalizeAreas splits distribution codes from named foci", () => {
  const explode = (s: string) => s.split("").filter((c) => c !== " ");

  // Multi-letter code counts toward every letter in it.
  const a = normalizeAreas(explode("EQ, Science and Data"));
  assert.deepEqual(a.areas.sort(), ["E", "Q"]);
  assert.deepEqual(a.foci, ["Science and Data"]);

  // The regression: a named focus must never be read as letters. Psychology
  // is S, not E/T/H/I/C/S.
  const b = normalizeAreas(explode("Ethics and Foundations, S, Science and Data"));
  assert.deepEqual(b.areas, ["S"]);
  assert.deepEqual(b.foci, ["Ethics and Foundations", "Science and Data"]);

  // Writing-intensive has no letter upstream; we synthesise W from the focus.
  const c = normalizeAreas(explode("H, Writing and Communication"));
  assert.deepEqual(c.areas.sort(), ["H", "W"]);

  assert.deepEqual(normalizeAreas([]).areas, []);
});

ok("conflicts detects overlap only on shared days", () => {
  assert.equal(conflicts(m("M", 600, 700), m("M", 650, 750)), true);
  assert.equal(conflicts(m("M", 600, 700), m("T", 650, 750)), false);
  // Back-to-back must not count as a conflict.
  assert.equal(conflicts(m("M", 600, 700), m("M", 700, 800)), false);
  // Full containment must count.
  assert.equal(conflicts(m("M", 600, 800), m("M", 650, 700)), true);
});

if (!existsSync(join(process.cwd(), "data", "catalog.json"))) {
  console.log("\nskipping integration: data/catalog.json not present");
  console.log(`\n${passed} passed\n`);
  process.exit(0);
}

console.log("\nintegration (real Fall 2026 catalog)");

const raw = JSON.parse(
  readFileSync(join(process.cwd(), "data", "catalog.json"), "utf8"),
) as Catalog;
const courses: Course[] = normalizeCatalog(raw);

ok(`catalog normalizes (${courses.length} schedulable courses)`, () => {
  assert.ok(courses.length > 200, `only ${courses.length} courses`);
  // Every retained section must have at least one placeable meeting.
  assert.ok(courses.every((c) => c.sections.every((s) => s.meetings.length > 0)));
  assert.ok(courses.some((c) => c.rating !== null), "no ratings survived");
  assert.ok(courses.some((c) => c.areas.length > 0), "no areas survived");
  const VALID = new Set(["H", "N", "S", "Q", "E", "W"]);
  const bad = courses.flatMap((c) => c.areas.filter((a) => !VALID.has(a)));
  assert.deepEqual([...new Set(bad)], [], "invalid distribution letters leaked");
  assert.ok(courses.some((c) => c.foci.length > 0), "no foci survived");
});

ok("solves the headline request with zero conflicts", () => {
  const out = solve(courses, {
    targetCredits: 15,
    earliestStart: 540,
    requiredAreas: ["N"],
    minRating: 3.7,
  });
  assert.ok(out.length > 0, "no schedules found");
  for (const s of out) {
    assert.equal(hasConflict(s), false, "schedule has a time conflict");
    assert.ok(Math.abs(s.credits - 15) <= 1.5, `credits ${s.credits}`);
    assert.ok(s.areasCovered.includes("N"), "missing required area N");
    for (const mt of allMeetings(s)) {
      assert.ok(mt.start >= 540, `class starts at ${mt.start}, before 9am`);
    }
  }
});

ok("honours free days", () => {
  const out = solve(courses, { targetCredits: 12, freeDays: ["F"] });
  assert.ok(out.length > 0, "no schedules found");
  for (const s of out) {
    assert.equal(hasConflict(s), false);
    assert.ok(allMeetings(s).every((mt) => mt.day !== "F"), "class on a free day");
  }
});

ok("honours a latest-end cap", () => {
  const out = solve(courses, { targetCredits: 12, latestEnd: 900 });
  assert.ok(out.length > 0);
  for (const s of out) assert.ok(allMeetings(s).every((mt) => mt.end <= 900));
});

ok("returns distinct schedules", () => {
  const out = solve(courses, { targetCredits: 15 });
  const sigs = new Set(out.map((s) => s.picks.map((p) => p.course.code).sort().join()));
  assert.equal(sigs.size, out.length, "duplicate schedules returned");
});

ok("impossible constraints yield nothing rather than a bad schedule", () => {
  const out = solve(courses, {
    targetCredits: 15,
    earliestStart: 1300, // nothing starts after 9:40pm
    latestEnd: 1310,
  });
  assert.equal(out.length, 0);
});

console.log(`\n${passed} passed\n`);
